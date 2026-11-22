const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, screen } = require('electron');

const { NAGISA_TEST_DATA: data, NAGISA_QA_ENTRY: entry, NAGISA_QA_RECEIPT: receipt,
  NAGISA_QA_CAPTURE: capture, NAGISA_QA_RESTART: restart } = process.env;
assert(data && entry && receipt);
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const run = (win, expression) => win.webContents.executeJavaScript(expression);
const find = (hash) => BrowserWindow.getAllWindows().find(win => win.isVisible() &&
  (hash ? win.webContents.getURL().endsWith(hash) : win.webContents.getURL().endsWith('/index.html')));
const exists = (win, selector) => run(win, `Boolean(document.querySelector(${JSON.stringify(selector)}))`);

async function until(test, label, limit = 6000) {
  const end = Date.now() + limit;
  do {
    const value = await test();
    if (value) return value;
    await wait(30);
  } while (Date.now() < end);
  throw Error('Timed out waiting for ' + label);
}

const click = (win, selector, type = 'click', count = 1) => run(win, `(() => {
  const button=document.querySelector(${JSON.stringify(selector)});
  for(let i=0;i<${count};i++) button.dispatchEvent(new MouseEvent(${JSON.stringify(type)},{bubbles:true,detail:1}));
})()`);
const key = (win, keyCode) => {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
};
const readText = (win, selector) => run(win, `document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`);
const isVisible = (win, selector) => until(() => exists(win, selector), selector);
const hidden = (win, selector, limit) => until(async () => !(await exists(win, selector)), 'closed ' + selector, limit);
const bread = '[data-food=bread]';
const red = '[data-food=redBeanBread]';
const dango = '[data-food=dangoSnack]';
const strip = '.quick-food-strip';
const card = '.quick-food-card';
const tooltip = '#quick-food-tooltip';
const buy = '.quick-food-checkout button';
const cardSlider = '#quick-food-quantity';
const food = '.quick-menu-button--feed';
const reports = [];

