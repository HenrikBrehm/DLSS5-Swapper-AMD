'use strict';
// Task 7.1: the seam between the interface and the AMD installer.
//
// Every piece of the AMD route had tests and all of them passed. The route
// itself, the configuration it writes, the download, the restore, 568 green.
// And pressing Install in the interface produced:
//
//   failed: The payload is missing or incomplete at ...\payload.
//
// The payload is the NVIDIA half. The AMD routes never touch it; they fetch
// OptiScaler themselves and check its hash. The gate refused before it had
// even worked out which route was asked for.
//
// Behind that were five more, all in the same twenty lines of main.js, none
// reachable by any test that exercised a module on its own:
//
//   - routesFor was called without the adapter, so the AMD routes were never
//     among the ones an install could choose. Even with the payload present,
//     asking for amd-optiscaler would have silently installed a NVIDIA route.
//   - optiRoot was fetched for amd-optiscaler only, so tier 2 had no payload
//     at all.
//   - the installer was handed no adapter, so it resolved FSR 3.1 instead of
//     FSR 4.
//   - it was handed no upscaler inventory, so it did not switch on the DXGI
//     spoofing, and a game that only ships DLSS would have gone on hiding the
//     option on a Radeon - which is exactly the symptom that started this.
//   - it was handed no engine, so tier 2 would have thrown.
//
// These tests drive the handler itself. That is the only place any of this
// was visible.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const MAIN = path.resolve(__dirname, '../main.js');
const RDNA3 = { name: 'AMD Radeon RX 7900 XT', vendor: 'amd', driver: '32.0.31041.1004', adrenalin: '26.8.1', rdnaGen: 3, mobile: false, fsr4Capable: true };
const RTX = { name: 'NVIDIA GeForce RTX 4090', vendor: 'nvidia', driver: '616.56', rdnaGen: null, mobile: false, fsr4Capable: false };
const DLSS_ONLY = { dlss: true, dlssg: false, streamline: false, fsr2: false, fsr31: false, fsr31Signed: false, fsrfg: false, xess: false, any: true };
const NOTHING = { dlss: false, dlssg: false, streamline: false, fsr2: false, fsr31: false, fsr31Signed: false, fsrfg: false, xess: false, any: false };
const UNREAL = { engine: 'unreal', version: '5.1.0', projectName: 'Proj', configDir: 'C:\\Users\\x\\AppData\\Local\\Proj\\Saved\\Config\\Windows', upscalerSlot: true };
const NO_ENGINE = { engine: 'unknown', version: null, projectName: null, configDir: null, upscalerSlot: false };

