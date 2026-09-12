'use strict';
// Task 3.1: the guided driver route.
//
// The thing worth testing hardest is what it does NOT do. This route is the
// only one offered for a game with anti-cheat, and its whole claim is that
// nothing is injected. A test that watches the game folder is the only way
// to keep that claim true as the code changes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const driver = require('../src/core/routes/amd-driver');
const backends = require('../src/core/backend-manager');
const features = require('../src/shared/feature-i18n');
const { writePe } = require('./fixtures/pe');

const RDNA3 = { vendor: 'amd', rdnaGen: 3, mobile: false, adrenalin: '26.8.1', fsr4Capable: true };
const RDNA2 = { ...RDNA3, rdnaGen: 2, fsr4Capable: false };
const NOTHING = { dlss: false, dlssg: false, streamline: false, fsr2: false, fsr31: false, fsr31Signed: false, xess: false, any: false };
const SIGNED_FSR31 = { ...NOTHING, fsr31: true, fsr31Signed: true, any: true };

const applies = (target, gpu) => driver.steps(target, gpu).filter((s) => s.applies).map((s) => s.id);
const dx12 = (extra = {}) => ({ api: 'dxgi', apiLabel: 'DirectX 12', bitness: 64, upscalers: NOTHING, ...extra });

function temp(t, prefix = 'amd-driver-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function snapshot(dir) {
  const out = new Map();
  (function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '_DLSS5_Backup') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      out.set(path.relative(dir, full).split(path.sep).join('/'),
        crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex'));
    }
  })(dir);
  return out;
}
function game(t) {
  const gameDir = temp(t);
  const exeDir = path.join(gameDir, 'bin');
  fs.mkdirSync(exeDir, { recursive: true });
  writePe(path.join(exeDir, 'Game.exe'), { bitness: 64, size: 300 * 1024 });
  fs.writeFileSync(path.join(exeDir, 'settings.cfg'), 'vsync=1\n');
  return { gameDir, exePath: path.join(exeDir, 'Game.exe') };
}

test('every step is answered for every game, so nothing is silently missing', () => {
  const all = driver.steps(dx12(), RDNA3);
  assert.deepEqual(all.map((s) => s.id), [...driver.STEPS]);
  for (const step of all) {
    assert.equal(typeof step.applies, 'boolean', step.id);
    assert.equal(typeof step.i18nKey, 'string', step.id);
  }
});

test('the FSR 4 toggle is offered only where it can actually do something', () => {
  // The driver can swap a signed FSR 3.1 runtime for FSR 4, in DirectX 12,
  // on a card that runs FSR 4. Miss any one and the toggle does nothing.
  assert.ok(applies(dx12({ upscalers: SIGNED_FSR31 }), RDNA3).includes('fsr4Toggle'));

  const cases = [
    ['unsigned runtime', dx12({ upscalers: { ...SIGNED_FSR31, fsr31Signed: false } }), RDNA3],
    ['no FSR 3.1 at all', dx12(), RDNA3],
    ['DirectX 11', dx12({ apiLabel: 'DirectX 11', upscalers: SIGNED_FSR31 }), RDNA3],
    ['Vulkan', { api: 'vulkan', apiLabel: 'Vulkan', upscalers: SIGNED_FSR31 }, RDNA3],
    ['a card that cannot run FSR 4', dx12({ upscalers: SIGNED_FSR31 }), RDNA2]
  ];
  for (const [why, target, gpu] of cases) {
    assert.equal(applies(target, gpu).includes('fsr4Toggle'), false, why);
  }
});

test('frame generation is offered everywhere the driver can see the game', () => {
  for (const api of ['dxgi', 'vulkan', 'opengl', 'd3d9']) {
    assert.ok(applies({ api, apiLabel: api, upscalers: NOTHING }, RDNA3).includes('afmf'), api);
  }
  // DirectDraw and DX8 reach the card through a 32-bit wrapper the driver
  // never sees.
  for (const api of ['d3d8', 'ddraw']) {
    assert.equal(applies({ api, upscalers: NOTHING }, RDNA3).includes('afmf'), false, api);
  }
});

