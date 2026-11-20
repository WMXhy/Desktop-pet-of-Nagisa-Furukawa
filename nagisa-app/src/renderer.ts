import { createElement as h, useEffect, useRef, useState, type PointerEvent } from 'react';
import { createRoot } from 'react-dom/client';
import open from './assets/idle_blink/000.png';
import half from './assets/idle_blink/001.png';
import shut from './assets/idle_blink/002.png';
import wave0 from './assets/greet/000.png';
import wave1 from './assets/greet/001.png';
import wave2 from './assets/greet/002.png';
import wave3 from './assets/greet/003.png';
import eat0 from './assets/eat/000.png';
import eat1 from './assets/eat/001.png';
import eat2 from './assets/eat/002.png';
import eat3 from './assets/eat/003.png';
import eat4 from './assets/eat/004.png';
import bread from './assets/items/bread.png';
import rest0 from './assets/rest/000.png';
import rest1 from './assets/rest/001.png';
import bakery0 from './assets/work_bakery/000.png';
import bakery1 from './assets/work_bakery/001.png';
import bakery2 from './assets/work_bakery/002.png';
import bakery3 from './assets/work_bakery/003.png';
import workDone0 from './assets/work_done/000.png';
import workDone1 from './assets/work_done/001.png';
import { ActivityPanel } from './activity-panel';
import { breadUnavailable, fullnessAfterBread, type Activity, type CareChange, type CareResponse, type CareSnapshot } from './care';
import './index.css';

type Frame = readonly [image: string, duration: number];
const blink: readonly Frame[] = [[half, 80], [shut, 100], [half, 80]];
const wave: readonly Frame[] = [[wave0, 180], [wave1, 180], [wave2, 240], [wave3, 200]];
const eat: readonly Frame[] = [[eat0, 180], [eat1, 240], [eat2, 220], [eat3, 500], [eat4, 360]];
const rest: readonly Frame[] = [[rest0, 1600], [rest1, 1600]];
const bakery: readonly Frame[] = [[bakery0, 500], [bakery1, 500], [bakery2, 400], [bakery3, 1500]];
const workDone: readonly Frame[] = [[workDone0, 350], [workDone1, 850]];

