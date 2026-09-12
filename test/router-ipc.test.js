'use strict';
// Task 5.2: the recommendation reaching the interface.
//
// The renderer has no way to ask the router itself - it cannot see the
// adapter, the game folder or the engine - so everything it shows has to
// arrive from the main process. These tests drive that handler.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const MAIN = path.resolve(__dirname, '../main.js');
const RDNA3 = { name: 'AMD Radeon RX 7900 XT', vendor: 'amd', driver: '32.0.31041.1004', adrenalin: '26.8.1', rdnaGen: 3, mobile: false, fsr4Capable: true };
const RTX = { name: 'NVIDIA GeForce RTX 4090', vendor: 'nvidia', driver: '616.56', adrenalin: null, rdnaGen: null, mobile: false, fsr4Capable: false };
const NOTHING = { dlss: false, dlssg: false, streamline: false, fsr2: false, fsr31: false, fsr31Signed: false, xess: false, any: false };

// Loads main.js with Electron and the modules that touch the disk stubbed,
// and returns the IPC handlers it registered.
function load({ rows = [RDNA3], target, engine, antiCheat = false, scanThrows = false } = {}) {
  const realRequire = createRequire(MAIN);
  const handlers = new Map();
  const chosen = target || {
    rel: 'bin\\Game.exe', path: 'C:\\Games\\X\\bin\\Game.exe', name: 'Game.exe',
    api: 'dxgi', apiLabel: 'DirectX 12', bitness: 64, size: 1024, upscalers: NOTHING
  };
  const stubs = {
    electron: {
      app: { setAppUserModelId() {}, whenReady: () => ({ then() {} }), on() {}, getPath: () => __dirname,
        requestSingleInstanceLock: () => true, quit() {} },
      ipcMain: { handle: (name, fn) => handlers.set(name, fn), on() {} },
      BrowserWindow: function () { return { on() {}, once() {}, loadFile() {}, webContents: { on() {}, send() {} } }; },
      Tray: function () { return { setContextMenu() {}, setToolTip() {}, on() {}, isDestroyed: () => false }; },
      Menu: { buildFromTemplate: (t) => t }, nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
      shell: {}, dialog: {}, clipboard: {}, Notification: function () {}, safeStorage: {}
    },
    './src/core/install-guards': {
      ...realRequire('./src/core/install-guards'),
      gpuInfo: async () => rows
    },
    './src/core/scan.js': {
      ...realRequire('./src/core/scan.js'),
      scanGame: async () => {
        if (scanThrows) throw new Error('Executable scan is unavailable');
        return { chosen, exeCandidates: [chosen], dlssFiles: [], streamlineFiles: [], primaryDlss: null };
      }
    },
    './src/core/compatibility': {
      ...realRequire('./src/core/compatibility'),
      hasAntiCheat: () => antiCheat
    },
    './src/core/engine-detect': {
      ...realRequire('./src/core/engine-detect'),
      detectEngine: () => engine || { engine: 'unknown', version: null, projectName: null, configDir: null, upscalerSlot: false }
    }
  };
  const module_ = { exports: {} };
  const context = vm.createContext({
    require: (name) => stubs[name] || realRequire(name),
    module: module_, exports: module_.exports,
    __dirname: path.dirname(MAIN), process, Buffer, console, setTimeout, setInterval, clearInterval
  });
  vm.runInContext(fs.readFileSync(MAIN, 'utf8'), context, { filename: MAIN });
  return handlers;
}
const ask = (options) => load(options).get('recommend-route')({}, 'C:\\Games\\X', 'C:\\Games\\X\\bin\\Game.exe');

test('a game that ships an upscaler comes back as tier 1, with a reason', async () => {
  const answer = await ask({
    target: { path: 'C:\\Games\\X\\bin\\Game.exe', api: 'dxgi', apiLabel: 'DirectX 12', bitness: 64,
      upscalers: { ...NOTHING, dlss: true, any: true } }
  });
  assert.equal(answer.ok, true);
  assert.equal(answer.tier, 1);
  assert.equal(answer.route, 'amd-optiscaler');
  assert.equal(answer.reason, 'routerTier1');
  assert.ok(Array.isArray(answer.alternatives));
});

test('an Unreal game with no upscaler comes back as tier 2, and names the engine', async () => {
  const answer = await ask({
    engine: { engine: 'unreal', upscalerSlot: true, projectName: 'Moria', configDir: 'C:\\x', version: null }
  });
  assert.equal(answer.tier, 2);
  assert.equal(answer.route, 'engine-upscale');
  assert.equal(answer.reason, 'routerTier2');
  assert.equal(answer.engine.engine, 'unreal');
  assert.equal(answer.engine.upscalerSlot, true);
});

test('an anti-cheat game is told that first, whatever else it ships', async () => {
  const answer = await ask({
    antiCheat: true,
    target: { path: 'C:\\Games\\X\\bin\\Game.exe', api: 'dxgi', apiLabel: 'DirectX 12', bitness: 64,
      upscalers: { ...NOTHING, dlss: true, any: true } },
    engine: { engine: 'unreal', upscalerSlot: true, projectName: 'Moria', configDir: 'C:\\x', version: null }
  });
  assert.equal(answer.tier, 3);
  assert.equal(answer.reason, 'routerAntiCheat');
  assert.equal(['amd-driver', 'spatial'].includes(answer.route), true);
});

test('a machine with no Radeon gets no advice rather than wrong advice', async () => {
  const answer = await ask({ rows: [RTX] });
  assert.equal(answer.ok, false);
  assert.equal(answer.reason, 'noAmdAdapter');
  assert.equal(await ask({ rows: [] }).then((a) => a.reason), 'noAmdAdapter');
  assert.equal(await ask({ rows: null }).then((a) => a.reason), 'noAmdAdapter');
});

test('advice that cannot be given is not reported as a failure of the game', async () => {
  // A protected or half-installed folder must not come back looking like the
  // game itself is broken.
  const answer = await ask({ scanThrows: true });
  assert.equal(answer.ok, false);
  assert.equal(answer.reason, 'unavailable');
  assert.match(answer.message, /scan is unavailable/);
});

test('an executable the scan does not know falls back to the chosen one', async () => {
  const handlers = load({});
  const answer = await handlers.get('recommend-route')({}, 'C:\\Games\\X', 'C:\\Games\\X\\somewhere-else.exe');
  assert.equal(answer.ok, true);
  assert.equal(typeof answer.route, 'string');
});

test('frame generation comes back with the route, so the sheet shows one decision', async () => {
  const answer = await ask({
    target: { path: 'C:\\Games\\X\\bin\\Game.exe', api: 'dxgi', apiLabel: 'DirectX 12', bitness: 64,
      upscalers: { ...NOTHING, dlss: true, dlssg: true, any: true } }
  });
  assert.equal(answer.fg, 'nukem');
  assert.equal(answer.frameGen.configureAs, 'nukem');
  assert.equal(typeof answer.frameGen.note, 'string');
});
