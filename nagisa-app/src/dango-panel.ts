import { createElement as h, useEffect, useRef, useState } from 'react';
import plain from './assets/dango_game/plain.png';
import target from './assets/dango_game/target.png';
import bowl from './assets/dango_game/bowl.png';
import { dangoUnavailable } from './care';
import { useCareSnapshot } from './care-snapshot';
import { dangoCoverMs, dangoEnergyCost, dangoPreviewMs, dangoSlots,
  type DangoPreview, type DangoResult, type DangoSlot } from './dango';

type Stage = { phase: 'ready' }
  | { phase: 'preview'; round: DangoPreview; covering: boolean }
  | { phase: 'choose'; id: string; picked?: DangoSlot }
  | { phase: 'result'; round: DangoResult };

const positions = ['左边', '中间', '右边'];

function instruction(stage: Stage) {
  switch (stage.phase) {
    case 'ready': return '记住花纹团子，盖碗后选它的位置。';
    case 'preview': return stage.covering ? '盖碗中…' : '记住花纹团子的位置。';
    case 'choose': return stage.picked === undefined ? '花纹团子在哪只碗下？' : '已选好位置。';
    case 'result': {
      const { correct, actual } = stage.round;
      return `${correct ? '猜中了！' : '猜错了。'} 心情 +${actual.mood} · 好感 +${actual.affection}`;
    }
  }
}

export function DangoPanel() {
  const { care, loadCare, readStatus } = useCareSnapshot();
  const [stage, setStage] = useState<Stage>({ phase: 'ready' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requesting = useRef(false);

  useEffect(() => {
    if (stage.phase !== 'preview') return;
    const timer = window.setTimeout(() => {
      setStage(stage.covering ? { phase: 'choose', id: stage.round.id } : { ...stage, covering: true });
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
      console.error('猜团子操作失败', error);
      setError(onError);
    } finally {
      requesting.current = false;
      setBusy(false);
    }
  }

  const state = care?.ok ? care.state : undefined;
  const unavailable = state ? dangoUnavailable(state, care.gameBusy) : undefined;

  function start() {
    if (!state || readStatus !== 'ready' || unavailable || (stage.phase !== 'ready' && stage.phase !== 'result')) return;
    void submit(async () => {
      const result = await window.pet.startDango(state.revision);
      if (result.ok === false) {
        setError(result.message);
        void loadCare();
        return;
      }
      setStage({ phase: 'preview', round: result.round, covering: false });
    }, '未能开始猜团子，请重试。');
  }

  function pick(slot: DangoSlot) {
    if (stage.phase !== 'choose' || (stage.picked !== undefined && stage.picked !== slot)) return;
    void submit(async () => {
      setStage({ ...stage, picked: slot });
      const result = await window.pet.pickDango(stage.id, slot);
      if (result.ok === false) setError(result.message);
      else setStage({ phase: 'result', round: result.round });
    }, '未收到结果，请重试刚才选的位置。');
  }

  function leave() {
    const id = stage.phase === 'preview' ? stage.round.id : stage.phase === 'choose' ? stage.id : undefined;
    void submit(async () => {
      if (id) await window.pet.leaveDango(id);
      window.close();
    }, '未能退出，请重试或关闭窗口。');
  }

  const covering = stage.phase === 'preview' && stage.covering;
  const covered = covering || stage.phase === 'choose';
  const starting = stage.phase === 'ready' || stage.phase === 'result';

  return h('main', { className: 'dango-panel', 'aria-labelledby': 'dango-title' },
    h('header', null, h('h1', { id: 'dango-title' }, '猜团子'),
      h('span', { className: 'dango-energy' }, state ? `精力 ${state.energy}` : '精力 —')),
    h('p', { className: 'dango-instruction', role: 'status' }, instruction(stage)),
    h('div', { className: 'dango-slots', role: 'group', 'aria-label': '团子位置' }, dangoSlots.map((slot) => {
      const revealed = stage.phase === 'result';
      const marked = (stage.phase === 'preview' || revealed) && stage.round.target === slot;
      const picked = revealed && stage.round.picked === slot;
      const image = covered ? bowl : stage.phase === 'ready' ? undefined : marked ? target : plain;
      const label = [positions[slot], picked && '你选的', revealed && marked && '花纹团子'].filter(Boolean).join(' · ');
      const choosing = stage.phase === 'choose';
      const selection = choosing && stage.picked === slot;
      const caption = choosing ? `${selection ? '重试' : '选'}${positions[slot]}` : label;
      return h('button', {
        key: slot, type: 'button', className: 'dango-slot', disabled: !choosing || busy || (stage.picked !== undefined && !selection),
        'data-target': revealed && marked ? true : undefined, 'data-picked': picked ? true : undefined,
        onClick: () => pick(slot),
      },
      h('span', { className: 'dango-art' }, image && h('img', { src: image, width: 64, height: 64,
        className: covering ? 'dango-cover' : undefined, alt: !covered && !revealed ? marked ? '花纹团子' : '普通团子' : '' })),
      h('span', { className: 'dango-slot-label' }, caption));
    })),
    h('div', { className: 'dango-actions' },
      starting && h('button', { type: 'button', disabled: busy || !state || readStatus !== 'ready' || Boolean(unavailable), onClick: start },
        `${stage.phase === 'ready' ? '开始' : '再来一局'} · 精力 −${dangoEnergyCost}`),
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
