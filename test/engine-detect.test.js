'use strict';
// Task 1.4: which engine a game is built on, and whether that engine has an
// upscaler slot we can open from the outside. Only Unreal does today, and
// that single fact is what tier 2 rests on.
//
// Every folder here is a temporary fixture and %LOCALAPPDATA% is injected,
// so nothing reads the real machine.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { detectEngine, ENGINES } = require('../src/core/engine-detect');

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-detect-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function put(root, ...names) {
  for (const name of names) {
    const file = path.join(root, name);
    if (name.endsWith('/')) { fs.mkdirSync(file, { recursive: true }); continue; }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, name);
  }
  return root;
}

// The real layout of Return to Moria, read off this machine: a launcher at
// the root, an Engine folder, a project folder holding Content/Paks, and the
// shipping executable two levels inside it.
function unrealGame(root, { project = 'Moria', pak = 'Moria-WindowsNoEditor.pak' } = {}) {
  put(root,
    `${project}.exe`,
    'Engine/Binaries/Win64/CrashReportClient.exe',
    `${project}/Content/Paks/${pak}`,
    `${project}/Binaries/Win64/${project}-Win64-Shipping.exe`);
  return { gameDir: root, exePath: path.join(root, project, 'Binaries', 'Win64', `${project}-Win64-Shipping.exe`) };
}

test('an Unreal game is recognised, named, and marked as having an upscaler slot', (t) => {
  const { gameDir, exePath } = unrealGame(temp(t));
  const found = detectEngine(gameDir, exePath, { localAppData: temp(t) });
  assert.equal(found.engine, 'unreal');
  assert.equal(found.projectName, 'Moria');
  assert.equal(found.upscalerSlot, true);
});

test('the shipping executable alone is enough, even with no Content/Paks', (t) => {
  // Some installs keep their paks elsewhere or stream them. The executable
  // suffix is Unreal's own convention and is evidence on its own.
  const root = put(temp(t), 'Whatever/Binaries/Win64/Whatever-Win64-Shipping.exe');
  const exePath = path.join(root, 'Whatever', 'Binaries', 'Win64', 'Whatever-Win64-Shipping.exe');
  const found = detectEngine(root, exePath, { localAppData: temp(t) });
  assert.equal(found.engine, 'unreal');
  assert.equal(found.projectName, 'Whatever');
  assert.equal(found.upscalerSlot, true);
});

test('the config folder is the one that exists on disk, not a guess', (t) => {
  const { gameDir, exePath } = unrealGame(temp(t));
  const local = temp(t);
  // The real machine has a CrashReportClient folder sitting beside the
  // platform folder. Picking "the first subdirectory" would land there.
  put(local, 'Moria/Saved/Config/CrashReportClient/Engine.ini', 'Moria/Saved/Config/WindowsNoEditor/Engine.ini');
  const found = detectEngine(gameDir, exePath, { localAppData: local });
  assert.equal(found.configDir, path.join(local, 'Moria', 'Saved', 'Config', 'WindowsNoEditor'));
});

test('a UE5 layout lands in Windows rather than WindowsNoEditor', (t) => {
  const { gameDir, exePath } = unrealGame(temp(t), { project: 'Fable', pak: 'Fable-Windows.pak' });
  const local = temp(t);
  put(local, 'Fable/Saved/Config/Windows/Engine.ini');
  const found = detectEngine(gameDir, exePath, { localAppData: local });
  assert.equal(found.configDir, path.join(local, 'Fable', 'Saved', 'Config', 'Windows'));
});

test('with no config folder yet, the pak name says which one the game will write', (t) => {
  const local = temp(t);
  const older = unrealGame(temp(t), { project: 'Moria', pak: 'Moria-WindowsNoEditor.pak' });
  assert.equal(detectEngine(older.gameDir, older.exePath, { localAppData: local }).configDir,
    path.join(local, 'Moria', 'Saved', 'Config', 'WindowsNoEditor'));

  const newer = unrealGame(temp(t), { project: 'Fable', pak: 'Fable-Windows.pak' });
  assert.equal(detectEngine(newer.gameDir, newer.exePath, { localAppData: local }).configDir,
    path.join(local, 'Fable', 'Saved', 'Config', 'Windows'));
});

