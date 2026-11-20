export const affectionLimit = 300;
export const dailyAffectionLimit = 12;
export const trustThreshold = 80;
export const companionThreshold = 150;
export const rehearsalFrameMs = [1000, 400, 700, 1000] as const;
export const practiceLineMs = rehearsalFrameMs.reduce<number>((total, duration) => total + duration, 0);

export const milestones = [
  { id: 'familiar', min: 30, title: '熟悉', event: '放学后的面包袋', dialogue: [
    { speaker: '渚', line: '今天我学会在面包袋上打蝴蝶结了。放学路上，我给你看看吧。' },
  ] },
  { id: 'trusted', min: trustThreshold, title: '信赖', event: '排练前的一句话', dialogue: [
    { speaker: '渚', line: '如果我中途忘词，你可以再给我一个开始的手势吗？看见你，我就知道该从哪里接下去了。' },
  ] },
  { id: 'companion', min: companionThreshold, title: '亲密伙伴', event: '明天的第一句', dialogue: [
    { speaker: '渚', line: '第一次排练时，我连第一句都念得很轻。' },
    { speaker: '你', line: '今天我听清楚了。' },
    { speaker: '渚', line: '那，明天的第一句也念给你听。' },
  ] },
] as const;

export type MilestoneId = typeof milestones[number]['id'];
export type RelationshipRecord = { id: MilestoneId; unlockedAt: number | null };

export function newMilestones(before: number, after: number, recorded: readonly MilestoneId[]) {
  return milestones.filter((milestone) => before < milestone.min && after >= milestone.min && !recorded.includes(milestone.id));
}

export function relationshipRank(affection: number) {
  const reached = milestones.filter((milestone) => affection >= milestone.min).at(-1);
  return { id: reached?.id ?? 'initial', title: reached?.title ?? '初识',
    next: milestones.find((milestone) => affection < milestone.min) } as const;
}

export const greetingLines = {
  initial: ['今天也一起加油吧。'],
  familiar: ['面包袋上打了个小结。', '放学一起走吧。', '今天的面包好香。'],
  trusted: ['今天排练很顺利。', '这句我敢抬头念了。', '下次也陪我读台本吧。'],
  companion: ['明天的第一句也念给你。', '有你在，我就安心。', '今天想在你身边多待会儿。'],
} as const;

export const practiceLines = ['第一幕，从这里开始。', '明天，也在这里见面吧。', '谢谢你陪我念到最后。'] as const;
