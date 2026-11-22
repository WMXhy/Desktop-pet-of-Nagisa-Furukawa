const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, screen } = require('electron');

const { NAGISA_TEST_DATA: data, NAGISA_QA_ENTRY: entry, NAGISA_QA_RECEIPT: receipt,
  NAGISA_QA_CAPTURE: capture, NAGISA_QA_BASELINE: baseline } = process.env;
assert(data && entry && receipt);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = (win, source) => win.webContents.executeJavaScript(source);
const find = (hash) => BrowserWindow.getAllWindows().find((win) => win.isVisible() &&
  (hash ? win.webContents.getURL().endsWith(hash) : win.webContents.getURL().endsWith('/index.html')));
const exists = (win, selector) => run(win, `Boolean(document.querySelector(${JSON.stringify(selector)}))`);
const text = (win, selector) => run(win, `document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`);
const rect = (win, selector) => run(win, `document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`);
const click = (win, selector, type = 'click') => run(win, `void document.querySelector(${JSON.stringify(selector)}).dispatchEvent(
  new MouseEvent(${JSON.stringify(type)}, { bubbles: true, button: ${type === 'contextmenu' ? 2 : 0}, detail: 1 }))`);
const side = '.quick-menu-button--feed';
const food = '.quick-food-strip';
const card = '.quick-food-card';
const tip = '.quick-food-tip';
const bread = '[data-food=bread]';
const red = '[data-food=redBeanBread]';
const dango = '[data-food=dangoSnack]';
const slider = '#quick-food-quantity';
const reports = [];

async function until(predicate, label, ms = 6000) {
  const end = Date.now() + ms;
  do {
    const item = await predicate();
    if (item) return item;
    await wait(30);
  } while (Date.now() < end);
  throw Error('Timed out waiting for ' + label);
}

