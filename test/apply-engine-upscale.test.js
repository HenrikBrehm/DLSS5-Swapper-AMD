'use strict';
// Task 2.2: tier 2 end to end. The engine hands over its temporal pass and
// OptiScaler answers with FSR 4, for a game that ships no upscaler at all.
//
// The interesting part is not the install, it is the undo: this route changes
// one file outside the game folder, and the tests insist that comes back too.
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
const ORIGINAL_CONFIG = '[Core.System]\nPaths=%GAMEDIR%Content\n\n[SystemSettings]\nr.AntiAliasingMethod=1\n';

function temp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function payload(root) {
  for (const rel of upstream.BINARIES) writePe(path.join(root, rel), { bitness: 64, size: 4096 });
  for (const rel of [...upstream.TEXT_FILES, ...upstream.LICENSES, 'OptiScaler-GPL-3.0.txt']) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), `contents of ${rel}\n`);
  }
  fs.copyFileSync(FIXTURE_INI, path.join(root, 'OptiScaler.ini'));
  return root;
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

// An Unreal game that ships no upscaler, plus the config folder Unreal keeps
// for it outside the game.
function setup(t, { withConfig = true } = {}) {
  const gameDir = temp(t, 'engine-game-');
  const exeDir = path.join(gameDir, 'Moria', 'Binaries', 'Win64');
  fs.mkdirSync(exeDir, { recursive: true });
  writePe(path.join(exeDir, 'Moria-Win64-Shipping.exe'), { bitness: 64, size: 300 * 1024 });
  const configDir = path.join(temp(t, 'engine-local-'), 'Moria', 'Saved', 'Config', 'WindowsNoEditor');
  if (withConfig) {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'Engine.ini'), ORIGINAL_CONFIG);
  }
  return {
    gameDir, exeDir, configDir,
    config: {
      gameDir, exePath: path.join(exeDir, 'Moria-Win64-Shipping.exe'),
      api: 'dxgi', apiLabel: 'DirectX 12', bitness: 64, route: 'engine-upscale',
      optiRoot: payload(temp(t, 'engine-payload-')), gpu: RDNA3, options: {},
      upscalers: { dlss: false, fsr2: false, fsr31: false, xess: false, any: false },
      engine: { engine: 'unreal', version: null, projectName: 'Moria', configDir, upscalerSlot: true }
    }
  };
}
const engineIni = (configDir) => path.join(configDir, 'Engine.ini');
const names = (dir) => fs.readdirSync(dir).sort();

test('one install both opens the engine slot and puts OptiScaler beside the game', async (t) => {
  const { config, exeDir, configDir } = setup(t);
  const manifest = await backends.install(config);

  const text = fs.readFileSync(engineIni(configDir), 'utf8');
  assert.equal(ini.getIni(text, 'SystemSettings', 'r.TemporalAA.Upscaler'), '1');
  assert.equal(ini.getIni(text, 'SystemSettings', 'r.ScreenPercentage'), '67');
  assert.equal(ini.getIni(text, 'Core.System', 'Paths'), '%GAMEDIR%Content', 'the game own section survives');

  assert.ok(names(exeDir).includes('dxgi.dll'));
  assert.ok(names(exeDir).includes('OptiScaler.ini'));
  assert.equal(manifest.route, 'engine-upscale');
  assert.equal(manifest.engineConfig.file, engineIni(configDir));
});

test('the engine feeds the inputs, so nothing is spoofed by default', async (t) => {
  const { config, exeDir } = setup(t);
  await backends.install(config);
  const text = fs.readFileSync(path.join(exeDir, 'OptiScaler.ini'), 'utf8');
  assert.equal(ini.getIni(text, 'Spoofing', 'Dxgi'), 'false', 'there is no DLSS to pretend at');
  assert.equal(ini.getIni(text, 'Upscalers', 'Dx12Upscaler'), 'fsr31');
  assert.equal(ini.getIni(text, 'FSR', 'Fsr4ForceEnableInt8'), 'true');
});

test('restore undoes both halves, including the file outside the game folder', async (t) => {
  const { config, gameDir, configDir } = setup(t);
  const before = snapshot(gameDir);
  await backends.install(config);
  assert.notEqual(fs.readFileSync(engineIni(configDir), 'utf8'), ORIGINAL_CONFIG);

  await backends.restore(gameDir);
  assert.equal(fs.readFileSync(engineIni(configDir), 'utf8'), ORIGINAL_CONFIG, 'the engine config came back');
  const after = snapshot(gameDir);
  for (const [rel, hash] of before) assert.equal(after.get(rel), hash, rel);
  for (const rel of after.keys()) assert.ok(before.has(rel), `${rel} was left behind`);
});

test('a config file the game never had is removed again, not left as ours', async (t) => {
  const { config, gameDir, configDir } = setup(t, { withConfig: false });
  await backends.install(config);
  assert.ok(fs.existsSync(engineIni(configDir)));
  await backends.restore(gameDir);
  assert.equal(fs.existsSync(engineIni(configDir)), false);
});

test('a game whose engine has no slot is refused before anything is touched', async (t) => {
  const { config, exeDir, configDir } = setup(t);
  config.engine = { engine: 'unity', upscalerSlot: false, configDir: null, projectName: null };
  await assert.rejects(backends.install(config), { code: 'errEngineUnsupported' });
  assert.equal(names(exeDir).includes('dxgi.dll'), false, 'no files were copied');
  assert.equal(fs.readFileSync(engineIni(configDir), 'utf8'), ORIGINAL_CONFIG, 'and the config is untouched');
});

test('installing twice leaves the same result and the true original still recorded', async (t) => {
  const { config, gameDir, configDir } = setup(t);
  await backends.install(config);
  const once = fs.readFileSync(engineIni(configDir), 'utf8');
  await backends.install(config);
  assert.equal(fs.readFileSync(engineIni(configDir), 'utf8'), once);

  await backends.restore(gameDir);
  assert.equal(fs.readFileSync(engineIni(configDir), 'utf8'), ORIGINAL_CONFIG,
    'the second install did not record its own edit as the original');
});

test('switching to the plain OptiScaler route cleans the engine config up again', async (t) => {
  const { config, gameDir, configDir } = setup(t);
  await backends.install(config);
  assert.notEqual(fs.readFileSync(engineIni(configDir), 'utf8'), ORIGINAL_CONFIG);

  // The same game, now on tier 1. Nothing should still be edited in the
  // engine's own configuration: that belonged to the route just left.
  await backends.install({ ...config, route: 'amd-optiscaler' });
  assert.equal(fs.readFileSync(engineIni(configDir), 'utf8'), ORIGINAL_CONFIG);
  const manifest = backends.readManifest(gameDir);
  assert.equal(manifest.route, 'amd-optiscaler');
  assert.ok(!manifest.engineConfig, 'and the record went with it');
});

test('the render scale can be chosen, and a silly one is refused', async (t) => {
  const { config, configDir } = setup(t);
  await backends.install({ ...config, options: { renderScale: 50 } });
  assert.equal(ini.getIni(fs.readFileSync(engineIni(configDir), 'utf8'), 'SystemSettings', 'r.ScreenPercentage'), '50');

  const other = setup(t);
  await assert.rejects(backends.install({ ...other.config, options: { renderScale: 200 } }), { code: 'errEngineScale' });
});
