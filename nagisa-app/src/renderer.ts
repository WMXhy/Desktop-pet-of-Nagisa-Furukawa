import { createElement as h, useEffect, useRef, useState, type PointerEvent } from 'react';
import { createRoot } from 'react-dom/client';
import open from './assets/idle_blink/000.png';
import half from './assets/idle_blink/001.png';
import shut from './assets/idle_blink/002.png';
import wave0 from './assets/greet/000.png';
import wave1 from './assets/greet/001.png';
import wave2 from './assets/greet/002.png';
import wave3 from './assets/greet/003.png';
import rest0 from './assets/rest/000.png';
import rest1 from './assets/rest/001.png';
import bakery0 from './assets/work_bakery/000.png';
import bakery1 from './assets/work_bakery/001.png';
import bakery2 from './assets/work_bakery/002.png';
import bakery3 from './assets/work_bakery/003.png';
import workDone0 from './assets/work_done/000.png';
import workDone1 from './assets/work_done/001.png';
import study0 from './assets/study/000.png';
import study1 from './assets/study/001.png';
import study2 from './assets/study/002.png';
import study3 from './assets/study/003.png';
import rehearse0 from './assets/rehearse/000.png';
import rehearse1 from './assets/rehearse/001.png';
import rehearse2 from './assets/rehearse/002.png';
import rehearse3 from './assets/rehearse/003.png';
import props0 from './assets/work_props/000.png';
import props1 from './assets/work_props/001.png';
import props2 from './assets/work_props/002.png';
import props3 from './assets/work_props/003.png';
import hug0 from './assets/hug_dango/000.png';
import hug1 from './assets/hug_dango/001.png';
import hug2 from './assets/hug_dango/002.png';
import hug3 from './assets/hug_dango/003.png';
import { ActivityPanel } from './activity-panel';
import { useCareSnapshot } from './care-snapshot';
import { dangoEnergyCost, dangoHugFrameMs, dangoHugMs, type DangoMode } from './dango';
import { DangoPanel } from './dango-panel';
import { Backpack, SnackShop } from './food-panel';
import { foodArt, type Frame } from './food-art';
import { OwnedToys, ToyShop } from './toy-panel';
import { activityRules, dangoUnavailable, dramaClubStudyPoints, specialLineStudyPoints, specialStudyLine,
  type Activity, type ActivityKind, type ActivityRecord, type CareChange, type CareResponse, type FoodId } from './care';
import './index.css';

const blink: readonly Frame[] = [[half, 80], [shut, 100], [half, 80]];
const wave: readonly Frame[] = [[wave0, 180], [wave1, 180], [wave2, 240], [wave3, 200]];
const activityFrames: Record<ActivityKind, readonly Frame[]> = {
  rest: [[rest0, 1600], [rest1, 1600]],
  bakery: [[bakery0, 500], [bakery1, 500], [bakery2, 400], [bakery3, 1500]],
  study: [[study0, 2500], [study1, 200], [study2, 300], [study3, 1200]],
  rehearse: [[rehearse0, 1000], [rehearse1, 400], [rehearse2, 700], [rehearse3, 1000]],
  work_props: [[props0, 600], [props1, 500], [props2, 500], [props3, 1400]],
};
const workDone: readonly Frame[] = [[workDone0, 350], [workDone1, 850]];
const smile: readonly Frame[] = [[wave3, 1200]];
const encourage: readonly Frame[] = [[open, 1200]];
const hugFrames: readonly Frame[] = [hug0, hug1, hug2, hug3].map((image, index) => [image, dangoHugFrameMs[index]]);