async function accept() {
  let cursor;
  let elapsed = 0;
  const sample = screen.getCursorScreenPoint.bind(screen);
  Object.defineProperty(screen, 'getCursorScreenPoint', { value: () => cursor ?? sample(), configurable: true });
  const clock = performance.now.bind(performance);
  Object.defineProperty(performance, 'now', { value: () => clock() + elapsed, configurable: true });
  const pet = await until(() => find(), 'pet');
  await until(() => exists(pet, '.pet'), 'pet renderer');
  const area = screen.getDisplayMatching(pet.getBounds()).workArea;
  const length = pet.getBounds().width;
  pet.setPosition(area.x + Math.floor((area.width - length) / 2), area.y + 300);
  await wait(360);
  const original = pet.getBounds();
  const saved = fs.readFileSync(path.join(data, 'pet-position.json'), 'utf8');
  const initial = (await run(pet, 'window.pet.readCare()')).state;
  const petCenter = { x: original.x + Math.floor(length / 2), y: original.y + Math.floor(length / 2) };
  cursor = petCenter;
  let action = 0;
  async function open() {
    const id = ++action;
    assert.equal((await run(pet, `window.pet.start(${id},10,10);window.pet.finish(${id},10,10)`)).greet, true);
    const menu = await until(() => find('#quick-menu'), 'side menu');
    await until(() => exists(menu, side), 'four side buttons');
    return menu;
  }
  const menu = await open();
  const menuId = menu.id;
  if (!baseline) {
    await wait(9000);
    assert.equal(menu.isVisible(), true);
    await until(() => !menu.isVisible(), 'real ten-second root timeout', 2200);
    reports.push('first opening closes after ten real seconds with the pointer on the pet');
    const reused = await open();
    assert.equal(reused.id, menuId);
  }

  async function nudge() {
    await run(menu, 'document.dispatchEvent(new PointerEvent("pointermove", {bubbles:true,pointerType:"mouse"}))');
    await wait(95);
  }
  async function at(selector, vertical = 0.45) {
    const box = await rect(menu, selector);
    const { x, y } = menu.getBounds();
    const local = { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height * vertical) };
    cursor = { x: x + local.x, y: y + local.y };
    await nudge();
    return local;
  }
  async function tick(ms) { elapsed += ms; await nudge(); }
  async function visible(selector) { await until(() => exists(menu, selector), selector); }
  async function gone(selector) { await until(async () => !(await exists(menu, selector)), 'closed ' + selector); }
  async function foodBar() {
    await at(side);
    await click(menu, side);
    await visible(food);
    await until(async () => await text(menu, bread) === '×1', 'seeded inventory');
    if (!baseline) await until(() => run(menu, 'document.querySelector(".quick-food-strip").offsetHeight === 77'), 'compact food bar');
  }
  if (!baseline) {
    await at(side);
    await tick(15_100);
    assert.equal(menu.isVisible(), true, 'the pointer retained the side buttons past their deadline');
  }
  await foodBar();
  const compact = await rect(menu, food);
  const browse = await rect(menu, '.quick-food-scroll');
  const tile = await rect(menu, '.quick-food-items');
  const metrics = { panel: compact.height, browse: browse.height, food: tile.height,
    railToBottom: compact.bottom - (browse.top + (browse.height + 5) / 2) };
  assert.deepEqual(metrics, { panel: baseline ? 96 : 77, browse: 13, food: 54, railToBottom: baseline ? 28 : 9 });
  if (capture) fs.writeFileSync(capture, (await menu.capturePage({
    x: compact.x, y: compact.y, width: compact.width, height: compact.height,
  })).toPNG());
  if (baseline) return [JSON.stringify(metrics)];
  reports.push('compact height 77 DIP, 54 DIP tiles and 13 DIP browser, 9 DIP below the visible rail');
  const anchoredBottom = menu.getBounds().y + compact.bottom;
  await at(bread);
  await click(menu, bread);
  await until(async () => /已喂一个小面包/.test(await text(menu, '.quick-food-strip-feedback')), 'successful feed feedback');
  await until(async () => (await rect(menu, food)).height === 94, 'feedback height');
  assert.equal(menu.getBounds().y + (await rect(menu, food)).bottom, anchoredBottom);
  await until(async () => (await rect(menu, food)).height === 77, 'success clears after three seconds');
  await at(dango);
  await click(menu, dango);
  await until(async () => /渚已经吃饱了/.test(await text(menu, '.quick-food-strip-feedback')), 'fullness feedback');
  await until(async () => (await rect(menu, food)).height === 94, 'error feedback height');
  const status = await run(menu, `(() => {
    const e=document.querySelector('.quick-food-strip-feedback');
    return { scroll:e.scrollWidth,width:e.clientWidth,role:e.getAttribute('role') };
  })()`);
  assert.equal(status.role, 'status');
  assert.ok(status.scroll <= status.width);
  reports.push('feedback height 94 DIP with anchored bottom, readable fullness message and compact return after success');

  await at(food, 0.9);
  await tick(130);
  await at(side);
  await tick(8750);
  await visible(food);
  await at(food, 0.9);
  await tick(1400);
  await visible(food);
  await at(side);
  await tick(8600);
  await visible(food);
  await tick(1500);
  await gone(food);
  await tick(16_000);
  assert.equal(menu.isVisible(), true);
  reports.push('returning restarts the child timeout while the retained side buttons remain open');

  await click(menu, side);
  await visible(food);
  await at(red);
  await click(menu, red, 'contextmenu');
  await visible(card);
  await at(card);
  await tick(16_000);
  await visible(card);
  await visible(food);
  await at(food, 0.95);
  await tick(10_150);
  await gone(card);
  await visible(food);
  reports.push('the purchase card protects both ancestors; returning to the bar closes only the card');

  await at(red);
  await run(menu, `document.querySelector('${red}').dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'mouse'}))`);
  await wait(750);
  await gone(tip);
  await visible(tip);
  assert.match(await text(menu, tip), /红豆面包/);
  await run(menu, `document.querySelector('${red}').dispatchEvent(new PointerEvent('pointerout',{bubbles:true,pointerType:'mouse'}))`);
  await at(tip);
  await tick(13_000);
  await visible(tip);
  await at(dango);
  await run(menu, `document.querySelector('${dango}').dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'mouse'}))`);
  await gone(tip);
  await visible(tip);
  assert.match(await text(menu, tip), /团子点心/);
  reports.push('tooltip waits one second, stays readable when reached, then switches to the correct item');

  await click(menu, red, 'contextmenu');
  await visible(card);
  await at(food, 0.95);
  await tick(8900);
  await click(menu, dango, 'contextmenu');
  await until(async () => /团子点心/.test(await text(menu, card)), 'replacement card');
  await tick(1700);
  await visible(card);
  await at(card);
  const cardRect = await rect(menu, card);
  const stripRect = await rect(menu, food);
  const origin = menu.getBounds();
  cursor = { x: origin.x + Math.round(cardRect.left + cardRect.width / 2), y: origin.y + Math.round((cardRect.bottom + stripRect.top) / 2) };
  await nudge();
  await tick(10_200);
  await until(() => !menu.isVisible(), 'transparent gap closes the entire hierarchy');
  reports.push('old card deadline cannot close its replacement and transparent gap closes all layers together');

  cursor = petCenter;
  await open();
  await click(menu, side);
  await visible(food);
  await at(red);
  await click(menu, red, 'contextmenu');
  await visible(card);
  const start = await at(slider, 0.5);
  menu.focus();
  menu.webContents.focus();
  menu.webContents.sendInputEvent({ type: 'mouseDown', ...start, button: 'left', clickCount: 1 });
  await wait(120);
  const localRelease = { x: 4, y: (await rect(menu, food)).bottom + 13 };
  const frame = menu.getBounds();
  cursor = { x: frame.x + localRelease.x, y: frame.y + localRelease.y };
  menu.webContents.sendInputEvent({ type: 'mouseMove', ...localRelease, modifiers: ['leftbuttondown'] });
  await tick(12_500);
  await visible(card);
  menu.webContents.sendInputEvent({ type: 'mouseUp', ...localRelease, button: 'left', clickCount: 1 });
  await wait(120);
  await tick(8900);
  await visible(card);
  await tick(1400);
  await until(() => !menu.isVisible(), 'released outside then timed out');
  reports.push('slider held outside for 12.5 simulated seconds protects every layer until release');

  cursor = petCenter;
  await open();
  await click(menu, side);
  await visible(food);
  await at(red);
  await click(menu, red, 'contextmenu');
  await visible(card);
  await run(menu, `document.querySelector('${slider}').focus()`);
  menu.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
  menu.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
  cursor = petCenter;
  await tick(12_000);
  await visible(card);
  for (const selector of [card, food, side]) {
    menu.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    menu.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    if (selector === side) await until(() => !menu.isVisible(), 'Esc closes menu');
    else await gone(selector);
  }
  assert.deepEqual(pet.getBounds(), original);
  assert.equal(fs.readFileSync(path.join(data, 'pet-position.json'), 'utf8'), saved);
  const final = (await run(pet, 'window.pet.readCare()')).state;
  assert.equal(final.coins, initial.coins);
  assert.deepEqual(final.inventory, { ...initial.inventory, bread: 0 });
  reports.push('keyboard retains its layer; three Esc presses still close one layer at a time; waits do not change care or saved position');
  return reports;
}

require(entry);
app.whenReady().then(accept).then(
  (checks) => { fs.writeFileSync(receipt, JSON.stringify({ ok: true, checks }, null, 2)); app.quit(); },
  (error) => { fs.writeFileSync(receipt, JSON.stringify({ ok: false, checks: reports, error: error.stack }, null, 2)); app.exit(1); },
);
