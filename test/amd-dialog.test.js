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
  assert.ok(content.detail.some((line) => line.includes('AMD Radeon RX 7900 XT')));
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
  assert.ok(content.detail.some((line) => line.includes('NVIDIA GeForce RTX 4090')));
  assert.equal(content.detail.includes('amdFsr4Old'), false);
  assert.equal(content.detail.includes('amdFsr4Ready'), false);
});

test('a mixed machine is judged on its Radeon, not on the whole machine', () => {
  const content = amdDialogContent([RTX4090, RX7900XT], key);
  assert.ok(content.detail.includes('amdFsr4Ready'));
  assert.ok(content.detail.includes('Adrenalin 26.8.1'));
  assert.ok(content.detail.some((line) => line.includes('NVIDIA')), 'both adapters are still listed');
});

test('the dialog never mentions anything that only exists on an NVIDIA card', () => {
  const english = (name) => features.t('en', name);
  const lines = amdDialogContent([RX7900XT], english).detail.join('\n') + '\n' + english('amdConfirm');
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
