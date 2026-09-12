'use strict';
// Task 1.8: installing the AMD route into a real folder, and getting the
// folder back exactly as it was.
//
// The restore test hashes every file before and after, because "it looked
// fine" is not a standard anyone can act on when a game stops launching.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const upstream = require('../src/core/optiscaler-upstream');
const backends = require('../src/core/backend-manager');
const ini = require('../src/core/feeder-config');
const { writePe } = require('./fixtures/pe');

const RDNA3 = { vendor: 'amd', rdnaGen: 3, mobile: false, adrenalin: '26.8.1', fsr4Capable: true };
const FIXTURE_INI = path.join(__dirname, 'fixtures', 'optiscaler-0.9.4.ini');

function temp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// The extracted upstream archive, small enough to build in milliseconds.
function payload(root) {
  for (const rel of upstream.BINARIES) writePe(path.join(root, rel), { bitness: 64, size: 4096 });
  for (const rel of [...upstream.TEXT_FILES, ...upstream.LICENSES, 'OptiScaler-GPL-3.0.txt']) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), `contents of ${rel}\n`);
  }
  fs.copyFileSync(FIXTURE_INI, path.join(root, 'OptiScaler.ini'));
  return root;
}

// A game whose own files must come back untouched.
function game(root) {
  const exeDir = path.join(root, 'bin', 'x64');
  fs.mkdirSync(exeDir, { recursive: true });
  writePe(path.join(exeDir, 'Game.exe'), { bitness: 64, size: 300 * 1024 });
  fs.writeFileSync(path.join(exeDir, 'settings.cfg'), 'resolution=3440x1440\n');
  fs.writeFileSync(path.join(root, 'README.txt'), 'the game own readme\n');
  return { gameDir: root, exePath: path.join(exeDir, 'Game.exe'), exeDir };
}

// Hashes of the game's own files. _DLSS5_Backup is this application's
// bookkeeping and is checked separately: its manifest carries the install
// date, so two installs legitimately differ there, and a restore deliberately
// leaves a renamed manifest and the saved tuning behind as a record.
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
// Everything under the backup folder, relative to it.
function bookkeeping(gameDir) {
  const root = path.join(gameDir, '_DLSS5_Backup');
  const out = [];
  if (!fs.existsSync(root)) return out;
  (function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  })(root);
  return out.sort();
}

function configFor(t, extra = {}) {
  const g = game(temp(t, 'amd-opti-game-'));
  return {
    gameDir: g.gameDir, exePath: g.exePath, api: 'dxgi', apiLabel: 'DirectX 12',
    bitness: 64, route: 'amd-optiscaler', optiRoot: payload(temp(t, 'amd-opti-payload-')),
    gpu: RDNA3, options: {}, upscalers: { dlss: true, any: true }, ...extra
  };
}
const names = (dir) => fs.readdirSync(dir).sort();

test('a DirectX 12 install puts the proxy under dxgi.dll and configures it for FSR 4', async (t) => {
  const config = configFor(t);
  const manifest = await backends.install(config);
  const files = names(config.gameDir + '/bin/x64');

  assert.ok(files.includes('dxgi.dll'), 'the proxy takes the DXGI name');
  assert.equal(files.includes('OptiScaler.dll'), false, 'and is not left under its own name too');
  assert.ok(files.includes('OptiScaler.ini'));
  assert.ok(files.includes('amd_fidelityfx_upscaler_dx12.dll'));
  assert.equal(manifest.route, 'amd-optiscaler');
  assert.equal(manifest.optiscaler.hook, 'dxgi.dll');
  assert.equal(manifest.optiscaler.version, upstream.RELEASE.version);

  const text = fs.readFileSync(path.join(config.gameDir, 'bin', 'x64', 'OptiScaler.ini'), 'utf8');
  assert.equal(ini.getIni(text, 'Upscalers', 'Dx12Upscaler'), 'fsr31');
  assert.equal(ini.getIni(text, 'FSR', 'Fsr4ForceEnableInt8'), 'true', 'this card runs the INT8 model');
  assert.equal(ini.getIni(text, 'ProcessFilter', 'TargetProcessName'), 'Game.exe');
});

test('a Vulkan game gets the proxy under winmm.dll instead, because it never loads dxgi', async (t) => {
  const config = configFor(t, { api: 'vulkan', apiLabel: 'Vulkan' });
  const manifest = await backends.install(config);
  const files = names(path.join(config.gameDir, 'bin', 'x64'));
  assert.ok(files.includes('winmm.dll'));
  assert.equal(files.includes('dxgi.dll'), false);
  assert.equal(manifest.optiscaler.hook, 'winmm.dll');
});

test('fakenvapi arrives only when it was asked for, and brings its own settings file', async (t) => {
  const without = configFor(t);
  await backends.install(without);
  assert.equal(names(path.join(without.gameDir, 'bin', 'x64')).includes('fakenvapi.dll'), false);

  const withIt = configFor(t, { options: { inputs: 'fakenvapi' } });
  await backends.install(withIt);
  const files = names(path.join(withIt.gameDir, 'bin', 'x64'));
  assert.ok(files.includes('fakenvapi.dll'));
  assert.ok(files.includes('fakenvapi.ini'));
  const text = fs.readFileSync(path.join(withIt.gameDir, 'bin', 'x64', 'OptiScaler.ini'), 'utf8');
  assert.equal(ini.getIni(text, 'Spoofing', 'Dxgi'), 'false', 'fakenvapi replaces whole-game spoofing');
});