test('spatial upscaling and the latency setting are always on the list', () => {
  for (const api of ['dxgi', 'vulkan', 'opengl', 'd3d9', 'd3d8', 'ddraw']) {
    const list = applies({ api, upscalers: NOTHING }, RDNA3);
    assert.ok(list.includes('rsr'), api);
    assert.ok(list.includes('antiLag2'), api);
  }
});

test('a Vulkan game with FSR 3.1 is told the driver override will not reach it', () => {
  // This is the trap: the toggle exists, the game has FSR 3.1, and it still
  // does nothing, because the override is DirectX 12 only.
  const vulkan = { api: 'vulkan', apiLabel: 'Vulkan', upscalers: SIGNED_FSR31 };
  assert.ok(applies(vulkan, RDNA3).includes('optiscalerFallback'));
  assert.equal(applies(vulkan, RDNA3).includes('fsr4Toggle'), false);
  assert.equal(applies(dx12({ upscalers: SIGNED_FSR31 }), RDNA3).includes('optiscalerFallback'), false);
});

test('installing this route changes nothing at all in the game folder', async (t) => {
  const { gameDir, exePath } = game(t);
  const before = snapshot(gameDir);

  const manifest = await backends.install({
    gameDir, exePath, api: 'dxgi', apiLabel: 'DirectX 12', bitness: 64,
    route: 'amd-driver', gpu: RDNA3, upscalers: SIGNED_FSR31
  });

  assert.equal(manifest.route, 'amd-driver');
  assert.deepEqual([...manifest.added], []);
  assert.deepEqual([...manifest.replaced], []);
  assert.deepEqual(manifest.checklist, {});
  assert.ok(manifest.driverSteps.includes('fsr4Toggle'), 'and it recorded what applies to this game');

  const after = snapshot(gameDir);
  assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(), 'not one file added or removed');
  for (const [rel, hash] of before) assert.equal(after.get(rel), hash, rel);
});

test('restoring it leaves the game exactly as it was too', async (t) => {
  const { gameDir, exePath } = game(t);
  const before = snapshot(gameDir);
  await backends.install({
    gameDir, exePath, api: 'dxgi', apiLabel: 'DirectX 12', bitness: 64,
    route: 'amd-driver', gpu: RDNA3, upscalers: NOTHING
  });
  await backends.restore(gameDir);

  const after = snapshot(gameDir);
  assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort());
  assert.equal(backends.readManifest(gameDir), null, 'and the record is retired');
});

test('the manifest survives a round trip, so the library can find this game again', async (t) => {
  const { gameDir, exePath } = game(t);
  await backends.install({
    gameDir, exePath, api: 'vulkan', apiLabel: 'Vulkan', bitness: 64,
    route: 'amd-driver', gpu: RDNA3, upscalers: SIGNED_FSR31
  });
  const read = backends.readManifest(gameDir);
  assert.equal(read.route, 'amd-driver');
  assert.equal(read.game.apiLabel, 'Vulkan');
  assert.ok(read.driverSteps.includes('optiscalerFallback'));
  assert.equal(read.driverSteps.includes('fsr4Toggle'), false);
});

test('Adrenalin is found when it is installed, and not invented when it is not', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amd-cnext-'));
  try {
    assert.equal(driver.adrenalinPath({ ProgramFiles: root }), null);
    const dir = path.join(root, 'AMD', 'CNext', 'CNext');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'RadeonSoftware.exe'), 'not a real executable');
    assert.equal(driver.adrenalinPath({ ProgramFiles: root }), path.join(dir, 'RadeonSoftware.exe'));
    assert.equal(driver.adrenalinPath({}), driver.adrenalinPath({}), 'and an empty environment does not throw');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('every step says where to go, in all 38 languages', () => {
  const codes = Object.keys(features.catalog);
  for (const step of driver.steps(dx12(), RDNA3)) {
    for (const code of codes) {
      const text = features.t(code, step.i18nKey);
      assert.notEqual(text, step.i18nKey, `${code}.${step.i18nKey} fell back to its own key`);
      assert.ok(text.trim().length > 0, `${code}.${step.i18nKey}`);
    }
    // A guided step that does not name where the setting lives is not guidance.
    assert.ok(features.t('en', step.i18nKey).length > 25, step.i18nKey);
  }
});