function completionMessage(completed: ActivityRecord, studyPoints: number): string {
  const previous = studyPoints - completed.actual.studyPoints;
  const opensClub = previous < dramaClubStudyPoints && studyPoints >= dramaClubStudyPoints;
  const unlocksLine = previous < specialLineStudyPoints && studyPoints >= specialLineStudyPoints;
  if (opensClub && unlocksLine) return '戏剧部与专属台词已解锁';
  if (unlocksLine) return `学习点 +${completed.actual.studyPoints}，解锁专属台词`;
  if (opensClub) return `学习点 +${completed.actual.studyPoints}，戏剧部开放`;
  if (completed.actual.studyPoints > 0) return `学习点 +${completed.actual.studyPoints}`;
  if (completed.kind === 'bakery' || completed.kind === 'work_props') return `团子币 +${completed.actual.coins}`;
  if (completed.kind === 'rest') return `精力 +${completed.actual.energy}`;
  return `${activityRules[completed.kind].label}完成`;
}

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
    let gameBusy = false;
    let revision = -1;
    let studyPoints = 0;
    let specialLineNext = true;
    let lastCompletion: string | undefined;
    let eating = false;
    let hugging = false;
    let pendingHug = false;
    const feedQueue: FoodId[] = [];

    function later(callback: () => void, delay: number) {
      window.clearTimeout(timer);
      timer = window.setTimeout(callback, delay);
    }

    function play(frames: readonly Frame[], index = 0, onFrame?: (index: number) => void) {
      const next = frames[index];
      if (!next) {
        eating = false;
        hugging = false;
        if (feedQueue.length && !document.hidden) playNextFood();
        else if (pendingHug && !activity && !gameBusy && !document.hidden) playHug();
        else restorePose();
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
      pendingHug = false;
      if (document.hidden) { setFrame(open); return; }
      if (activity) {
        play(activityFrames[activity.kind]);
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

    function playNextFood() {
      const id = feedQueue.shift();
      if (!id) return;
      eating = true;
      const art = foodArt[id];
      interact(art.frames, art.message, 2500);
    }

    function playHug() {
      pendingHug = false;
      hugging = true;
      interact(hugFrames, '团子玩偶软软的。', dangoHugMs);
    }

    greet.current = () => {
      if (playingInteraction || document.hidden) return;
      if (!activity && studyPoints >= specialLineStudyPoints) {
        const line = specialLineNext ? specialStudyLine : '今天也一起加油吧。';
        specialLineNext = !specialLineNext;
        interact(wave, line, 4000);
      } else interact(wave, '今天也一起加油吧。', 4000);
    };
    const unsubscribeFed = window.pet.onFed((id) => {
      if (document.hidden) return;
      feedQueue.push(id);
      if (!eating && !hugging) playNextFood();
    });
    const unsubscribeHug = window.pet.onHug(() => {
      if (document.hidden || hugging || pendingHug) return;
      if (eating) pendingHug = true;
      else playHug();
    });

    function updateCare({ snapshot, completed, dangoStarted, dangoCompleted }: CareChange) {
      if (!snapshot.ok || snapshot.state.revision < revision) return;
      revision = snapshot.state.revision;
      studyPoints = snapshot.state.studyPoints;
      const changedActivity = activity?.id !== snapshot.state.activeActivity?.id;
      activity = snapshot.state.activeActivity;
      gameBusy = snapshot.gameBusy;
      if (completed && completed.id !== lastCompletion) {
        lastCompletion = completed.id;
        if (document.hidden) return;
        const text = completionMessage(completed, studyPoints);
        if (completed.kind === 'bakery') {
          playingInteraction = true;
          showBubble('', 0);
          play(workDone, 0, (index) => {
            if (index === 1) showBubble(text, 2500);
          });
        } else interact(completed.kind === 'work_props' ? [activityFrames.work_props[3]] : smile, text, 2500);
      } else if (dangoCompleted && dangoCompleted.id !== lastCompletion) {
        lastCompletion = dangoCompleted.id;
        if (document.hidden) return;
        if (dangoCompleted.mode === 'lines') {
          if (dangoCompleted.correct) interact(smile, '这句接得真好！', 2500);
          else interact(encourage, '再看看台本提示吧。', 2500);
        } else if (dangoCompleted.correct) {
          interact(smile, dangoCompleted.mode === 'plush' ? '找到团子玩偶啦！' : '猜中了！就是这颗团子。', 2500);
        } else interact(encourage, '刚刚差一点，再看一次吧。', 2500);
      } else if (dangoStarted === 'lines' && !document.hidden) {
        interact(activityFrames.rehearse, '下一句交给你了。', 2600);
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
      eating = false;
      hugging = false;
      feedQueue.length = 0;
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
      unsubscribeHug();
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

const journalTabs = { journal: '手账', snacks: '零食店', toys: '玩具店' } as const;
const journalTabIds = ['journal', 'snacks', 'toys'] as const;

function Journal() {
  const { care, setCare, loadCare } = useCareSnapshot();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [page, setPage] = useState<keyof typeof journalTabs>('journal');
  const requesting = useRef(false);

  function openGame(mode?: DangoMode) {
    void window.pet.openDangoGame(mode).catch((error) => {
      console.error('无法打开小游戏', error);
      setFeedback('暂时无法打开小游戏，请重试。');
    });
  }

  async function submit(request: () => Promise<CareResponse>, message: string, onSuccess?: () => void) {
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
      if (result.ok) onSuccess?.();
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

  const { state, notice, gameBusy } = care;
  const gameReason = dangoUnavailable(state, gameBusy);
  const stats: [string, number][] = [
    ['团子币', state.coins], ['饱食', state.fullness], ['精力', state.energy],
    ['心情', state.mood], ['好感', state.affection], ['学习点', state.studyPoints],
  ];

  return h('main', { className: 'journal' }, heading,
    h('dl', { className: 'care-stats' }, stats.map(([label, value]) =>
      h('div', { key: label }, h('dt', null, label), h('dd', null, value)),
    )),
    h('nav', { className: 'journal-nav', 'aria-label': '手账页面' },
      journalTabIds.map((id) => h('button', { key: id, type: 'button', 'aria-pressed': page === id,
        onClick: () => { setPage(id); setFeedback(''); } }, journalTabs[id])),
    ),
    h('p', { className: 'care-feedback', role: 'status' }, feedback),
    notice && h('p', { className: 'care-notice' }, notice),
    care.warning && h('p', { className: 'care-notice', role: 'status' }, care.warning),
    page === 'snacks' ? h(SnackShop, { state, gameBusy, busy, submit })
      : page === 'toys' ? h(ToyShop, { state, gameBusy, busy, submit, openGame }) : h('div', null,
      h('section', { className: 'journal-game', 'aria-labelledby': 'minigames-heading' },
        h('div', null, h('h2', { id: 'minigames-heading' }, '小游戏'),
          h('p', { id: 'dango-entry-detail' }, gameReason ?? `每局消耗 ${dangoEnergyCost} 精力。`)),
        h('button', { type: 'button', disabled: !gameBusy && Boolean(gameReason), 'aria-describedby': 'dango-entry-detail',
          onClick: () => openGame(),
        }, '和渚玩猜团子'),
      ),
      h(Backpack, { state, gameBusy, busy, submit }),
      h(OwnedToys, { state, gameBusy, busy, submit, openGame }),
      h(ActivityPanel, { state, durations: care.durations, gameBusy, busy, submit }),
    ),
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('页面缺少 root 容器');

const journalPage = window.location.hash === '#journal';
const dangoPage = window.location.hash === '#dango-game';
if (journalPage) document.title = '渚的手账';
if (dangoPage) document.title = '猜团子';
createRoot(container).render(dangoPage ? h(DangoPanel) : journalPage ? h(Journal) : h(Pet));
