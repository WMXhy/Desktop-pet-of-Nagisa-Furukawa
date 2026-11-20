import { createElement as h, useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { foodIds, foods, toyIds, toys } from './care';
import { playChime } from './sound';
import { captureShortcut, defaultSettings, settingsPages, shortcutActions, shortcutIds,
  type Failure, type Settings, type SettingsPage, type SettingsView } from './settings';
import type { TransferAction, TransferPreview, TransferResponse } from './save-transfer';

const labels: Record<keyof Settings, string> = {
  launchAtLogin: '随 Windows 登录启动', showOnStartup: '启动时显示角色', stayInTray: '关闭手账后驻留托盘',
  scale: '角色缩放', opacity: '透明度', onTop: '始终置顶', lockPosition: '锁定位置', displayId: '目标显示器',
  passThrough: '鼠标穿透', allowDrag: '允许拖动角色', bubbleSeconds: '气泡停留', autoGreeting: '主动问候', greetingMinutes: '问候间隔',
  volume: '总音量', soundEffects: '交互音效', reducedMotion: '减少动态效果', fps: '动画刷新上限',
  completionBubble: '活动完成气泡', systemNotifications: '系统通知', quietHours: '启用安静时段', quietStart: '开始时间', quietEnd: '结束时间',
  fullscreenQuiet: '全屏免打扰', fullscreenHide: '全屏时临时隐藏角色', manualQuiet: '手动免打扰', shortcuts: '全局快捷键', onboardingSeen: '使用引导',
};
type BooleanField = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];
type RangeField = 'scale' | 'opacity' | 'bubbleSeconds' | 'greetingMinutes' | 'volume';
const dateTime = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium' });
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function SettingsPanel() {
  const [view, setView] = useState<SettingsView>();
  const [draft, setDraft] = useState<Settings>();
  const [page, setPage] = useState<SettingsPage>('desktop');
  const [error, setError] = useState<Failure>();
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [positionPending, setPositionPending] = useState(false);
  const [restore, setRestore] = useState<readonly (keyof Settings)[]>();
  const [transfer, setTransfer] = useState<TransferPreview>();
  const [confirm, setConfirm] = useState('');
  const baseline = useRef<Settings>(undefined);
  const busyRef = useRef(false);
  const previews = useRef(0);

  function receive(next: SettingsView, reset = false) {
    const previous = baseline.current;
    baseline.current = next.settings;
    setView(next);
    setDraft((current) => {
      if (!current || !previous || reset) return next.settings;
      const keys = Object.keys(next.settings) as (keyof Settings)[];
      return { ...current, ...Object.fromEntries(keys.filter((key) => !equal(previous[key], next.settings[key]))
        .map((key) => [key, next.settings[key]])) };
    });
  }

  async function load() {
    try { receive(await window.pet.readSettings()); }
    catch { setError({ ok: false, message: '暂时无法读取设置。' }); }
  }

  useEffect(() => {
    const off = window.pet.onSettingsChanged(receive);
    void load();
    return off;
  }, []);

  async function run(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(undefined);
    setFeedback('');
    try { await action(); }
    catch (error) {
      console.error('设置操作失败', error);
      setError({ ok: false, message: '操作未完成，请重试。' });
    } finally { busyRef.current = false; setBusy(false); }
  }

  function edit(next: Settings, preview = false) {
    setDraft(next);
    setError(undefined);
    setFeedback('');
    if (!preview) return;
    const request = ++previews.current;
    void window.pet.previewSettings(next).then((result) => {
      if (request === previews.current && result.ok === false) setError(result);
    }).catch(() => { if (request === previews.current) setError({ ok: false, message: '暂时无法预览。' }); });
  }

  function set<K extends keyof Settings>(key: K, value: Settings[K], preview = false) {
    edit({ ...draft, [key]: value }, preview);
  }

  function finishTransfer(result: TransferResponse, success = '') {
    if (result.ok === false) setError(result);
    else if (result.preview) { setTransfer(result.preview); setConfirm(''); }
    else if (success && !result.cancelled) setFeedback(success);
  }

  if (!view || !draft) return h('main', { className: 'settings-loading' },
    h('p', { role: 'status' }, error?.message ?? '正在读取设置…'),
    error && h('button', { type: 'button', onClick: () => { void load(); } }, '重试'));

  function issue(key: Failure['field']) {
    const problem = error?.field === key ? error : view.warning?.field === key ? view.warning : undefined;
    return problem && h('small', { className: 'settings-error', role: 'alert' }, problem.message);
  }

  function toggle(key: BooleanField, note?: string, preview = false) {
    return h('label', { className: 'setting-field', key }, h('span', null, labels[key], note && h('small', null, note), issue(key)),
      h('input', { type: 'checkbox', checked: draft[key], disabled: busy,
        onChange: (event: ChangeEvent<HTMLInputElement>) => set(key, event.target.checked, preview) }));
  }

  function range(key: RangeField, min: number, max: number, unit: string, step = 1) {
    return h('label', { className: 'setting-field', key }, h('span', null, labels[key], issue(key)),
      h('span', { className: 'setting-value' }, h('input', { type: 'range', min, max, step, value: draft[key], disabled: busy,
        onChange: (event: ChangeEvent<HTMLInputElement>) => set(key, Number(event.target.value), true) }),
      h('output', null, `${draft[key]}${unit}`)));
  }

  function time(key: 'quietStart' | 'quietEnd') {
    return h('label', { className: 'setting-field', key }, h('span', null, labels[key], issue(key)),
      h('input', { type: 'time', value: draft[key], disabled: busy,
        onChange: (event: ChangeEvent<HTMLInputElement>) => set(key, event.target.value) }));
  }

  function dataAction(action: TransferAction) {
    void run(async () => { setTransfer(undefined); finishTransfer(await window.pet.previewData(action)); });
  }

  const pages = {
    general: () => [h('div', { className: 'setting-field', key: 'language' }, h('span', null, '语言'), h('span', null, '简体中文')),
      toggle('launchAtLogin'), toggle('showOnStartup', '下次启动时生效。可在托盘找回角色。'),
      toggle('stayInTray', '关闭此选项后，关闭手账会退出桌宠。')],
    desktop: () => [range('scale', 50, 200, '%'), range('opacity', 30, 100, '%'), toggle('onTop', undefined, true),
      toggle('lockPosition', '锁定后仍可轻点问候。', true),
      h('label', { className: 'setting-field', key: 'display' }, h('span', null, labels.displayId, issue('displayId')),
        h('select', { value: draft.displayId ?? '', disabled: busy,
          onChange: (event: ChangeEvent<HTMLSelectElement>) => set('displayId', event.target.value ? Number(event.target.value) : null, true) },
        h('option', { value: '' }, '上次使用'),
        draft.displayId !== null && !view.displays.some(({ id }) => id === draft.displayId) &&
          h('option', { value: draft.displayId }, '显示器已断开，使用主屏'),
        view.displays.map(({ id, label }) => h('option', { key: id, value: id }, label)))),
      h('button', { type: 'button', className: 'settings-secondary', key: 'reset-position', disabled: busy,
        onClick: () => { void run(async () => { await window.pet.resetPositionPreview(); setPositionPending(true); }); } }, '预览重置位置')],
    interaction: () => [toggle('passThrough', '应用后可点击角色身后的窗口。从托盘选择「找回角色」即可取消穿透。'),
      toggle('allowDrag', undefined, true), range('bubbleSeconds', 2, 10, ' 秒'),
      toggle('autoGreeting', '空闲时才会主动问候。'),
      h('label', { className: 'setting-field', key: 'greeting-interval' }, h('span', null, '问候间隔（分钟）', issue('greetingMinutes')),
        h('input', { type: 'number', min: 1, max: 1440, value: draft.greetingMinutes, disabled: busy,
          onChange: (event: ChangeEvent<HTMLInputElement>) => set('greetingMinutes', event.target.valueAsNumber || 1) }))],
    sound: () => [range('volume', 0, 100, '%'), toggle('soundEffects', undefined, true), toggle('reducedMotion', '用代表帧与文字呈现动作。', true),
      h('label', { className: 'setting-field', key: 'fps' }, h('span', null, labels.fps, issue('fps')),
        h('select', { value: draft.fps, disabled: busy,
          onChange: (event: ChangeEvent<HTMLSelectElement>) => set('fps', Number(event.target.value) as Settings['fps'], true) },
        [12, 24, 30].map((fps) => h('option', { key: fps, value: fps }, `${fps} 帧 / 秒`)))),
      h('div', { className: 'settings-actions', key: 'preview' },
        h('button', { type: 'button', className: 'settings-secondary', onClick: () => playChime(draft.volume) }, '试听提示音'),
        h('button', { type: 'button', className: 'settings-secondary', disabled: busy, onClick: () => { void run(async () => {
          const result = await window.pet.previewAnimation();
          if (result.ok === false) setError(result);
        }); } }, '预览角色动作'))],
    focus: () => [h('p', { key: 'status', className: 'settings-notice', role: 'status' }, view.presentation.quiet ? '当前处于安静或免打扰状态。' : '当前允许提醒。'),
      toggle('completionBubble'), toggle('systemNotifications'), toggle('quietHours'), time('quietStart'), time('quietEnd'),
      toggle('fullscreenQuiet', '其他应用全屏时暂停主动提醒。'), toggle('fullscreenHide'), toggle('manualQuiet')],
    shortcuts: () => shortcutIds.map((id) => h('div', { className: 'setting-field', key: id },
      h('label', { htmlFor: `key-${id}` }, shortcutActions[id], issue(`shortcuts.${id}`)),
      h('div', { className: 'setting-value' }, h('input', { id: `key-${id}`, type: 'text', readOnly: true, disabled: busy,
        value: draft.shortcuts[id], placeholder: '聚焦后按组合键',
        onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) return;
          event.preventDefault();
          if (event.key === 'Escape') { event.currentTarget.blur(); return; }
          const key = captureShortcut(event.nativeEvent);
          if (key) set('shortcuts', { ...draft.shortcuts, [id]: key });
        },
      }), h('button', { type: 'button', className: 'settings-secondary', disabled: busy,
        'aria-label': `清空${shortcutActions[id]}的快捷键`, onClick: () => set('shortcuts', { ...draft.shortcuts, [id]: '' }) }, '清空')))),
    data: () => [h('p', { key: 'save' }, `养成进度自动保存。最近保存 ${view.savedAt === null ? '暂无' : dateTime.format(view.savedAt)}`),
      h('div', { className: 'settings-actions data-actions', key: 'data-actions' },
        h('button', { type: 'button', disabled: busy, onClick: () => { void run(async () => finishTransfer(await window.pet.exportData(), '存档已导出。')); } }, '导出存档'),
        h('button', { type: 'button', disabled: busy, onClick: () => dataAction('import') }, '导入预览'),
        h('button', { type: 'button', disabled: busy, onClick: () => dataAction('backup') }, '恢复上次备份'),
        h('button', { type: 'button', className: 'settings-danger', disabled: busy, onClick: () => dataAction('reset') }, '清空养成')),
      h('p', { key: 'privacy', className: 'settings-notice' }, '导出包含养成与可迁移偏好。本机位置、显示器、登录启动与全局快捷键保存在本机。'),
      transfer && h('section', { className: 'settings-confirm', key: 'preview', 'aria-label': '存档替换预览' },
        h('h3', null, transfer.action === 'reset' ? '清空养成预览' : '存档替换预览'),
        h('p', null, `团子币 ${transfer.coins} · 学习点 ${transfer.studyPoints} · 好感 ${transfer.affection} · 关系记录 ${transfer.relationshipEvents} 条`),
        h('p', null, foodIds.map((id) => `${foods[id].name} × ${transfer.inventory[id]}`).join(' · ')),
        h('p', null, toyIds.map((id) => transfer.ownedToys[id] ? toys[id].name : '').filter(Boolean).join(' · ') || '背包暂无玩具'),
        h('p', null, transfer.activity ? `${transfer.activity.label} · 到期 ${dateTime.format(transfer.activity.endsAt)}` : '当前空闲'),
        transfer.action === 'reset' && h('label', null, '重建初始养成并保留桌面偏好。请输入「清空养成」确认。',
          h('input', { type: 'text', value: confirm, onChange: (event: ChangeEvent<HTMLInputElement>) => setConfirm(event.target.value) })),
        h('div', { className: 'settings-actions' },
          h('button', { type: 'button', disabled: busy || (transfer.action === 'reset' && confirm !== '清空养成'),
            onClick: () => { void run(async () => {
              const result = await window.pet.applyData(transfer.token, confirm);
              if (result.ok === false) setError(result);
              else { setTransfer(undefined); setPositionPending(false); receive(await window.pet.readSettings(), true); setFeedback('养成存档已更新。'); }
            }); } }, '确认替换'),
          h('button', { type: 'button', className: 'settings-secondary', disabled: busy,
            onClick: () => { void run(async () => { await window.pet.cancelData(); setTransfer(undefined); }); } }, '取消替换')))],
  };

  const dirty = !equal(draft, view.settings) || positionPending;
  const fields = settingsPages[page].fields as readonly (keyof Settings)[];
  const canRestore = fields.some((key) => !equal(draft[key], defaultSettings[key]));

  return h('main', { className: 'settings-shell' },
    h('nav', { className: 'settings-nav', 'aria-label': '设置分类' },
      h('h1', null, '桌宠设置'),
      (Object.keys(settingsPages) as SettingsPage[]).map((id) => h('button', { key: id, type: 'button',
        'aria-current': page === id ? 'page' : undefined,
        onClick: () => { setPage(id); setRestore(undefined); } }, settingsPages[id].name))),
    h('div', { className: 'settings-main' },
      h('section', { className: 'settings-content', key: page, 'aria-labelledby': 'settings-page' },
        h('h2', { id: 'settings-page' }, settingsPages[page].name),
        !view.settings.onboardingSeen && h('div', { className: 'settings-intro' },
          h('strong', null, '初次使用'),
          h('p', null, '轻点渚打招呼，拖动可移动。右击角色或托盘图标打开手账。开启穿透后，可在托盘选择「找回角色」。'),
          h('div', { className: 'settings-actions' }, ['跳过引导', '完成引导'].map((label) => h('button', { key: label, type: 'button',
            className: 'settings-secondary', disabled: busy, onClick: () => { void run(async () => {
              const result = await window.pet.dismissOnboarding();
              if (result.ok === false) setError(result);
            }); } }, label)))),
        pages[page](),
        restore && h('div', { className: 'settings-confirm' }, h('p', null, `恢复默认值将更改${restore.map((key) => labels[key]).join('、')}。`),
          h('div', { className: 'settings-actions' }, h('button', { type: 'button', onClick: () => {
            edit({ ...draft, ...Object.fromEntries(restore.map((key) => [key, defaultSettings[key]])) }, true);
            setRestore(undefined);
          } }, '预览默认设置'), h('button', { type: 'button', className: 'settings-secondary', onClick: () => setRestore(undefined) }, '返回')))),
      h('footer', { className: 'settings-footer' },
        h('p', { role: error ? 'alert' : 'status', className: error ? 'settings-error' : undefined }, error?.message ?? view.warning?.message ?? feedback),
        h('div', { className: 'settings-actions' },
          fields.length > 0 && h('button', { type: 'button', className: 'settings-secondary', disabled: busy || !canRestore,
            onClick: () => setRestore(fields.filter((key) => !equal(draft[key], defaultSettings[key]))) }, '恢复本页默认'),
          h('button', { type: 'button', className: 'settings-secondary', disabled: busy,
            onClick: () => { void run(async () => { previews.current += 1; receive(await window.pet.cancelSettings(), true);
              setPositionPending(false); setTransfer(undefined); setRestore(undefined); setFeedback('已撤销未应用的修改。'); }); } }, '取消'),
          h('button', { type: 'button', disabled: busy || !dirty, onClick: () => { void run(async () => {
            previews.current += 1;
            const result = await window.pet.applySettings(draft);
            setPositionPending(false);
            if (result.ok === false) setError(result);
            else { receive(result.view, true); setFeedback('设置已应用。'); }
          }); } }, '应用')))));
}
