'use strict';
// Task 1.3: what upscaling a game already ships. The AMD routes hinge on
// this: a game with any modern upscaler input reaches FSR 4 through
// OptiScaler (tier 1), a game with none may still reach it through its
// engine (tier 2), and everything else falls to tier 3.
//
// The Authenticode probe is injected everywhere here; nothing shells out.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { detectUpscalers, emptyUpscalers, scanGame } = require('../src/core/scan');
const { writePe } = require('./fixtures/pe');

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-upscalers-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function put(dir, ...names) {
  for (const name of names) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, name);
  }
  return dir;
}
const never = () => { throw new Error('the signature probe must not run here'); };

test('a DLSS-only game is recognised as exactly that', async (t) => {
  const dir = put(temp(t), 'nvngx_dlss.dll', 'game.exe');
  const found = await detectUpscalers(dir, { isSigned: never });
  assert.equal(found.dlss, true);
  assert.equal(found.any, true);
  for (const key of ['dlssg', 'streamline', 'fsr2', 'fsr31', 'xess']) assert.equal(found[key], false, key);
  assert.equal(found.fsr31Signed, false, 'no FSR 3.1 present, so nothing to sign');
});

test('DLSS frame generation and Streamline are reported separately from DLSS itself', async (t) => {
  const dir = put(temp(t), 'nvngx_dlss.dll', 'nvngx_dlssg.dll', 'sl.interposer.dll', 'sl.dlss_g.dll');
  const found = await detectUpscalers(dir, { isSigned: never });
  assert.equal(found.dlss, true);
  assert.equal(found.dlssg, true);
  assert.equal(found.streamline, true);
  // Frame generation alone is not an upscaler input: `any` is about what
  // OptiScaler can read, and dlssg is an output concern.
  const fgOnly = await detectUpscalers(put(temp(t), 'nvngx_dlssg.dll'), { isSigned: never });
  assert.equal(fgOnly.dlssg, true);
  assert.equal(fgOnly.any, false);
});

test('a signed FSR 3.1 game is the one the Adrenalin FSR 4 toggle can upgrade', async (t) => {
  const dir = put(temp(t), 'amd_fidelityfx_dx12.dll', 'amd_fidelityfx_upscaler_dx12.dll');
  const asked = [];
  const found = await detectUpscalers(dir, { isSigned: async (file) => { asked.push(path.basename(file)); return true; } });
  assert.equal(found.fsr31, true);
  assert.equal(found.fsr31Signed, true);
  assert.equal(found.any, true);
  assert.ok(asked.length > 0, 'the probe runs when FSR 3.1 is present');
});

test('an unsigned FSR 3.1 game cannot use the driver toggle and must go through OptiScaler', async (t) => {
  const dir = put(temp(t), 'ffx_fsr3upscaler_x64.dll');
  const found = await detectUpscalers(dir, { isSigned: async () => false });
  assert.equal(found.fsr31, true);
  assert.equal(found.fsr31Signed, false);
});

test('a signature probe that fails is not a signature', async (t) => {
  // PowerShell can be restricted by policy. "Could not check" must read as
  // "not verified", never as verified, or the app would send someone to a
  // driver toggle that silently does nothing.
  const dir = put(temp(t), 'amd_fidelityfx_dx12.dll');
  const found = await detectUpscalers(dir, { isSigned: async () => { throw new Error('execution policy'); } });
  assert.equal(found.fsr31, true);
  assert.equal(found.fsr31Signed, false);
});

test('FSR 2 and XeSS are each recognised on their own', async (t) => {
  const fsr2 = await detectUpscalers(put(temp(t), 'ffx_fsr2_api_dx12_x64.dll'), { isSigned: never });
  assert.equal(fsr2.fsr2, true);
  assert.equal(fsr2.fsr31, false);
  assert.equal(fsr2.any, true);

  const xess = await detectUpscalers(put(temp(t), 'libxess.dll', 'libxess_dx11.dll'), { isSigned: never });
  assert.equal(xess.xess, true);
  assert.equal(xess.any, true);
});

test('a game with nothing at all is all false, and that is a real answer', async (t) => {
  const dir = put(temp(t), 'game.exe', 'data/textures.pak', 'engine/core.dll');
  const found = await detectUpscalers(dir, { isSigned: never });
  assert.deepEqual(found, emptyUpscalers());
  assert.equal(found.any, false);
});

test('the search reaches two levels down and stops there', async (t) => {
  const near = await detectUpscalers(put(temp(t), 'bin/x64/nvngx_dlss.dll'), { isSigned: never });
  assert.equal(near.dlss, true, 'two levels down is still the game');

  const far = await detectUpscalers(put(temp(t), 'a/b/c/nvngx_dlss.dll'), { isSigned: never });
  assert.equal(far.dlss, false, 'three levels down is someone else content, or a backup');
});

