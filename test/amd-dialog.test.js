'use strict';
// Task 1.10: what the confirmation says before the AMD route installs.
//
// The NVIDIA dialog talks about Blackwell, a driver number and a neural
// rendering model. None of those mean anything on a Radeon, and showing them
// there would be worse than useless: it would tell somebody their perfectly
// capable card is unsupported. So the two are separate, and this file pins
// both that the AMD one says the right things and that the NVIDIA one was
// not touched.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const features = require('../src/shared/feature-i18n');

const MAIN = path.resolve(__dirname, '../main.js');

// Loads main.js with Electron stubbed out, the way driver-barrier.test.js
// does, and hands back what it exported for testing.
function load() {
  const realRequire = createRequire(MAIN);
  const stubs = {
    electron: {
      app: {
        setAppUserModelId() {}, whenReady: () => ({ then() {} }), on() {}, getPath: () => __dirname,
        requestSingleInstanceLock: () => true, quit() {}
      },
      ipcMain: { handle() {}, on() {} },
      BrowserWindow: function () { return { on() {}, once() {}, loadFile() {}, webContents: { on() {}, send() {} } }; },
      Tray: function () { return { setContextMenu() {}, setToolTip() {}, on() {}, isDestroyed: () => false }; },
      Menu: { buildFromTemplate: (t) => t },
      nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
      shell: {}, dialog: {}, clipboard: {}, Notification: function () {}, safeStorage: {}
    }
  };
  const module_ = { exports: {} };
  const context = vm.createContext({
    require: (name) => stubs[name] || realRequire(name),
    module: module_, exports: module_.exports,
    __dirname: path.dirname(MAIN), process, Buffer, console, setTimeout, setInterval, clearInterval
  });
  vm.runInContext(fs.readFileSync(MAIN, 'utf8'), context, { filename: MAIN });
  return module_.exports;
}

const { amdDialogContent } = load();
// An identity translator, so the assertions name the key rather than one
// language's wording and stay readable when the wording is improved.
const key = (name) => name;

const RX7900XT = { name: 'AMD Radeon RX 7900 XT', vendor: 'amd', driver: '32.0.31041.1004', adrenalin: '26.8.1', rdnaGen: 3, mobile: false, fsr4Capable: true };
const RX6800 = { ...RX7900XT, name: 'AMD Radeon RX 6800', rdnaGen: 2, fsr4Capable: false };
const RTX4090 = { name: 'NVIDIA GeForce RTX 4090', vendor: 'nvidia', driver: '616.56', adrenalin: null, rdnaGen: null, mobile: false, fsr4Capable: false };

test('a card that can run FSR 4 is told so, with its adapter and Adrenalin version', () => {
  const content = amdDialogContent([RX7900XT], key);
  assert.equal(content.title, 'OptiScaler');
  assert.equal(content.message, 'amdConfirm');
  assert.ok(content.detail.includes('amdFsr4Ready'));
  assert.equal(content.detail.includes('amdFsr4Old'), false);
  assert.ok(content.detail.includes('AMD Radeon RX 7900 XT'));
  assert.ok(content.detail.includes('Adrenalin 26.8.1'), 'the version that decides FSR 4 on RDNA3');
  // Spread first: the array was built inside the sandbox, so its prototype
  // comes from there and a strict deep compare would reject it on that alone.
  assert.deepEqual([...content.buttons], ['installOpti', 'cancel']);
  assert.equal(content.cancelId, 1, 'cancel is the default answer');
});

test('a card that cannot run FSR 4 is told that plainly, and what it gets instead', () => {
  const content = amdDialogContent([RX6800], key);
  assert.ok(content.detail.includes('amdFsr4Old'));
  assert.equal(content.detail.includes('amdFsr4Ready'), false);
  // The wording has to name the fallback, or the person is left guessing.
  assert.match(features.t('en', 'amdFsr4Old'), /FSR 3\.1/);
});

test('with no adapter detected, nothing is claimed about the card', () => {
  const content = amdDialogContent([], key);
  assert.ok(content.detail.includes('errOptiHardware'));
  assert.equal(content.detail.includes('amdFsr4Ready'), false);
  assert.equal(content.detail.includes('amdFsr4Old'), false, 'saying the card is too old would be a guess');
  assert.deepEqual(amdDialogContent(null, key).detail, content.detail);
});

test('an NVIDIA-only machine reaching this dialog is not told its card is too old', () => {
  // This should not happen, because the route is never offered there. If it
  // does, silence about the card is the honest answer.
  const content = amdDialogContent([RTX4090], key);
  assert.ok(content.detail.includes('NVIDIA GeForce RTX 4090'));
  assert.equal(content.detail.includes('amdFsr4Old'), false);
  assert.equal(content.detail.includes('amdFsr4Ready'), false);
});