async function accept() {
  const pet = await until(() => find(), 'pet');
  await until(() => run(pet, 'Boolean(window.pet && document.querySelector(".pet"))'), 'pet renderer');
  const care = () => run(pet, 'window.pet.readCare()');
  let id = 0;
  function tap() {
    const n = ++id;
    return run(pet, `window.pet.start(${n},100,100);window.pet.finish(${n},100,100)`);
  }
  async function menuOpen() {
    await tap();
    const menu = await until(() => find('#quick-menu'), 'menu');
    await isVisible(menu, food);
    return menu;
  }
  if (restart) {
    const expected = JSON.parse(fs.readFileSync(path.join(data, 'after-actions.json'), 'utf8'));
    const current = (await care()).state;
    assert.deepEqual(current.inventory, expected.inventory);
    for (const field of ['coins', 'fullness', 'mood', 'affection']) assert.equal(current[field], expected[field]);
    const menu = await menuOpen();
    await click(menu, '.quick-menu-button--study');
    const journal = await until(() => find('#journal'), 'journal after restart');
    await isVisible(journal, '#backpack-heading');
    assert.match(await readText(journal, '.backpack'), /红豆面包 × 2/);
    return ['restart preserves coins, inventory, care, and the journal reads the saved food'];
  }
  const area = screen.getDisplayMatching(pet.getBounds()).workArea;
  pet.setPosition(area.x + Math.floor((area.width - pet.getBounds().width) / 2), area.y + 294);
  await wait(340);
  const originalBounds = pet.getBounds();
  const position = path.join(data, 'pet-position.json');
  const positionBefore = fs.readFileSync(position, 'utf8');
  // Keep a journal open to verify shared state and a concurrent purchase later.
  const firstMenu = await menuOpen();
  await click(firstMenu, '.quick-menu-button--bakery');
  const journal = await until(() => find('#journal'), 'bakery journal');
  await isVisible(journal, '#activity-option-bakery');
  const menu = await menuOpen();
  await run(menu, 'void window.quickMenu.onView(view=>{window.testView=view})');
  await click(menu, food);
  await isVisible(menu, strip);
  await until(async () => (await readText(menu, red)) === '×0', 'empty stock displayed');
  assert.equal(await run(menu, 'document.querySelector(".quick-menu-button--feed").getAttribute("aria-pressed")'), 'true');
  assert.deepEqual(await run(menu, '[...document.querySelectorAll("[data-food]")].map(el=>el.dataset.food)'), ['bread', 'redBeanBread', 'dangoSnack']);
  assert.equal(await run(menu, 'document.querySelector(".quick-food-scroll").disabled'), true);
  assert.deepEqual(pet.getBounds(), originalBounds);
  const menuId = menu.id;

  await run(menu, 'document.querySelector(".quick-food-strip").style.width="175px"');
  await until(() => run(menu, 'document.querySelector(".quick-food-scroll").max > 1'), 'overflow scroll');
  await run(menu, 'document.querySelector(".quick-food-strip").dispatchEvent(new WheelEvent("wheel",{deltaY:400,bubbles:true,cancelable:true}))');
  await until(() => run(menu, 'document.querySelector(".quick-food-items").scrollLeft > 20'), 'vertical-wheel horizontal browsing');
  await run(menu, 'document.querySelector(".quick-food-scroll").focus()');
  key(menu, 'Home');
  await until(() => run(menu, 'document.querySelector(".quick-food-items").scrollLeft === 0'), 'bottom control sync');
  await run(menu, 'document.querySelector(".quick-food-strip").style.removeProperty("width")');
  await until(() => run(menu, 'document.querySelector(".quick-food-scroll").disabled'), 'entire track at wide layout');
  reports.push('all three foods, zero-stock icon, wheel browsing and bottom control use one scroll position');

  const hover = (selector) => run(menu, `document.querySelector(${JSON.stringify(selector)}).dispatchEvent(
    new PointerEvent('pointermove',{pointerType:'mouse',bubbles:true}))`);
  await hover(bread);
  await wait(800);
  await hover(red);
  await wait(300);
  assert.equal(await exists(menu, tooltip), false);
  await isVisible(menu, tooltip);
  assert.match(await readText(menu, tooltip), /红豆面包.*心情 \+3.*饱食度 \+5.*好感 \+0.*已吃完/s);
  await hover(bread);
  await isVisible(menu, tooltip);
  assert.match(await readText(menu, tooltip), /小面包.*心情 \+0.*饱食度 \+5.*好感 \+0/s);
  await click(menu, bread, 'contextmenu');
  await isVisible(menu, card);
  assert.equal((await care()).state.inventory.bread, 1);
  assert.equal((await care()).state.coins, 30);
  key(menu, 'Escape');
  await hidden(menu, card);

  await run(pet, 'window.testFed=[];void window.pet.onFed(id=>window.testFed.push(id))');
  await click(menu, bread);
  await until(async () => (await readText(menu, bread)) === '×0', 'last bread consumed');
  assert.equal(await exists(menu, card), false);
  const fed = (await care()).state;
  assert.equal(fed.fullness, 100);
  assert.equal(fed.coins, 30);
  assert.deepEqual(await run(pet, 'window.testFed'), ['bread']);
  reports.push('one-second timeout resets on a new tile, real cap and daily allowance quoted, right-click is non-mutating, last bread feeds once');

  await click(menu, bread);
  await isVisible(menu, card);
  await wait(9400);
  assert.equal(await exists(menu, card), true);
  await hidden(menu, card, 1600);
  assert.equal(await exists(menu, strip), true);
  await click(menu, red, 'contextmenu');
  await isVisible(menu, card);
  await wait(8800);
  await run(menu, "document.querySelector('.quick-food-card').dispatchEvent(new PointerEvent('pointerover',{pointerType:'mouse',bubbles:true}))");
  await wait(1300);
  assert.equal(await exists(menu, card), true);
  await run(menu, "document.querySelector('.quick-food-card').dispatchEvent(new PointerEvent('pointerout',{pointerType:'mouse',bubbles:true}))");
  await wait(8900);
  assert.equal(await exists(menu, card), true);
  await hidden(menu, card, 1700);
  reports.push('10 seconds outside closes only the card and returning before expiry restarts the countdown on exit');

  await click(menu, red);
  await isVisible(menu, cardSlider);
  await run(menu, `document.querySelector('${cardSlider}').focus()`);
  key(menu, 'Home');
  await until(() => run(menu, `document.querySelector('${buy}').disabled`), 'zero quantity disables purchase');
  key(menu, 'End');
  await until(async () => /购买 · 24 币/.test(await readText(menu, buy)), 'price for two red bean breads');
  assert.match(await readText(menu, '.quick-food-checkout'), /余额 30 币.*买后剩 6 币/);
  if (capture) fs.writeFileSync(capture, (await menu.capturePage()).toPNG());
  await click(menu, buy, 'click', 2);
  await hidden(menu, card);
  await until(async () => (await readText(menu, red)) === '×2', 'restocked red bean breads');
  assert.equal((await care()).state.coins, 6);
  assert.deepEqual(await run(pet, 'window.testFed'), ['bread']);
  const started = await run(journal, '(async()=>{const c=await window.pet.readCare();return window.pet.startActivity("bakery",c.state.revision,c.epoch)})()');
  assert.equal(started.ok, true);
  await click(menu, dango);
  await until(async () => /活动结束后可喂食/.test(await readText(menu, '.quick-food-strip .quick-food-feedback')), 'busy feeding explanation');
  assert.equal((await care()).state.inventory.dangoSnack, 1);
  await click(menu, dango, 'contextmenu');
  await isVisible(menu, card);
  assert.match(await readText(menu, card), /团子点心/);
  const canceled = await run(journal, '(async()=>{const c=await window.pet.readCare();return window.pet.cancelActivity(c.state.activeActivity.id,c.state.revision,c.epoch)})()');
  assert.equal(canceled.ok, true);
  await click(menu, red, 'contextmenu');
  await until(async () => /红豆面包/.test(await readText(menu, card)), 'switch existing purchase card');
  assert.match(await readText(menu, card), /最多 0.*余额不足/s);
  await click(menu, bread, 'contextmenu');
  await until(async () => /最多 1/.test(await readText(menu, card)), 'exactly one affordable');
  const oldCare = await care();
  const updated = await run(journal, '(async()=>{const c=await window.pet.readCare();return window.pet.buyFood("bread",1,c.state.revision,c.epoch)})()');
  assert.equal(updated.ok, true);
  await until(async () => /最多 0/.test(await readText(menu, card)), 'live price clamps after journal purchase');
  const stale = await run(menu, `(() => {
    const {id,foodSession,overlay}=window.testView;
    return window.quickMenu.changeFood(id,foodSession,'bread',${oldCare.state.revision},${oldCare.epoch},{token:overlay.token,quantity:1});
  })()`);
  assert.equal(stale.ok, false);
  assert.match(stale.message, /重新确认/);
  assert.equal((await care()).state.coins, 0);
  reports.push('0 and exact-price limits, 30-to-6 checkout for two, duplicate and stale checks, live journal balance, busy action blocks feeding but allows viewing a purchase');

  key(menu, 'Escape');
  await hidden(menu, card);
  key(menu, 'Escape');
  await hidden(menu, strip);
  key(menu, 'Escape');
  await until(() => !find('#quick-menu'), 'menu closed by third Escape');
  const again = await menuOpen();
  assert.equal(again.id, menuId);
  await click(again, '.quick-menu-button--study');
  assert.equal(journal.id, find('#journal').id);
  assert.deepEqual(pet.getBounds(), originalBounds);
  assert.equal(fs.readFileSync(position, 'utf8'), positionBefore);
  fs.writeFileSync(path.join(data, 'after-actions.json'), JSON.stringify((await care()).state));
  reports.push('three-stage Escape, reused menu and journal, pet position and stored coordinates unchanged');
  return reports;
}

require(entry);
app.whenReady().then(accept).then(
  checks => { fs.writeFileSync(receipt, JSON.stringify({ ok: true, checks }, null, 2)); app.quit(); },
  error => { fs.writeFileSync(receipt, JSON.stringify({ ok: false, error: error.stack }, null, 2)); app.exit(1); },
);
