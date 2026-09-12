'use strict';
// Task 2.1: opening Unreal's upscaler slot from the outside.
//
// This is the one place in the application that writes a file outside the
// selected game folder, because that is where Unreal keeps its per-game
// configuration. The tests therefore care as much about putting it back as
// about writing it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const unreal = require('../src/core/engine-tweaks/unreal');
const ini = require('../src/core/feeder-config');

function temp(t, prefix = 'unreal-tweak-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
// An engine description shaped like the one detectEngine returns.
function engineIn(configDir, extra = {}) {
  return { engine: 'unreal', version: null, projectName: 'Moria', configDir, upscalerSlot: true, ...extra };
}
const manifestFor = (gameDir) => ({ version: 1, gameDir, added: [], replaced: [], engineConfig: null });
const engineIni = (configDir) => path.join(configDir, 'Engine.ini');
const read = (file) => fs.readFileSync(file, 'utf8');

test('the plan names only the four switches that open the slot, in SystemSettings', (t) => {
  const entries = unreal.plan(engineIn(temp(t)), {});
  assert.equal(entries.length, 4);
  for (const entry of entries) assert.equal(entry.section, 'SystemSettings', entry.key);
  const byKey = Object.fromEntries(entries.map((e) => [e.key, e.value]));
  assert.equal(byKey['r.TemporalAA.Upscaler'], '1', 'this is the switch that hands the pass over');
  assert.equal(byKey['r.AntiAliasingMethod'], '2', 'TAA is what feeds the upscaler slot');
  assert.equal(byKey['r.ScreenPercentage'], '67');
  assert.equal(byKey['r.ScreenPercentage.MinResolution'], '0', 'or the engine clamps the render size back up');
});

test('the render scale is the one asked for, and only sane values are accepted', (t) => {
  const engine = engineIn(temp(t));
  const scaleOf = (options) => unreal.plan(engine, options).find((e) => e.key === 'r.ScreenPercentage').value;
  assert.equal(scaleOf({ renderScale: 50 }), '50');
  assert.equal(scaleOf({ renderScale: 100 }), '100');
  for (const renderScale of [49, 101, 0, -10, 'quality', null, NaN, 67.5]) {
    assert.throws(() => unreal.plan(engine, { renderScale }), { code: 'errEngineScale' }, String(renderScale));
  }
});

test('a game with no config folder is refused with a reason, not a stack trace', (t) => {
  for (const engine of [engineIn(null), { engine: 'unity', upscalerSlot: false, configDir: temp(t) }, null]) {
    assert.throws(() => unreal.plan(engine, {}), { code: 'errEngineUnsupported' });
  }
});

test('a game that has never written a config gets one, recorded as created', (t) => {
  const gameDir = temp(t, 'unreal-game-');
  const configDir = path.join(temp(t, 'unreal-local-'), 'Moria', 'Saved', 'Config', 'WindowsNoEditor');
  const manifest = manifestFor(gameDir);

  unreal.apply(manifest, gameDir, engineIn(configDir), {});
  const text = read(engineIni(configDir));
  assert.equal(ini.getIni(text, 'SystemSettings', 'r.TemporalAA.Upscaler'), '1');
  assert.equal(manifest.engineConfig.created, true);
  assert.equal(manifest.engineConfig.file, engineIni(configDir));
});

test('an existing config keeps every section it already had', (t) => {
  const gameDir = temp(t, 'unreal-game-');
  const configDir = temp(t, 'unreal-local-');
  // The real file on this machine starts with [Core.System] and a list of
  // content paths; losing those would break the game outright.
  const original = '[Core.System]\nPaths=../../../Engine/Content\nPaths=%GAMEDIR%Content\n\n[/Script/Engine.RendererSettings]\nr.Shadow.Quality=3\n';
  fs.writeFileSync(engineIni(configDir), original);

  unreal.apply(manifestFor(gameDir), gameDir, engineIn(configDir), {});
  const text = read(engineIni(configDir));
  assert.match(text, /Paths=\.\.\/\.\.\/\.\.\/Engine\/Content/);
  assert.match(text, /Paths=%GAMEDIR%Content/);
  assert.equal(ini.getIni(text, '/Script/Engine.RendererSettings', 'r.Shadow.Quality'), '3');
  assert.equal(ini.getIni(text, 'SystemSettings', 'r.TemporalAA.Upscaler'), '1');
});

test('a switch the game already set is overwritten, not duplicated', (t) => {
  const gameDir = temp(t, 'unreal-game-');
  const configDir = temp(t, 'unreal-local-');
  fs.writeFileSync(engineIni(configDir), '[SystemSettings]\nr.AntiAliasingMethod=1\nr.ScreenPercentage=100\nr.Bloom.Quality=5\n');

  unreal.apply(manifestFor(gameDir), gameDir, engineIn(configDir), { renderScale: 50 });
  const text = read(engineIni(configDir));
  assert.equal(ini.getIni(text, 'SystemSettings', 'r.AntiAliasingMethod'), '2');
  assert.equal(ini.getIni(text, 'SystemSettings', 'r.ScreenPercentage'), '50');
  assert.equal(ini.getIni(text, 'SystemSettings', 'r.Bloom.Quality'), '5', 'unrelated settings stay');
  assert.equal((text.match(/^r\.ScreenPercentage=/gm) || []).length, 1, 'exactly one entry, not two');
});

test('a read-only config is written anyway, and the attribute is remembered', (t) => {
  // Unreal marks these files read-only in some installs. Writing has to work,
  // and the file has to come back read-only afterwards.
  const gameDir = temp(t, 'unreal-game-');
  const configDir = temp(t, 'unreal-local-');
  const file = engineIni(configDir);
  fs.writeFileSync(file, '[SystemSettings]\nr.Bloom.Quality=5\n');
  fs.chmodSync(file, 0o444);
  const manifest = manifestFor(gameDir);

  unreal.apply(manifest, gameDir, engineIn(configDir), {});
  assert.equal(ini.getIni(read(file), 'SystemSettings', 'r.TemporalAA.Upscaler'), '1');
  assert.equal(manifest.engineConfig.wasReadOnly, true);
  fs.chmodSync(file, 0o666);
});

test('restore puts the original file back byte for byte', (t) => {
  const gameDir = temp(t, 'unreal-game-');
  const configDir = temp(t, 'unreal-local-');
  const file = engineIni(configDir);
  const original = '[Core.System]\nPaths=%GAMEDIR%Content\n\n[SystemSettings]\nr.AntiAliasingMethod=1\n';
  fs.writeFileSync(file, original);
  const manifest = manifestFor(gameDir);

  unreal.apply(manifest, gameDir, engineIn(configDir), {});
  assert.notEqual(read(file), original, 'it was changed');

  unreal.restore(manifest, gameDir);
  assert.equal(read(file), original, 'and changed back exactly');
  assert.equal(manifest.engineConfig, null, 'the record is cleared once it is undone');
});

test('restore removes a file that was not there before, and its folder if it made it', (t) => {
  const gameDir = temp(t, 'unreal-game-');
  const local = temp(t, 'unreal-local-');
  const configDir = path.join(local, 'Moria', 'Saved', 'Config', 'WindowsNoEditor');
  const manifest = manifestFor(gameDir);

  unreal.apply(manifest, gameDir, engineIn(configDir), {});
  assert.ok(fs.existsSync(engineIni(configDir)));

  unreal.restore(manifest, gameDir);
  assert.equal(fs.existsSync(engineIni(configDir)), false, 'nothing of ours is left behind');
});

test('restore gives a read-only file its attribute back', (t) => {
  const gameDir = temp(t, 'unreal-game-');
  const configDir = temp(t, 'unreal-local-');
  const file = engineIni(configDir);
  fs.writeFileSync(file, '[SystemSettings]\nr.Bloom.Quality=5\n');
  fs.chmodSync(file, 0o444);
  const manifest = manifestFor(gameDir);

  unreal.apply(manifest, gameDir, engineIn(configDir), {});
  unreal.restore(manifest, gameDir);
  assert.equal(Boolean(fs.statSync(file).mode & 0o200), false, 'read-only again, as it was found');
  fs.chmodSync(file, 0o666);
});

test('applying twice changes the file only once', (t) => {
  const gameDir = temp(t, 'unreal-game-');
  const configDir = temp(t, 'unreal-local-');
  fs.writeFileSync(engineIni(configDir), '[Core.System]\nPaths=%GAMEDIR%Content\n');
  const manifest = manifestFor(gameDir);

  unreal.apply(manifest, gameDir, engineIn(configDir), {});
  const once = read(engineIni(configDir));
  unreal.apply(manifest, gameDir, engineIn(configDir), {});
  assert.equal(read(engineIni(configDir)), once);
});

test('a second apply does not overwrite the backup of the true original', (t) => {
  // Otherwise reinstalling twice would record our own edit as the original,
  // and restore would hand back a file that was never the game's.
  const gameDir = temp(t, 'unreal-game-');
  const configDir = temp(t, 'unreal-local-');
  const original = '[SystemSettings]\nr.AntiAliasingMethod=1\n';
  fs.writeFileSync(engineIni(configDir), original);
  const manifest = manifestFor(gameDir);

  unreal.apply(manifest, gameDir, engineIn(configDir), {});
  unreal.apply(manifest, gameDir, engineIn(configDir), { renderScale: 50 });
  unreal.restore(manifest, gameDir);
  assert.equal(read(engineIni(configDir)), original);
});

test('the backup is kept inside the game folder, the only place this app owns', (t) => {
  const gameDir = temp(t, 'unreal-game-');
  const configDir = temp(t, 'unreal-local-');
  fs.writeFileSync(engineIni(configDir), '[SystemSettings]\nr.Bloom.Quality=5\n');
  const manifest = manifestFor(gameDir);

  unreal.apply(manifest, gameDir, engineIn(configDir), {});
  const backup = path.resolve(gameDir, manifest.engineConfig.backup);
  assert.ok(fs.existsSync(backup), 'the original is stored');
  assert.equal(path.relative(gameDir, backup).startsWith('..'), false, 'and stored under the game folder');
  assert.equal(manifest.engineConfig.created, false);
});

test('restore on a manifest that never touched a config does nothing and does not throw', (t) => {
  const gameDir = temp(t, 'unreal-game-');
  const manifest = manifestFor(gameDir);
  assert.equal(unreal.restore(manifest, gameDir), false);
  assert.equal(unreal.restore({ version: 1 }, gameDir), false);
});
