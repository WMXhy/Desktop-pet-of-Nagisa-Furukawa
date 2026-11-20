import { createElement as h, useEffect, useRef, useState } from 'react';
import plain from './assets/dango_game/plain.png';
import target from './assets/dango_game/target.png';
import plushTarget from './assets/dango_game/plush_target.png';
import bowl from './assets/dango_game/bowl.png';
import miniStage from './assets/items/mini_stage.png';
import { dangoModeUnavailable, dangoUnavailable } from './care';
import { useCareSnapshot } from './care-snapshot';
import { dangoCoverMs, dangoEnergyCost, dangoModeIds, dangoModes, dangoPreviewMs, dangoSlots,
  type DangoLinesPreview, type DangoMemoryPreview, type DangoMode, type DangoResult, type DangoSlot } from './dango';

type Stage = { phase: 'ready' }
  | { phase: 'preview'; round: DangoMemoryPreview; covering: boolean }
  | { phase: 'choose'; round: Omit<DangoMemoryPreview, 'target'> | DangoLinesPreview; picked?: DangoSlot }
  | { phase: 'result'; round: DangoResult };

const positions = ['左边', '中间', '右边'];

function instruction(stage: Stage, mode: DangoMode) {
  const item = mode === 'plush' ? '团子玩偶' : '花纹团子';
  switch (stage.phase) {
    case 'ready': return mode === 'lines' ? '根据台本提示，选一句台词。' : `记住${item}，盖碗后选它的位置。`;
    case 'preview': return stage.covering ? '盖碗中…' : `记住${item}的位置。`;
    case 'choose': {
      if (mode === 'lines') return stage.picked === undefined ? '哪句台词符合提示？' : '已选好台词。';
      return stage.picked === undefined ? `${item}在哪只碗下？` : '已选好位置。';
    }
    case 'result': {
      const { correct, actual } = stage.round;
      const feedback = mode === 'lines' ? (correct ? '答对了！' : '这句还差一点。') : (correct ? '猜中了！' : '猜错了。');
      return `${feedback} 心情 +${actual.mood} · 好感 +${actual.affection}`;
    }
  }
}

function MemoryBoard({ stage, mode, busy, pick }: { stage: Stage; mode: DangoMode; busy: boolean; pick: (slot: DangoSlot) => void }) {
  const item = mode === 'plush' ? '团子玩偶' : '花纹团子';
  const covering = stage.phase === 'preview' && stage.covering;
  const covered = covering || stage.phase === 'choose';
  const revealed = stage.phase === 'result';
  const choosing = stage.phase === 'choose';
  const pinned = choosing ? stage.picked : undefined;
  return h('div', { className: 'dango-slots', role: 'group', 'aria-label': '团子位置' }, dangoSlots.map((slot) => {
    const marked = (stage.phase === 'preview' || revealed) && stage.round.target === slot;
    const picked = revealed && stage.round.picked === slot;
    const itemArt = mode === 'plush' ? plushTarget : target;
    const image = covered ? bowl : stage.phase === 'ready' ? undefined : marked ? itemArt : plain;
    const label = [positions[slot], picked && '你选的', revealed && marked && item].filter(Boolean).join(' · ');
    const caption = choosing ? `${pinned === slot ? '重试' : '选'}${positions[slot]}` : label;
    return h('button', {
      key: slot, type: 'button', className: 'dango-slot', disabled: !choosing || busy || (pinned !== undefined && pinned !== slot),
      'data-target': revealed && marked ? true : undefined, 'data-picked': picked ? true : undefined,
      onClick: () => pick(slot),
    },
    h('span', { className: 'dango-art' }, image && h('img', { src: image, width: 64, height: 64,
      className: covering ? 'dango-cover' : undefined, alt: covered || revealed ? '' : marked ? item : '普通团子' })),
    h('span', { className: 'dango-slot-label' }, caption));
  }));
}

function LinesBoard({ stage, busy, pick }: { stage: Stage; busy: boolean; pick: (slot: DangoSlot) => void }) {
  const round = stage.phase !== 'ready' && stage.round.mode === 'lines' ? stage.round : undefined;
  const result = stage.phase === 'result' ? stage.round : undefined;
  const pinned = stage.phase === 'choose' ? stage.picked : undefined;
  return h('div', { className: 'dango-lines' },
    h('div', { className: 'dango-prompt' }, h('img', { src: miniStage, alt: '', width: 48, height: 48 }),
      round ? h('p', { id: 'line-prompt' }, h('strong', null, '台本提示'), round.prompt) : h('p', null, '小舞台布景')),
    round && h('div', { className: 'dango-line-options', role: 'group', 'aria-labelledby': 'line-prompt' }, dangoSlots.map((slot) => {
      const picked = result?.picked === slot;
      const correct = result?.target === slot;
      const label = [picked && '你选的', correct && '正确台词'].filter(Boolean).join(' · ');
      return h('button', { key: slot, type: 'button', className: 'dango-slot dango-line',
        disabled: Boolean(result) || busy || (pinned !== undefined && pinned !== slot),
        'data-target': correct || undefined, 'data-picked': picked || undefined, onClick: () => pick(slot),
      }, pinned === slot && '重试 · ', round.choices[slot], label && h('span', null, label));
    })),
  );
}