test('our own installed files are never mistaken for the game shipping them', async (t) => {
  // The AMD route copies amd_fidelityfx_*.dll into the game folder. Without
  // this, a second scan would report the game as a native FSR 3.1 title and
  // offer the driver toggle for DLLs we put there ourselves.
  const dir = put(temp(t), 'amd_fidelityfx_dx12.dll', 'OptiScaler/amd_fidelityfx_vk.dll', 'nvngx_dlss.dll');
  const clean = await detectUpscalers(dir, {
    isSigned: never,
    added: ['amd_fidelityfx_dx12.dll', 'OptiScaler\\amd_fidelityfx_vk.dll']
  });
  assert.equal(clean.fsr31, false, 'both copies were ours');
  assert.equal(clean.dlss, true, 'the game own DLSS is untouched');
});

test('the backup folder is never searched', async (t) => {
  const dir = put(temp(t), '_DLSS5_Backup/original/amd_fidelityfx_dx12.dll');
  const found = await detectUpscalers(dir, { isSigned: never });
  assert.equal(found.fsr31, false, 'restored originals live there and are not installed');
});

test('a folder that is gone answers, it does not throw', async (t) => {
  const found = await detectUpscalers(path.join(os.tmpdir(), 'definitely-not-here-' + Date.now()), { isSigned: never });
  assert.deepEqual(found, emptyUpscalers());
});

test('emptyUpscalers is a fresh object every time, so callers cannot poison it', () => {
  const one = emptyUpscalers();
  one.dlss = true;
  assert.equal(emptyUpscalers().dlss, false);
  // `fsrfg` joined in task 6.4. fg-plan.js had been branching on it since
  // task 4.1 while no pattern could ever set it, so the frame-generation
  // planner always believed the game generated none.
  assert.deepEqual(Object.keys(emptyUpscalers()).sort(),
    ['any', 'dlss', 'dlssg', 'fsr2', 'fsr31', 'fsr31Signed', 'fsrfg', 'streamline', 'xess']);
});

test('a scanned game carries the inventory on every candidate it offers', async (t) => {
  const dir = temp(t);
  writePe(path.join(dir, 'MyGame.exe'), { bitness: 64, size: 300 * 1024 });
  put(dir, 'nvngx_dlss.dll');
  const scan = await scanGame(dir);
  assert.ok(scan.exeCandidates.length > 0, 'the executable is offered even without a detected API');
  for (const candidate of scan.exeCandidates) {
    assert.equal(typeof candidate.upscalers, 'object', 'every candidate is inventoried');
    assert.equal(candidate.upscalers.dlss, true);
    assert.equal(candidate.upscalers.any, true);
  }
  assert.equal(scan.chosen.upscalers.dlss, true);
});

// ---------------------------------------------------------------------------
// Task 6.1: the Unreal plugin blind spot.
//
// Found by running the finished chain against the reference machine's real
// library rather than against fixtures. Return to Moria ships
// Engine/Plugins/Runtime/Nvidia/DLSS/Binaries/ThirdParty/Win64/nvngx_dlss.dll
// while its executable sits in Moria/Binaries/Win64. Six directory levels and
// a different branch apart, so the two-level window never saw it, the scan
// reported no upscaler, and the router recommended tier 2 for a game that
// belongs in tier 1. The compatibility list had said so all along.
//
// Unreal is the most common engine there is, and this is exactly where Unreal
// puts third-party runtimes, so the blind spot covered a whole class of games.
const { pluginRoots } = require('../src/core/scan');

const MORIA_DLSS = 'Engine/Plugins/Runtime/Nvidia/DLSS/Binaries/ThirdParty/Win64/nvngx_dlss.dll';

test('the real Return to Moria layout is recognised as shipping DLSS', async (t) => {
  const gameDir = put(temp(t), MORIA_DLSS, 'Moria/Binaries/Win64/Moria-Win64-Shipping.exe');
  const exeDir = path.join(gameDir, 'Moria', 'Binaries', 'Win64');

  const blind = await detectUpscalers(exeDir, { isSigned: never });
  assert.equal(blind.dlss, false, 'without the game folder there is nothing to go on');

  const seeing = await detectUpscalers(exeDir, { gameDir, isSigned: never });
  assert.equal(seeing.dlss, true, 'the engine plugin tree is searched too');
  assert.equal(seeing.any, true, 'which makes this a tier 1 game');
});

test('a plugin the game ships itself is found as well as an engine one', async (t) => {
  const gameDir = put(temp(t), 'Moria/Plugins/DLSSUpscaler/Binaries/ThirdParty/Win64/nvngx_dlss.dll');
  const exeDir = path.join(gameDir, 'Moria', 'Binaries', 'Win64');
  fs.mkdirSync(exeDir, { recursive: true });

  const found = await detectUpscalers(exeDir, { gameDir, isSigned: never });
  assert.equal(found.dlss, true, 'per-project plugins live beside the project, not under Engine');
});

