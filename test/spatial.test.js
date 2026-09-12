'use strict';
// Task 3.2: the spatial fallback, the floor under everything else.
//
// Two things matter here. The numbers have to be right, because a person is
// going to type them into a game's settings. And the route has to be honest
// about being a lesser thing than FSR 4, because someone arriving from a
// page about FSR 4 will otherwise expect what it cannot give.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const spatial = require('../src/core/routes/spatial');
const backends = require('../src/core/backend-manager');
const features = require('../src/shared/feature-i18n');
const { writePe } = require('./fixtures/pe');

function temp(t, prefix = 'spatial-') {
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
  const gameDir = temp(t, 'spatial-game-');
  const exeDir = path.join(gameDir, 'bin');
  fs.mkdirSync(exeDir, { recursive: true });
  writePe(path.join(exeDir, 'Game.exe'), { bitness: 64, size: 300 * 1024 });
  fs.writeFileSync(path.join(exeDir, 'settings.cfg'), 'fullscreen=1\n');
  return { gameDir, exePath: path.join(exeDir, 'Game.exe') };
}
const byId = (list) => Object.fromEntries(list.map((item) => [item.id, item]));

test('the render resolutions match the ratios every upscaler calls by those names', () => {
  const at4k = byId(spatial.resolutions(3840, 2160));
  assert.deepEqual([at4k.quality.width, at4k.quality.height], [2560, 1440], 'Quality is 1.5x per axis');
  assert.deepEqual([at4k.performance.width, at4k.performance.height], [1920, 1080], 'Performance is 2x per axis');
  assert.deepEqual([at4k.balanced.width, at4k.balanced.height], [2258, 1270], 'Balanced is 1.7x per axis');
  assert.deepEqual([at4k.quality.percent, at4k.balanced.percent, at4k.performance.percent], [67, 59, 50]);
});

test('the numbers are right at the resolutions people actually run', () => {
  const at1440 = byId(spatial.resolutions(2560, 1440));
  assert.deepEqual([at1440.quality.width, at1440.quality.height], [1706, 960]);
  assert.deepEqual([at1440.performance.width, at1440.performance.height], [1280, 720]);

  const at1080 = byId(spatial.resolutions(1920, 1080));
  assert.deepEqual([at1080.quality.width, at1080.quality.height], [1280, 720]);
  assert.deepEqual([at1080.performance.width, at1080.performance.height], [960, 540]);

  // An ultrawide keeps its aspect ratio rather than being squeezed to 16:9.
  const ultrawide = byId(spatial.resolutions(3440, 1440));
  assert.deepEqual([ultrawide.quality.width, ultrawide.quality.height], [2294, 960]);
  assert.ok(Math.abs(ultrawide.quality.width / ultrawide.quality.height - 3440 / 1440) < 0.01);
});

test('every width and height is even, because no game offers an odd one', () => {
  for (const [w, h] of [[3840, 2160], [2560, 1440], [1920, 1080], [3440, 1440], [1366, 768], [2880, 1800]]) {
    for (const entry of spatial.resolutions(w, h)) {
      assert.equal(entry.width % 2, 0, `${w}x${h} ${entry.id} width`);
      assert.equal(entry.height % 2, 0, `${w}x${h} ${entry.id} height`);
      assert.ok(entry.width < w && entry.height < h, 'and smaller than the display');
    }
  }
});

test('a display size that makes no sense gives no numbers rather than nonsense', () => {
  for (const [w, h] of [[0, 0], [-1920, 1080], [NaN, 1080], [undefined, undefined], ['1920', '1080'], [1, 1]]) {
    assert.deepEqual(spatial.resolutions(w, h), [], `${w}x${h}`);
  }
});