// main.js with Electron and everything that touches a disk stubbed. `payload`
// defaults to absent, because that is the state a source checkout is in and
// the state the report came from.
function load({ rows = [RDNA3], upscalers = DLSS_ONLY, engine = NO_ENGINE, payloadPresent = false, api = 'dxgi', apiLabel = 'DirectX 12' } = {}) {
  const realRequire = createRequire(MAIN);
  const handlers = new Map();
  const calls = { install: [], dialogs: [], upstream: 0 };
  const chosen = {
    rel: 'bin\\Game.exe', path: 'C:\\Games\\X\\bin\\Game.exe', name: 'Game.exe',
    api, apiLabel, bitness: 64, size: 1024, upscalers, engine
  };
  const realScan = realRequire('./src/core/scan.js');
  const stubs = {
    electron: {
      app: { setAppUserModelId() {}, whenReady: () => ({ then() {} }), on() {}, getPath: () => __dirname,
        requestSingleInstanceLock: () => true, quit() {}, getVersion: () => '0.0.0', isPackaged: false },
      ipcMain: { handle: (name, fn) => handlers.set(name, fn), on() {} },
      BrowserWindow: function () { return { on() {}, once() {}, loadFile() {}, webContents: { on() {}, send() {} } }; },
      Tray: function () { return { setContextMenu() {}, setToolTip() {}, on() {}, isDestroyed: () => false }; },
      Menu: { buildFromTemplate: (t) => t }, nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
      shell: {}, clipboard: {}, Notification: function () {}, safeStorage: {},
      // Validating, because a stub more forgiving than the real thing is how
      // "Detail must be a string" got through ten green tests and straight
      // into the first install anybody tried. Electron checks these and
      // throws; so does this.
      dialog: {
        showMessageBox: async (_win, options) => {
          for (const field of ['title', 'message', 'detail', 'type']) {
            if (options[field] !== undefined && typeof options[field] !== 'string') {
              throw new TypeError(`${field[0].toUpperCase()}${field.slice(1)} must be a string`);
            }
          }
          for (const button of options.buttons || []) {
            if (typeof button !== 'string') throw new TypeError('Button must be a string');
          }
          calls.dialogs.push(options);
          return { response: 0 };
        }
      }
    },
    './src/core/install-guards': {
      ...realRequire('./src/core/install-guards'),
      gpuInfo: async () => rows,
      assertGameClosed: async () => {}
    },
    './src/core/scan.js': {
      ...realScan,
      scanGame: async () => ({ chosen, exeCandidates: [chosen], dlssFiles: [], streamlineFiles: [], primaryDlss: null, install: null }),
      // This is what payload() probes. Absent by default.
      scanSource: () => (payloadPresent ? { ok: true, addon: 'C:\\p\\addon.dll', feeder: { ok64: true, ok32: true } } : { ok: false })
    },
    './src/core/compatibility': {
      ...realRequire('./src/core/compatibility'),
      hasAntiCheat: () => false, assertSafeTarget: () => {}, targetIssue: () => null
    },
    './src/core/engine-detect': { ...realRequire('./src/core/engine-detect'), detectEngine: () => engine },
    './src/core/optiscaler': { ...realRequire('./src/core/optiscaler'), checkConflicts: () => {} },
    './src/core/optiscaler-upstream': {
      ...realRequire('./src/core/optiscaler-upstream'),
      ensureOptiScalerUpstream: async () => { calls.upstream += 1; return 'C:\\cache\\opti'; }
    },
    './src/core/runtime-components.js': {
      ...realRequire('./src/core/runtime-components.js'),
      missingVCRuntime: () => []
    },
    './src/core/backend-manager': {
      ...realRequire('./src/core/backend-manager'),
      readManifest: () => null,
      install: async (config) => { calls.install.push(config); return { route: config.route, game: { exe: chosen.rel }, added: [] }; }
    },
    './src/core/history': { HistoryStore: function () { return { list() {}, add() {} }; } }
  };
  const module_ = { exports: {} };
  const context = vm.createContext({
    require: (name) => (Object.hasOwn(stubs, name) ? stubs[name] : realRequire(name)),
    module: module_, exports: module_.exports,
    __dirname: path.dirname(MAIN), process, Buffer, console, setTimeout, setInterval, clearInterval, URL
  });
  vm.runInContext(fs.readFileSync(MAIN, 'utf8'), context, { filename: MAIN });
  return { handlers, calls };
}

const install = (options, route) => {
  const { handlers, calls } = load(options);
  return handlers.get('install')({ sender: { send() {} } }, 'C:\\Games\\X', 'C:\\Games\\X\\bin\\Game.exe', route)
    .then((result) => ({ result, calls }));
};

test('the missing NVIDIA payload does not block an AMD install', async () => {
  // The exact failure that came back from the interface.
  const { result, calls } = await install({}, 'amd-optiscaler');
  assert.notEqual(result && result.code, 'errPayloadMissing');
  assert.ok(!(result && result.message && /payload is missing/i.test(result.message)),
    `refused with: ${result && result.message}`);
  assert.equal(calls.install.length, 1, 'the installer actually ran');
});

test('the AMD route survives route resolution instead of being swapped for a NVIDIA one', async () => {
  // routesFor was called without the adapter, so amd-optiscaler was not among
  // the routes an install could pick and quietly became `native`.
  const { calls } = await install({}, 'amd-optiscaler');
  assert.equal(calls.install[0].route, 'amd-optiscaler');
});

