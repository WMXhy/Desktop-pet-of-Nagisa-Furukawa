import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import petImage from './assets/nagisa-idle.png';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('页面缺少 root 容器');

createRoot(container).render(createElement('img', {
  className: 'pet',
  src: petImage,
  alt: '古河渚',
  draggable: false,
}));