test('Magpie is found when installed and never invented when not', () => {
  const root = temp({ after: () => {} }, 'spatial-magpie-');
  try {
    assert.equal(spatial.magpiePath({ ProgramFiles: root, LOCALAPPDATA: root }), null);

    const dir = path.join(root, 'Magpie');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'Magpie.exe'), 'not a real executable');
    assert.equal(spatial.magpiePath({ ProgramFiles: root }), path.join(dir, 'Magpie.exe'));

    // And in the per-user location it actually installs to by default.
    const local = temp({ after: () => {} }, 'spatial-local-');
    const userDir = path.join(local, 'Programs', 'Magpie');
    fs.mkdirSync(userDir, { recursive: true });
    fs.writeFileSync(path.join(userDir, 'Magpie.exe'), 'not a real executable');
    assert.equal(spatial.magpiePath({ LOCALAPPDATA: local }), path.join(userDir, 'Magpie.exe'));
    fs.rmSync(local, { recursive: true, force: true });

    assert.equal(spatial.magpiePath({}), null, 'an empty environment finds nothing and does not throw');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the steps carry the numbers and say whether Magpie is there to use', () => {
  const steps = byId(spatial.steps({}, { width: 2560, height: 1440 }, {}));
  assert.equal(steps.setResolution.resolutions.length, 3);
  assert.equal(steps.setResolution.resolutions[0].width, 1706);
  assert.equal(steps.magpie.installed, false);
  assert.equal(steps.magpie.path, null);
  // Every step applies: this is the floor, and something here works anywhere.
  for (const step of spatial.steps({}, null, {})) assert.equal(step.applies, true, step.id);
});

test('with no display known the steps still appear, just without numbers', () => {
  const steps = byId(spatial.steps({}, null, {}));
  assert.deepEqual(steps.setResolution.resolutions, []);
  assert.equal(steps.rsr.applies, true);
});

test('installing it changes nothing in the game folder, and restore keeps it that way', async (t) => {
  const { gameDir, exePath } = game(t);
  const before = snapshot(gameDir);

  const manifest = await backends.install({
    gameDir, exePath, api: 'd3d9', apiLabel: 'DirectX 9', bitness: 32,
    route: 'spatial', display: { width: 3440, height: 1440 }
  });
  assert.equal(manifest.route, 'spatial');
  assert.deepEqual([...manifest.added], []);
  assert.equal(manifest.spatial.resolutions[0].width, 2294, 'the numbers are kept with the game');

  const installed = snapshot(gameDir);
  assert.deepEqual([...installed.keys()].sort(), [...before.keys()].sort(), 'nothing was added');

  await backends.restore(gameDir);
  const after = snapshot(gameDir);
  for (const [rel, hash] of before) assert.equal(after.get(rel), hash, rel);
  assert.equal(backends.readManifest(gameDir), null);
});

test('this route is available to the games nothing else can reach', async (t) => {
  // DirectX 9, 32-bit, no upscaler, unknown engine. Every other route has
  // already said no by this point, and this one still has an answer.
  const { gameDir, exePath } = game(t);
  const manifest = await backends.install({
    gameDir, exePath, api: 'ddraw', apiLabel: 'DirectDraw', bitness: 32, route: 'spatial'
  });
  assert.equal(manifest.route, 'spatial');
  assert.equal(manifest.spatial.display, null);
});

test('the route says plainly that this is not the same thing as FSR 4', () => {
  const english = features.t('en', spatial.HONESTY_KEY);
  assert.ok(english.length > 40, 'a one-liner cannot carry this');
  assert.match(english, /spatial/i);
  // It has to name what is missing, not just hedge.
  assert.ok(/motion vector|detail|reconstruct/i.test(english), english);
  for (const code of Object.keys(features.catalog)) {
    const text = features.t(code, spatial.HONESTY_KEY);
    assert.notEqual(text, spatial.HONESTY_KEY, `${code} fell back to its own key`);
    assert.ok(text.trim().length > 0, code);
  }
});

test('every step says where to go, in all 38 languages', () => {
  for (const step of spatial.steps({}, { width: 1920, height: 1080 }, {})) {
    for (const code of Object.keys(features.catalog)) {
      const text = features.t(code, step.i18nKey);
      assert.notEqual(text, step.i18nKey, `${code}.${step.i18nKey} fell back to its own key`);
      assert.ok(text.trim().length > 0, `${code}.${step.i18nKey}`);
    }
    assert.ok(features.t('en', step.i18nKey).length > 25, step.i18nKey);
  }
});