test('the installer is handed the adapter, which is what decides FSR 4 over FSR 3.1', async () => {
  const { calls } = await install({}, 'amd-optiscaler');
  const config = calls.install[0];
  assert.ok(config.gpu, 'an adapter reached the installer');
  assert.equal(config.gpu.vendor, 'amd');
  assert.equal(config.gpu.fsr4Capable, true, 'without this it resolves to FSR 3.1');

  const upstream = require('../src/core/optiscaler-upstream');
  assert.equal(upstream.resolveOptions(config, config.gpu, {}).output, 'fsr4');
});

test('the installer is handed the upscaler inventory, which is what switches on the spoofing', async () => {
  // A game that only ships DLSS has to be told it is talking to an NVIDIA
  // card, or it goes on hiding the option on a Radeon. Without the inventory
  // the installer saw no DLSS and wrote no spoofing, so the install would
  // have completed and changed nothing a person could see.
  const { calls } = await install({}, 'amd-optiscaler');
  const config = calls.install[0];
  assert.ok(config.upscalers, 'the inventory reached the installer');
  assert.equal(config.upscalers.dlss, true);

  const upstream = require('../src/core/optiscaler-upstream');
  assert.equal(upstream.resolveOptions(config, config.gpu, {}).inputs, 'dxgi-spoof');
});

test('a game that ships FSR needs no spoofing, and does not get it', async () => {
  const { calls } = await install({ upscalers: { ...NOTHING, fsr31: true, any: true } }, 'amd-optiscaler');
  const upstream = require('../src/core/optiscaler-upstream');
  assert.equal(upstream.resolveOptions(calls.install[0], calls.install[0].gpu, {}).inputs, 'none');
});

test('tier 2 gets a payload and an engine, so it can install at all', async () => {
  // optiRoot was fetched for amd-optiscaler only, and the engine was never
  // passed, so engine-upscale had nothing to work with at either end.
  const { calls } = await install({ upscalers: NOTHING, engine: UNREAL }, 'engine-upscale');
  assert.equal(calls.install.length, 1, 'the installer ran');
  const config = calls.install[0];
  assert.equal(config.route, 'engine-upscale');
  assert.ok(config.optiRoot, 'OptiScaler was fetched for tier 2 as well');
  assert.equal(calls.upstream, 1);
  assert.ok(config.engine, 'the engine reached the installer');
  assert.equal(config.engine.upscalerSlot, true);
  assert.equal(config.engine.configDir, UNREAL.configDir, 'including the file it has to edit');
});

test('the guided routes install nothing and still need no payload', async () => {
  for (const route of ['amd-driver', 'spatial']) {
    const { result, calls } = await install({ upscalers: NOTHING }, route);
    assert.ok(!(result && /payload is missing/i.test(result.message || '')), `${route}: ${result && result.message}`);
    assert.equal(calls.install[0].route, route, `${route} was installed as asked`);
    assert.equal(calls.upstream, 0, `${route} downloads nothing`);
  }
});

test('an NVIDIA machine still refuses without the payload, exactly as before', async () => {
  // The gate is not gone, only made route-aware. A NVIDIA route without its
  // payload has to keep failing, and with the message that says what to do.
  const { result, calls } = await install({ rows: [RTX], upscalers: NOTHING }, 'feeder');
  assert.match(result.message || '', /payload is missing/i);
  assert.equal(result.ok, false);
  assert.equal(calls.install.length, 0, 'nothing was installed');
});

test('an NVIDIA machine is never offered an AMD route', async () => {
  const { calls } = await install({ rows: [RTX], payloadPresent: true }, 'amd-optiscaler');
  assert.ok(calls.install.length === 0 || !String(calls.install[0].route).startsWith('amd-'),
    'asking for an AMD route on an RTX must not install one');
});

test('the confirmation shown before an AMD install is the AMD one', async () => {
  const { calls } = await install({}, 'amd-optiscaler');
  const text = JSON.stringify(calls.dialogs);
  assert.ok(calls.dialogs.length, 'something was confirmed');
  assert.doesNotMatch(text, /Blackwell/i, 'nothing about a card that cannot be in this machine');
  assert.match(text, /FSR|Radeon|OptiScaler/i);
});