test('a mixed machine is judged on its Radeon, not on the whole machine', () => {
  const content = amdDialogContent([RTX4090, RX7900XT], key);
  assert.ok(content.detail.includes('amdFsr4Ready'));
  assert.ok(content.detail.includes('Adrenalin 26.8.1'));
  assert.ok(content.detail.includes('NVIDIA'), 'both adapters are still listed');
});

test('the dialog never mentions anything that only exists on an NVIDIA card', () => {
  const english = (name) => features.t('en', name);
  const lines = amdDialogContent([RX7900XT], english).detail + '\n' + english('amdConfirm');
  for (const wrong of ['Blackwell', 'RTX', 'nvngx', 'DLSS', '616.56', 'neural']) {
    assert.equal(new RegExp(wrong, 'i').test(lines), false, `${wrong} has no business in the AMD dialog`);
  }
});

test('the anti-cheat and download promises are actually made, in every language', () => {
  const content = amdDialogContent([RX7900XT], key);
  assert.ok(content.detail.includes('amdHint'));
  assert.ok(content.detail.includes('amdAntiCheatHint'));
  for (const { code } of [{ code: 'en' }, { code: 'de' }, { code: 'ja' }, { code: 'ar' }, { code: 'pl' }]) {
    for (const name of ['amdConfirm', 'amdFsr4Ready', 'amdFsr4Old', 'amdHint', 'amdAntiCheatHint',
      'routeAmdOptiscaler', 'routeEngineUpscale', 'routeAmdDriver', 'routeSpatial']) {
      const value = features.t(code, name);
      assert.equal(typeof value, 'string', `${code}.${name}`);
      assert.ok(value.trim().length > 0, `${code}.${name}`);
      assert.notEqual(value, name, `${code}.${name} fell back to its own key`);
    }
  }
});

test('the NVIDIA dialog is left exactly as it was', () => {
  const source = fs.readFileSync(MAIN, 'utf8');
  // The whole point of a separate AMD dialog is that this one does not change.
  assert.match(source, /title: 'OptiScaler DLSS-NR'/);
  assert.match(source, /message: featureText\('optiConfirm'\)/);
  assert.match(source, /oldCard \? featureText\('optiCardOld'\) : null/);
  assert.match(source, /oldDriver \? featureText\('optiDriverOld'\) : null/);
});

test('every AMD route in the registry has a label that resolves to real text', () => {
  const { ROUTE_META } = require('../src/shared/install-routes');
  for (const [route, meta] of Object.entries(ROUTE_META)) {
    if (meta.vendor !== 'amd') continue;
    const label = features.t('en', meta.label);
    assert.notEqual(label, meta.label, `${route} label ${meta.label} has no translation`);
    assert.ok(label.trim().length > 0, route);
  }
});

// ---------------------------------------------------------------------------
// Task 7.2: the shape Electron actually accepts.
//
// The install reached this dialog and died with "Detail must be a string".
// `detail` was built as an array and never joined, and the tests above
// asserted against the array, so they pinned the one shape that cannot work.
// The NVIDIA dialog this was copied from joins with a blank line; the copy
// lost the last call.
//
// A test that agrees with the bug is worse than no test, because it is read as
// evidence. These check the contract with Electron rather than my own idea of
// it.

test('every field Electron is handed has the type Electron demands', () => {
  // showMessageBox validates these and throws on anything else, which aborts
  // the install with a message about the dialog rather than about the game.
  for (const rows of [[RX7900XT], [RX6800], [RTX4090], [], null]) {
    const content = amdDialogContent(rows, key);
    assert.equal(typeof content.title, 'string', 'title');
    assert.equal(typeof content.message, 'string', 'message');
    assert.equal(typeof content.detail, 'string', `detail for ${JSON.stringify(rows)}`);
    assert.equal(typeof content.type, 'string', 'type');
    assert.ok(Array.isArray(content.buttons), 'buttons is a list');
    for (const button of content.buttons) assert.equal(typeof button, 'string', 'each button');
    assert.equal(typeof content.defaultId, 'number');
    assert.equal(typeof content.cancelId, 'number');
  }
});

test('the joined detail keeps every line separate rather than running them together', () => {
  const content = amdDialogContent([RX7900XT], key);
  const lines = content.detail.split('\n\n');
  assert.ok(lines.length >= 5, `expected several paragraphs, got ${lines.length}`);
  assert.ok(lines.every((line) => line.trim()), 'no empty paragraph from a dropped entry');
  assert.doesNotMatch(content.detail, /\[object|undefined|null/, 'nothing half-formatted');
});

test('the AMD dialog is built the same way as the NVIDIA one it was copied from', () => {
  // The two were meant to be twins. Reading main.js for it is crude, but it is
  // what would have caught this: one joined, the other did not.
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const joins = source.split('.filter(Boolean).join(').length - 1;
  assert.ok(joins >= 2, `both dialogs join their detail lines, found ${joins}`);
});