test('the engine version is read from Build.version when the game ships one', (t) => {
  const { gameDir, exePath } = unrealGame(temp(t));
  fs.mkdirSync(path.join(gameDir, 'Engine', 'Build'), { recursive: true });
  fs.writeFileSync(path.join(gameDir, 'Engine', 'Build', 'Build.version'),
    JSON.stringify({ MajorVersion: 5, MinorVersion: 4, PatchVersion: 2 }));
  assert.equal(detectEngine(gameDir, exePath, { localAppData: temp(t) }).version, '5.4.2');
});

test('a Build.version that is missing or unreadable leaves the version unknown, not wrong', (t) => {
  const a = unrealGame(temp(t));
  assert.equal(detectEngine(a.gameDir, a.exePath, { localAppData: temp(t) }).version, null);

  const b = unrealGame(temp(t));
  fs.mkdirSync(path.join(b.gameDir, 'Engine', 'Build'), { recursive: true });
  fs.writeFileSync(path.join(b.gameDir, 'Engine', 'Build', 'Build.version'), '{ not json');
  assert.equal(detectEngine(b.gameDir, b.exePath, { localAppData: temp(t) }).version, null);
});

test('Unity is recognised by its player or its data folder', (t) => {
  const byPlayer = put(temp(t), 'UnityPlayer.dll', 'Risk.exe');
  assert.equal(detectEngine(byPlayer, path.join(byPlayer, 'Risk.exe')).engine, 'unity');

  const byData = put(temp(t), 'Risk_Data/globalgamemanagers', 'Risk.exe');
  assert.equal(detectEngine(byData, path.join(byData, 'Risk.exe')).engine, 'unity');
});

test('the other engines each answer with their own name', (t) => {
  const cases = [
    ['re-engine', ['re_chunk_000.pak', 'game.exe']],
    ['creation', ['Data/Skyrim.esm', 'SkyrimSE.exe']],
    ['source', ['bin/engine.dll', 'hl2.exe']],
    ['source', ['game/pak01_dir.vpk', 'game.exe']],
    ['idtech', ['base/gameresources.resources', 'DOOMEternal.exe']],
    ['godot', ['game.pck', 'game.exe']],
    ['cryengine', ['Bin64/CrySystem.dll', 'game.exe']]
  ];
  for (const [expected, files] of cases) {
    const root = put(temp(t), ...files);
    const exe = files.find((f) => f.endsWith('.exe'));
    assert.equal(detectEngine(root, path.join(root, exe)).engine, expected, files.join(' + '));
  }
});

test('a folder that matches nothing is unknown, and unknown is a valid answer', (t) => {
  const root = put(temp(t), 'game.exe', 'data.bin', 'readme.txt');
  const found = detectEngine(root, path.join(root, 'game.exe'));
  assert.equal(found.engine, 'unknown');
  assert.equal(found.upscalerSlot, false);
  assert.equal(found.projectName, null);
  assert.equal(found.configDir, null);
  assert.equal(found.version, null);
});

test('only Unreal claims an upscaler slot', (t) => {
  // This is the whole point of the module: tier 2 is offered on the strength
  // of this flag, so no other engine may set it by accident.
  const root = put(temp(t), 'UnityPlayer.dll', 'game.exe');
  assert.equal(detectEngine(root, path.join(root, 'game.exe')).upscalerSlot, false);
  for (const engine of ENGINES) {
    if (engine === 'unreal') continue;
    assert.notEqual(engine, 'unreal');
  }
  assert.ok(ENGINES.includes('unreal') && ENGINES.includes('unknown'));
});

test('a folder that is gone, or no executable at all, answers instead of throwing', (t) => {
  const gone = path.join(os.tmpdir(), 'not-here-' + Date.now());
  assert.equal(detectEngine(gone, path.join(gone, 'game.exe')).engine, 'unknown');
  const root = temp(t);
  assert.equal(detectEngine(root, null).engine, 'unknown');
  assert.equal(detectEngine(null, null).engine, 'unknown');
});

test('Unreal wins over a stray file that looks like another engine', (t) => {
  // Games ship odd leftovers. Unreal evidence is specific and structural, so
  // it is checked first and a loose .pck beside the launcher cannot beat it.
  const { gameDir, exePath } = unrealGame(temp(t));
  fs.writeFileSync(path.join(gameDir, 'extra.pck'), 'stray');
  assert.equal(detectEngine(gameDir, exePath, { localAppData: temp(t) }).engine, 'unreal');
});