export function DangoPanel() {
  const { care, loadCare, readStatus } = useCareSnapshot();
  const [stage, setStage] = useState<Stage>({ phase: 'ready' });
  const [mode, setMode] = useState<DangoMode>('classic');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reducedMotion, setReducedMotion] = useState(false);
  const requesting = useRef(false);
  const currentEpoch = useRef(0);
  currentEpoch.current = care?.epoch ?? 0;
  const playingMode = stage.phase === 'ready' ? mode : stage.round.mode;

  useEffect(() => {
    if (!care?.epoch) return;
    setStage({ phase: 'ready' });
    setMode('classic');
    setError('');
  }, [care?.epoch]);

  useEffect(() => {
    let received = false;
    const off = window.pet.onSettingsChanged((view) => { received = true; setReducedMotion(view.effective.reducedMotion); });
    void window.pet.readSettings().then((view) => { if (!received) setReducedMotion(view.effective.reducedMotion); }).catch(console.warn);
    return off;
  }, []);

  useEffect(() => {
    let active = true;
    let received = false;
    const unsubscribe = window.pet.onDangoMode((next) => {
      received = true;
      setMode(next);
      setStage((current) => current.phase === 'result' ? { phase: 'ready' } : current);
      setError('');
    });
    void window.pet.readDangoMode().then((initial) => {
      if (active && !received) setMode(initial);
    }).catch((error) => { console.warn('无法读取小游戏玩法', error); });
    return () => { active = false; unsubscribe(); };
  }, []);

  const title = playingMode === 'lines' ? '台词接龙' : '猜团子';
  useEffect(() => { document.title = title; }, [title]);

  useEffect(() => {
    if (stage.phase !== 'preview') return;
    const timer = window.setTimeout(() => {
      const { id, mode } = stage.round;
      setStage(stage.covering ? { phase: 'choose', round: { id, mode } } : { ...stage, covering: true });
    }, stage.covering ? dangoCoverMs : dangoPreviewMs);
    return () => window.clearTimeout(timer);
  }, [stage]);

  async function submit(operation: () => Promise<void>, onError: string) {
    if (requesting.current) return;
    requesting.current = true;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (error) {
      console.error('小游戏操作失败', error);
      setError(onError);
    } finally {
      requesting.current = false;
      setBusy(false);
    }
  }

  const state = care?.ok ? care.state : undefined;
  const unavailable = state ? dangoUnavailable(state, care.gameBusy, playingMode) : undefined;

  function start() {
    if (!state || readStatus !== 'ready' || unavailable || (stage.phase !== 'ready' && stage.phase !== 'result')) return;
    void submit(async () => {
      const result = await window.pet.startDango(state.revision, playingMode, care.epoch);
      if (care.epoch !== currentEpoch.current) return;
      if (result.ok === false) {
        setError(result.message);
        void loadCare();
        return;
      }
      const { round } = result;
      setStage(round.mode === 'lines' ? { phase: 'choose', round } : { phase: 'preview', round, covering: false });
    }, '未能开始小游戏，请重试。');
  }

  function pick(slot: DangoSlot) {
    if (stage.phase !== 'choose' || (stage.picked !== undefined && stage.picked !== slot)) return;
    const epoch = currentEpoch.current;
    void submit(async () => {
      setStage({ ...stage, picked: slot });
      const result = await window.pet.pickDango(stage.round.id, slot);
      if (epoch !== currentEpoch.current) return;
      if (result.ok === false) setError(result.message);
      else setStage({ phase: 'result', round: result.round });
    }, '未收到结果，请重试刚才的选择。');
  }

  function leave() {
    const id = stage.phase === 'preview' || stage.phase === 'choose' ? stage.round.id : undefined;
    void submit(async () => {
      if (id) await window.pet.leaveDango(id);
      window.close();
    }, '未能退出，请重试或关闭窗口。');
  }

  const starting = stage.phase === 'ready' || stage.phase === 'result';

  return h('main', { className: 'dango-panel', 'aria-labelledby': 'dango-title', 'data-reduced-motion': reducedMotion || undefined },
    h('header', null, h('h1', { id: 'dango-title' }, title),
      h('span', { className: 'dango-energy' }, state ? `精力 ${state.energy}` : '精力 —')),
    stage.phase === 'ready' && h('div', { className: 'dango-modes', role: 'radiogroup', 'aria-label': '选择玩法' },
      dangoModeIds.map((id) => {
        const locked = state && dangoModeUnavailable(state, id);
        return h('label', { key: id, title: locked },
          h('input', { type: 'radio', name: 'game-mode', value: id, checked: mode === id,
            disabled: busy || Boolean(locked) || (!state && id !== 'classic'), onChange: () => { setMode(id); setError(''); } }),
          h('span', null, dangoModes[id]));
      })),
    h('p', { className: 'dango-instruction', role: 'status' }, instruction(stage, playingMode)),
    playingMode === 'lines' ? h(LinesBoard, { stage, busy, pick }) : h(MemoryBoard, { stage, mode: playingMode, busy, pick }),
    h('div', { className: 'dango-actions' },
      starting && h('button', { type: 'button', disabled: busy || !state || readStatus !== 'ready' || Boolean(unavailable), onClick: start },
        `${stage.phase === 'ready' ? '开始' : '再来一局'} · 精力 −${dangoEnergyCost}`),
      stage.phase === 'result' && h('button', { type: 'button', className: 'dango-exit', disabled: busy,
        onClick: () => { setMode(stage.round.mode); setStage({ phase: 'ready' }); setError(''); } }, '换玩法'),
      readStatus === 'failed' && h('button', { type: 'button', onClick: () => { void loadCare(); } }, '重试读取'),
      h('button', { type: 'button', className: 'dango-exit', disabled: busy, onClick: leave }, '退出'),
    ),
    error ? h('p', { className: 'dango-message', role: 'alert' }, error)
      : h('p', { className: 'dango-message', role: 'status' }, care?.ok === false ? care.message
        : readStatus === 'loading' ? '正在读取养成状态…'
        : readStatus === 'failed' ? '暂时无法读取养成状态，请重试。'
        : starting && unavailable ? unavailable : care?.warning),
  );
}
