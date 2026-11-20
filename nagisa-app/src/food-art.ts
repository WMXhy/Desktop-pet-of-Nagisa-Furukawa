import bread from './assets/items/bread.png';
import redBeanBread from './assets/items/red_bean_bread.png';
import dangoSnack from './assets/items/dango_snack.png';
import bread0 from './assets/eat/000.png';
import bread1 from './assets/eat/001.png';
import bread2 from './assets/eat/002.png';
import bread3 from './assets/eat/003.png';
import smile from './assets/eat/004.png';
import red0 from './assets/eat_red_bean/000.png';
import red1 from './assets/eat_red_bean/001.png';
import red2 from './assets/eat_red_bean/002.png';
import red3 from './assets/eat_red_bean/003.png';
import dango0 from './assets/eat_dango/000.png';
import dango1 from './assets/eat_dango/001.png';
import dango2 from './assets/eat_dango/002.png';
import dango3 from './assets/eat_dango/003.png';
import type { FoodId } from './care';

export type Frame = readonly [image: string, duration: number];

function eating(first: string, second: string, third: string, fourth: string): readonly Frame[] {
  return [[first, 180], [second, 240], [third, 220], [fourth, 500], [smile, 360]];
}

export const foodArt: Record<FoodId, { icon: string; frames: readonly Frame[]; message: string }> = {
  bread: { icon: bread, frames: eating(bread0, bread1, bread2, bread3), message: '面包好香，谢谢你。' },
  redBeanBread: { icon: redBeanBread, frames: eating(red0, red1, red2, red3), message: '这个红豆馅好甜。' },
  dangoSnack: { icon: dangoSnack, frames: eating(dango0, dango1, dango2, dango3), message: '团子软软的，好开心。' },
};
