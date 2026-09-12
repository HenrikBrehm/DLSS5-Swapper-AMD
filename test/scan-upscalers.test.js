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
  assert.deepEqual(Object.keys(emptyUpscalers()).sort(),
    ['any', 'dlss', 'dlssg', 'fsr2', 'fsr31', 'fsr31Signed', 'streamline', 'xess']);
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