test('Nukem frame generation brings its module and the fakenvapi an AMD card needs with it', async (t) => {
  const config = configFor(t, { options: { fg: 'nukem' } });
  await backends.install(config);
  const files = names(path.join(config.gameDir, 'bin', 'x64'));
  assert.ok(files.includes('dlssg_to_fsr3_amd_is_better.dll'));
  assert.ok(files.includes('fakenvapi.dll'), 'upstream says AMD users need it for this output');
  const text = fs.readFileSync(path.join(config.gameDir, 'bin', 'x64', 'OptiScaler.ini'), 'utf8');
  assert.equal(ini.getIni(text, 'FrameGen', 'FGOutput'), 'nukems');
});

test('the heavy XeSS frame generation module stays out of an ordinary install', async (t) => {
  const config = configFor(t);
  await backends.install(config);
  assert.equal(names(path.join(config.gameDir, 'bin', 'x64')).includes('libxess_fg.dll'), false);
});

test('another mod already owning the proxy name is refused, not overwritten', async (t) => {
  const config = configFor(t);
  // Someone else's dxgi.dll: a different injector, not ours and not ReShade.
  writePe(path.join(config.gameDir, 'bin', 'x64', 'dxgi.dll'), { bitness: 64, text: 'SomeOtherMod' });
  await assert.rejects(backends.install(config), { code: 'errOptiConflict' });
  // And the foreign file is still there, untouched.
  assert.ok(fs.existsSync(path.join(config.gameDir, 'bin', 'x64', 'dxgi.dll')));
});

test('restore gives the folder back byte for byte', async (t) => {
  const config = configFor(t);
  const before = snapshot(config.gameDir);
  await backends.install(config);
  assert.notDeepEqual([...snapshot(config.gameDir).keys()], [...before.keys()], 'something was installed');

  await backends.restore(config.gameDir);
  const after = snapshot(config.gameDir);
  for (const [rel, hash] of before) {
    assert.ok(after.has(rel), `${rel} went missing`);
    assert.equal(after.get(rel), hash, `${rel} came back changed`);
  }
  for (const rel of after.keys()) {
    assert.ok(before.has(rel), `${rel} was left behind`);
  }

  // What remains is bookkeeping only: a retired manifest kept as a record of
  // what was done, and the saved tuning so a reinstall does not lose it.
  // No copy of a game file may be left loose in there.
  const left = bookkeeping(config.gameDir);
  assert.ok(left.length > 0, 'the record of the install is kept');
  for (const rel of left) {
    assert.match(rel, /^(manifest\.json\.done-\d+|\.profiles\/[^/]+\.json)$/, `unexpected leftover: ${rel}`);
  }
});

test('installing twice over the same game is idempotent', async (t) => {
  const config = configFor(t);
  await backends.install(config);
  const once = snapshot(config.gameDir);
  await backends.install(config);
  const twice = snapshot(config.gameDir);
  assert.deepEqual([...twice.keys()].sort(), [...once.keys()].sort());
  for (const [rel, hash] of once) assert.equal(twice.get(rel), hash, rel);
});

test('an install the person tuned by hand keeps that tuning on reinstall', async (t) => {
  const config = configFor(t);
  await backends.install(config);
  const file = path.join(config.gameDir, 'bin', 'x64', 'OptiScaler.ini');
  fs.writeFileSync(file, ini.setIni(fs.readFileSync(file, 'utf8'), 'Menu', 'Scale', '1.6'));

  await backends.install(config);
  const text = fs.readFileSync(file, 'utf8');
  assert.equal(ini.getIni(text, 'Menu', 'Scale'), '1.6', 'their setting survived');
  assert.equal(ini.getIni(text, 'Upscalers', 'Dx12Upscaler'), 'fsr31', 'and ours is still right');
});

test('a payload missing a module is refused before anything is copied', async (t) => {
  const config = configFor(t);
  fs.rmSync(path.join(config.optiRoot, 'amd_fidelityfx_vk.dll'));
  await assert.rejects(backends.install(config), { code: 'errOptiPayload' });
  assert.equal(names(path.join(config.gameDir, 'bin', 'x64')).includes('dxgi.dll'), false, 'nothing half-installed');
});

test('the upstream setup scripts are never copied into the game', async (t) => {
  const config = configFor(t);
  for (const rel of upstream.SETUP_SCRIPTS) fs.writeFileSync(path.join(config.optiRoot, rel), 'echo no');
  await backends.install(config);
  const files = names(path.join(config.gameDir, 'bin', 'x64'));
  for (const rel of upstream.SETUP_SCRIPTS) assert.equal(files.includes(rel), false, rel);
});

test('the licences travel with the binaries, GPL included', async (t) => {
  const config = configFor(t);
  await backends.install(config);
  const licenses = path.join(config.gameDir, 'bin', 'x64', 'OptiScaler', 'licenses');
  assert.ok(fs.existsSync(path.join(licenses, 'LICENSE.GPL-3.0.txt')));
  for (const rel of upstream.LICENSES) assert.ok(fs.existsSync(path.join(licenses, path.basename(rel))), rel);
});
