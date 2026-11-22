const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, screen } = require('electron');

const entry = process.env.NAGISA_QA_ENTRY;
const directory = process.env.NAGISA_TEST_DATA;
const receipt = process.env.NAGISA_QA_RECEIPT;
assert(entry && directory && receipt, 'Acceptance must supply a module, disposable data directory and receipt.');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const find = (page) => BrowserWindow.getAllWindows().find((win) => new URL(win.webContents.getURL() || 'about:blank').hash === page);
const run = (win, expression) => win.webContents.executeJavaScript(expression);

async function waitFor(fn, label) {
  const deadline = Date.now() + 6000;
  do {
    const result = await fn();
    if (result) return result;
    await sleep(40);
  } while (Date.now() < deadline);
  throw new Error('Timed out waiting for ' + label);
}

async function accept() {
  const pet = await waitFor(() => BrowserWindow.getAllWindows().find((win) =>
    win.isVisible() && win.webContents.getURL().endsWith('/index.html')), 'pet window');
  await waitFor(() => run(pet, 'Boolean(window.pet && document.querySelector(".pet"))'), 'pet renderer');
  const care = () => run(pet, 'window.pet.readCare()');
  const reports = [];
  let id = 0;

  function tap(dx = 0, requestGreeting = false) {
    const action = ++id;
    return run(pet, `(async () => {
      window.pet.start(${action}, 100, 100);
      const result = await window.pet.finish(${action}, ${100 + dx}, 100);
      return ${requestGreeting} && result.greet ? { ...result, reward: await window.pet.greetToday() } : result;
    })()`);
  }
  const menu = () => waitFor(() => {
    const win = find('#quick-menu');
    return win?.isVisible() && win;
  }, 'open quick menu');
  const closed = () => waitFor(() => !find('#quick-menu')?.isVisible(), 'closed quick menu');
  const pick = (win, action, count = 1) => run(win, `(() => {
    const button = document.querySelector('.quick-menu-button--${action}');
    for (let i = 0; i < ${count}; i++) button.click();
  })()`);
  const journal = () => waitFor(() => find('#journal')?.isVisible() && find('#journal'), 'journal');
  const inView = (win, selector) => waitFor(() => run(win, `(() => {
    const item = document.querySelector(${JSON.stringify(selector)});
    if (!item) return false;
    const rect = item.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= innerHeight;
  })()`), selector);

  const region = screen.getDisplayMatching(pet.getBounds()).workArea;
  const size = pet.getBounds().width;
  pet.setPosition(region.x + Math.floor((region.width - size) / 2), region.y + Math.floor((region.height - size) / 2));
  pet.focus();
  await sleep(350);
  const positionPath = path.join(directory, 'pet-position.json');
  const savedPosition = fs.readFileSync(positionPath, 'utf8');
  const original = pet.getBounds();
  const greetingBefore = (await care()).state;
  const first = await tap(0, true);
  assert.equal(first.greet, true);
  assert.equal(first.reward.ok, true);
  const firstMenu = await menu();
  const menuId = firstMenu.id;
  assert.deepEqual(await run(firstMenu, '[...document.querySelectorAll("button")].map(b=>b.textContent)'), ['喂食', '打工', '学习', '游戏']);
  assert.deepEqual(firstMenu.getBounds(), { x: original.x + size + 2, y: original.y + Math.round((size - 188) / 2),
    width: 82, height: 188 });
  pet.focus();
  assert.equal((await tap()).greet, false);
  await closed();
  const again = await tap(0, true);
  assert.equal(again.reward.gained, null);
  await menu();
  await tap();
  await closed();
  assert.equal((await care()).state.affection, greetingBefore.affection + (first.reward.gained ?? 0));
  for (let i = 0; i < 20; i++) {
    assert.equal((await tap()).greet, true);
    assert.equal((await menu()).id, menuId);
    assert.equal((await tap()).greet, false);
    await closed();
  }
  assert.equal(BrowserWindow.getAllWindows().filter(w => w.webContents.getURL().endsWith('#quick-menu')).length, 1);
  assert.deepEqual(pet.getBounds(), original);
  assert.equal(fs.readFileSync(positionPath, 'utf8'), savedPosition);
  reports.push('four labels, 20 open/close cycles, one reused menu, unchanged position and single daily greeting');

  assert.equal((await tap(5)).greet, true);
  await menu();
  assert.deepEqual(pet.getBounds(), original);
  assert.equal((await tap(6)).greet, false);
  await closed();
  assert.equal(pet.getBounds().x, original.x + 6);
  pet.setPosition(region.x + region.width - size, region.y);
  await tap();
  const side = await menu();
  assert.equal(side.getBounds().x + side.getBounds().width + 2, pet.getBounds().x);
  assert.ok(side.getBounds().y >= region.y);
  await tap();
  await closed();
  reports.push('5/6 logical-pixel threshold and left-side fallback at screen edge');

  const snapshot = (await care()).state;
  await tap();
  await pick(await menu(), 'feed', 2);
  const book = await journal();
  await inView(book, '#backpack-heading');
  assert.equal(BrowserWindow.getAllWindows().filter(w => w.webContents.getURL().endsWith('#journal')).length, 1);
  await run(book, 'Array.from(document.querySelectorAll(".journal-nav button"))[1].click()');
  await waitFor(() => run(book, 'document.querySelectorAll(".journal-nav button")[1].getAttribute("aria-pressed")==="true"'), 'snack tab');
  await tap();
  await pick(await menu(), 'bakery');
  assert.equal((await journal()).id, book.id);
  await inView(book, '#activity-option-bakery');
  await tap();
  await pick(await menu(), 'study');
  await inView(book, '#activity-option-study');
  await tap();
  await pick(await menu(), 'game');
  const game = await waitFor(() => find('#dango-game')?.isVisible() && find('#dango-game'), 'game window');
  const afterActions = await care();
  assert.deepEqual(afterActions.state.inventory, snapshot.inventory);
  assert.equal(afterActions.state.energy, snapshot.energy);
  assert.equal(afterActions.state.activeActivity, null);
  assert.equal(afterActions.gameBusy, false);
  reports.push('all four destinations, journal returns from another tab, no food, energy, or activity changed by navigation');

  const started = await run(book, '(async () => { const s=await window.pet.readCare(); return window.pet.startActivity("bakery",s.state.revision,s.epoch); })()');
  assert.equal(started.ok, true);
  await tap();
  await pick(await menu(), 'study');
  await inView(book, '#activities-heading');
  assert.equal((await care()).state.activeActivity.id, started.state.activeActivity.id);
  const canceled = await run(book, '(async () => { const s=await window.pet.readCare(); return window.pet.cancelActivity(s.state.activeActivity.id,s.state.revision,s.epoch); })()');
  assert.equal(canceled.ok, true);
  await run(game, 'Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("开始")).click()');
  await waitFor(async () => (await care()).gameBusy, 'active game round');
  await tap();
  await pick(await menu(), 'game');
  assert.equal(find('#dango-game').id, game.id);
  assert.equal((await care()).gameBusy, true);
  reports.push('busy study routes to active work, existing game round remains in the same window');

  await tap();
  const dismiss = await menu();
  book.focus();
  await closed();
  await tap();
  (await menu()).webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  await closed();
  assert.equal(dismiss.id, menuId);
  reports.push('losing focus to a different window and Esc dismiss the reused menu');
  return reports;
}

require(entry);
app.whenReady().then(accept).then(
  (checks) => { fs.writeFileSync(receipt, JSON.stringify({ ok: true, checks }, null, 2)); app.quit(); },
  (error) => { fs.writeFileSync(receipt, JSON.stringify({ ok: false, error: error.stack }, null, 2)); app.exit(1); },
);