test('an FSR 3.1 runtime in the plugin tree is still put through the signature probe', async (t) => {
  // The signed check decides whether the Adrenalin toggle is offered at all,
  // so finding the file in a new place must not quietly skip it.
  const gameDir = put(temp(t), 'Engine/Plugins/Runtime/AMD/FSR3/Binaries/ThirdParty/Win64/amd_fidelityfx_dx12.dll');
  const exeDir = path.join(gameDir, 'Game', 'Binaries', 'Win64');
  fs.mkdirSync(exeDir, { recursive: true });

  const asked = [];
  const found = await detectUpscalers(exeDir, {
    gameDir,
    isSigned: async (file) => { asked.push(path.basename(file)); return true; }
  });
  assert.equal(found.fsr31, true);
  assert.equal(found.fsr31Signed, true);
  assert.deepEqual(asked, ['amd_fidelityfx_dx12.dll'], 'the probe saw the file it found');
});

test('the two-level window around the executable is unchanged by all this', async (t) => {
  // The widening is deliberately confined to plugin trees. A DLL parked three
  // levels below the executable, in an ordinary folder, is still somebody's
  // backup or an unrelated mod rather than the game shipping an upscaler -
  // and that stays true even when the game folder is known.
  const gameDir = put(temp(t), 'Game/Binaries/Win64/a/b/c/nvngx_dlss.dll');
  const exeDir = path.join(gameDir, 'Game', 'Binaries', 'Win64');

  const found = await detectUpscalers(exeDir, { gameDir, isSigned: never });
  assert.equal(found.dlss, false, 'depth 2 still governs everywhere outside a plugin root');
});

test('files we installed ourselves stay excluded wherever they are found', async (t) => {
  const gameDir = put(temp(t), 'Engine/Plugins/Runtime/AMD/FSR3/Binaries/ThirdParty/Win64/amd_fidelityfx_dx12.dll');
  const exeDir = path.join(gameDir, 'Game', 'Binaries', 'Win64');
  fs.mkdirSync(exeDir, { recursive: true });

  const found = await detectUpscalers(exeDir, {
    gameDir,
    // Written the way a manifest records it: a relative path in the platform's
    // own separator, which on Windows is the backslash.
    added: [path.join('Engine', 'Plugins', 'Runtime', 'AMD', 'FSR3', 'Binaries', 'ThirdParty', 'Win64', 'amd_fidelityfx_dx12.dll')],
    addedRoot: gameDir,
    isSigned: never
  });
  assert.equal(found.fsr31, false, 'the exclusion follows the file, not the folder');
});

test('pluginRoots names the Unreal trees and nothing else', async (t) => {
  const gameDir = put(temp(t),
    'Engine/Plugins/keep.txt',
    'Moria/Plugins/keep.txt',
    'Moria/Content/Paks/keep.txt',
    'Tools/keep.txt');
  const roots = pluginRoots(gameDir)
    .map((dir) => path.relative(gameDir, dir).split(path.sep).join('/'))
    .sort();
  assert.deepEqual(roots, ['Engine/Plugins', 'Moria/Plugins']);
});

test('a game with no plugin tree costs nothing and answers empty', async (t) => {
  const gameDir = put(temp(t), 'UnityPlayer.dll', 'Game.exe');
  assert.deepEqual(pluginRoots(gameDir), [], 'nothing to search');
  assert.deepEqual(pluginRoots(null), [], 'and no game folder is not a crash');
  assert.deepEqual(pluginRoots(path.join(os.tmpdir(), 'gone-' + Date.now())), [], 'nor is a folder that vanished');

  const found = await detectUpscalers(gameDir, { gameDir, isSigned: never });
  assert.deepEqual(found, emptyUpscalers());
});

test('a scanned Unreal game reports the plugin upscaler on its candidates', async (t) => {
  // The end-to-end version of the bug: scanGame is what main.js calls, and it
  // is the path that produced the wrong tier on the reference machine.
  const gameDir = put(temp(t), MORIA_DLSS);
  const exeDir = path.join(gameDir, 'Moria', 'Binaries', 'Win64');
  fs.mkdirSync(exeDir, { recursive: true });
  writePe(path.join(exeDir, 'Moria-Win64-Shipping.exe'), { bitness: 64, size: 300 * 1024 });

  const scan = await scanGame(gameDir);
  assert.ok(scan.chosen, 'the shipping executable is chosen');
  assert.equal(scan.chosen.upscalers.dlss, true, 'and it knows the game ships DLSS');
  assert.equal(scan.chosen.upscalers.any, true);
});
