import { createElement as h, useEffect, useRef, useState, type PointerEvent } from 'react';
import { createRoot } from 'react-dom/client';
import open from './assets/idle_blink/000.png';
import half from './assets/idle_blink/001.png';
import shut from './assets/idle_blink/002.png';
import wave0 from './assets/greet/000.png';
import wave1 from './assets/greet/001.png';
import wave2 from './assets/greet/002.png';
import wave3 from './assets/greet/003.png';
import './index.css';

type Frame = readonly [image: string, duration: number];
const blink: readonly Frame[] = [[half, 80], [shut, 100], [half, 80]];
const wave: readonly Frame[] = [[wave0, 180], [wave1, 180], [wave2, 240], [wave3, 200]];

function Pet() {
  const [frame, setFrame] = useState(open);
  const [bubble, setBubble] = useState(false);
  const greet = useRef<() => void>(undefined);
  const activePointer = useRef<number>(undefined);

  useEffect(() => {
    let timer = 0;
    let bubbleTimer = 0;
    let waving = false;

    function later(callback: () => void, delay: number) {
      window.clearTimeout(timer);
      timer = window.setTimeout(callback, delay);
    }

    function play(frames: readonly Frame[], index = 0) {
      const next = frames[index];
      if (!next) {
        idle();
        return;
      }
      const [image, duration] = next;
      setFrame(image);
      later(() => play(frames, index + 1), duration);
    }

    function idle() {
      waving = false;
      setFrame(open);
      if (!document.hidden) later(() => play(blink), 3000 + Math.random() * 3000);
    }

    greet.current = () => {
      if (waving || document.hidden) return;
      waving = true;
      setBubble(true);
      window.clearTimeout(bubbleTimer);
      bubbleTimer = window.setTimeout(() => setBubble(false), 4000);
      play(wave);
    };

    function onVisibilityChange() {
      window.clearTimeout(timer);
      window.clearTimeout(bubbleTimer);
      setBubble(false);
      idle();
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    idle();
    return () => {
      greet.current = undefined;
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
    bubble && h('div', { className: 'bubble', role: 'status' }, '今天也一起加油吧。'),
  );
}

function Journal() {
  return h('main', { className: 'journal' },
    h('h1', null, '渚的手账'),
    h('p', null, '古河渚'),
    h('p', null, '轻点渚可以打招呼，按住她可以拖动。'),
    h('p', null, '想把她带回主屏时，在系统托盘选择「找回角色」。'),
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('页面缺少 root 容器');

const journalPage = window.location.hash === '#journal';
if (journalPage) document.title = '渚的手账';
createRoot(container).render(journalPage ? h(Journal) : h(Pet));
