import { randomInt } from 'node:crypto';
import { dangoSlots, type DangoLinesPreview, type DangoSlot } from './dango';

type OptionId = 'a' | 'b' | 'c';
type Question = { id: string; prompt: string; options: Record<OptionId, string>; answer: OptionId };

const questions: readonly Question[] = [
  { id: 'next-rehearsal', prompt: '邀请同伴明天继续排练。', answer: 'a', options: {
    a: '明天放学后，也在这里见面吧。',
    b: '我把道具放回箱子里。',
    c: '今晚的幕布已经收好了。',
  } },
  { id: 'opening-welcome', prompt: '演出即将开始，向刚入座的观众问好。', answer: 'b', options: {
    a: '我去后台找一下没放好的台本。',
    b: '欢迎大家来到剧场，请欣赏今晚的演出。',
    c: '明天下午我们再练一遍吧。',
  } },
  { id: 'curtain-thanks', prompt: '演出结束，向留下来鼓掌的观众道谢。', answer: 'c', options: {
    a: '灯光准备好了吗？第一幕要开始了。',
    b: '这顶帽子先放在道具桌上吧。',
    c: '谢谢你们的掌声，也谢谢你们陪我们演到最后。',
  } },
];

export function drawDangoLines(id: string): { preview: DangoLinesPreview; target: DangoSlot } {
  const question = questions[randomInt(questions.length)];
  const order: [OptionId, OptionId, OptionId] = ['a', 'b', 'c'];
  for (let index = order.length - 1; index > 0; index -= 1) {
    const other = randomInt(index + 1);
    [order[index], order[other]] = [order[other], order[index]];
  }
  const [first, second, third] = order;
  return {
    preview: { id, mode: 'lines', questionId: question.id, prompt: question.prompt,
      choices: [question.options[first], question.options[second], question.options[third]] },
    target: dangoSlots[order.indexOf(question.answer)],
  };
}