function Pet() {
  const [frame, setFrame] = useState(open);
  const [bubble, setBubble] = useState('');
  const greet = useRef<() => void>(undefined);
  const activePointer = useRef<number>(undefined);

  useEffect(() => {
    let timer = 0;
    let bubbleTimer = 0;
    let playingInteraction = false;
    let activity: Activity | null = null;
    let revision = -1;
    let lastCompletion: string | undefined;

    function later(callback: () => void, delay: number) {
      window.clearTimeout(timer);
      timer = window.setTimeout(callback, delay);
    }

    function play(frames: readonly Frame[], index = 0, onFrame?: (index: number) => void) {
      const next = frames[index];
      if (!next) {
        restorePose();
        return;
      }
      const [image, duration] = next;
      setFrame(image);
      onFrame?.(index);
      later(() => play(frames, index + 1, onFrame), duration);
    }

    function restorePose() {
      window.clearTimeout(timer);
      playingInteraction = false;
      if (document.hidden) { setFrame(open); return; }
      if (activity) {
        play(activity.kind === 'rest' ? rest : bakery);
        return;
      }
      setFrame(open);
      later(() => play(blink), 3000 + Math.random() * 3000);
    }

    function showBubble(text: string, bubbleDuration: number) {
      setBubble(text);
      window.clearTimeout(bubbleTimer);
      bubbleTimer = window.setTimeout(() => setBubble(''), bubbleDuration);
    }

    function interact(frames: readonly Frame[], text: string, bubbleDuration: number) {
      playingInteraction = true;
      showBubble(text, bubbleDuration);
      play(frames);
    }

    greet.current = () => {
      if (!playingInteraction && !document.hidden) interact(wave, '今天也一起加油吧。', 4000);
    };
    const unsubscribeFed = window.pet.onFed(() => {
      if (!document.hidden) interact(eat, '面包好香，谢谢你。', 2500);
    });

    function updateCare({ snapshot, completed }: CareChange) {
      if (!snapshot.ok || snapshot.state.revision < revision) return;
      revision = snapshot.state.revision;
      const changedActivity = activity?.id !== snapshot.state.activeActivity?.id;
      activity = snapshot.state.activeActivity;
      if (completed?.kind === 'bakery' && completed.id !== lastCompletion) {
        lastCompletion = completed.id;
        if (document.hidden) return;
        playingInteraction = true;
        showBubble('', 0);
        play(workDone, 0, (index) => {
          if (index === 1) showBubble(`团子币 +${completed.actual.coins}`, 2500);
        });
      } else if (changedActivity && !playingInteraction) restorePose();
    }
    const unsubscribeCare = window.pet.onCareChanged(updateCare);

    function readCare() {
      void window.pet.readCare().then((snapshot) => updateCare({ snapshot })).catch((error) => {
        console.warn('角色无法读取活动状态', error);
      });
    }

    function onVisibilityChange() {
      window.clearTimeout(timer);
      window.clearTimeout(bubbleTimer);
      setBubble('');
      restorePose();
      if (!document.hidden) readCare();
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    restorePose();
    readCare();
    return () => {
      greet.current = undefined;
      unsubscribeFed();
      unsubscribeCare();
      window.clearTimeout(timer);
      window.clearTimeout(bubbleTimer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  function startPointer(event: PointerEvent<HTMLImageElement>) {
    if (event.button !== 0 || !event.isPrimary || activePointer.current !== undefined) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointer.current = event.pointerId;
    window.pet.start(event.screenX, event.screenY);
  }

  function movePointer(event: PointerEvent<HTMLImageElement>) {
    if (activePointer.current === event.pointerId) window.pet.move(event.screenX, event.screenY);
  }

  async function finishPointer(event: PointerEvent<HTMLImageElement>) {
    if (activePointer.current !== event.pointerId) return;
    activePointer.current = undefined;
    if (await window.pet.finish(event.screenX, event.screenY)) greet.current?.();
  }

  function cancelPointer(event: PointerEvent<HTMLImageElement>) {
    if (activePointer.current !== event.pointerId) return;
    activePointer.current = undefined;
    window.pet.cancel();
  }

  return h('div', { className: 'pet-stage' },
    h('img', {
      className: 'pet',
      src: frame,
      alt: '古河渚',
      draggable: false,
      onPointerDown: startPointer,
      onPointerMove: movePointer,
      onPointerUp: finishPointer,
      onPointerCancel: cancelPointer,
      onLostPointerCapture: cancelPointer,
    }),
    bubble && h('div', { className: 'bubble', role: 'status' }, bubble),
  );
}

function Journal() {
  const [care, setCare] = useState<CareSnapshot>();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const requesting = useRef(false);

  function updateSnapshot(snapshot: CareSnapshot) {
    setCare((previous) => previous?.ok && (!snapshot.ok || snapshot.state.revision < previous.state.revision)
      ? previous : snapshot);
  }

  async function loadCare() {
    try {
      updateSnapshot(await window.pet.readCare());
    } catch (error) {
      console.error('手账无法读取养成状态', error);
      setCare((previous) => previous?.ok ? previous : { ok: false, message: '手账暂时无法读取养成状态，请重试。',
        durations: { rest: 300_000, bakery: 180_000 } });
    }
  }

  useEffect(() => {
    const unsubscribe = window.pet.onCareChanged(({ snapshot }) => updateSnapshot(snapshot));
    void loadCare();
    return unsubscribe;
  }, []);

  async function submit(request: () => Promise<CareResponse>, message: string) {
    if (!care?.ok || requesting.current) return;
    requesting.current = true;
    setBusy(true);
    setFeedback('');
    try {
      const result = await request();
      const state = result.state;
      if (state) setCare((previous) => previous?.ok && state.revision >= previous.state.revision
        ? { ...previous, state } : previous);
      setFeedback(result.ok === false ? result.message : message);
    } catch (error) {
      console.error('手账无法确认操作结果', error);
      await loadCare();
      setFeedback('未收到操作结果，请查看已重新读取的养成状态。');
    } finally {
      requesting.current = false;
      setBusy(false);
    }
  }

  const heading = h('h1', null, '渚的手账');
  if (!care?.ok) {
    return h('main', { className: 'journal' }, heading,
      h('p', { role: 'status' }, care?.ok === false ? care.message : '正在读取养成存档…'),
      care && h('button', { type: 'button', onClick: () => { setCare(undefined); void loadCare(); } }, '重试'),
    );
  }

  const { state, notice } = care;
  const unavailable = breadUnavailable(state);
  const stats: [string, number][] = [
    ['团子币', state.coins], ['饱食', state.fullness], ['精力', state.energy],
    ['心情', state.mood], ['好感', state.affection],
  ];

  return h('main', { className: 'journal' }, heading,
    h('dl', { className: 'care-stats' }, stats.map(([label, value]) =>
      h('div', { key: label }, h('dt', null, label), h('dd', null, value)),
    )),
    h('section', { className: 'backpack', 'aria-labelledby': 'backpack-heading' },
      h('h2', { id: 'backpack-heading' }, '背包'),
      h('div', { className: 'bread-row' },
        h('img', { src: bread, alt: '', width: 48, height: 48 }),
        h('div', { className: 'bread-description' },
          h('strong', null, `小面包 × ${state.inventory.bread}`),
          h('p', { id: 'bread-effect' }, unavailable ?? `饱食 ${state.fullness} → ${fullnessAfterBread(state.fullness)}`),
        ),
        h('button', { type: 'button', disabled: busy || Boolean(unavailable), 'aria-describedby': 'bread-effect',
          onClick: () => { void submit(() => window.pet.feedBread(state.revision), '已喂一个小面包。'); } }, '喂给渚'),
      ),
    ),
    h('p', { className: 'care-feedback', role: 'status' }, feedback),
    notice && h('p', { className: 'care-notice' }, notice),
    care.warning && h('p', { className: 'care-notice', role: 'status' }, care.warning),
    h(ActivityPanel, { state, durations: care.durations, busy, submit }),
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('页面缺少 root 容器');

const journalPage = window.location.hash === '#journal';
if (journalPage) document.title = '渚的手账';
createRoot(container).render(journalPage ? h(Journal) : h(Pet));
