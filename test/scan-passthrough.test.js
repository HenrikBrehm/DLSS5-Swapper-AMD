'use strict';
// Task 6.4: the three gaps the closing report left open on purpose.
//
// They were left because no task owned the files. The reality check showed
// what that costs: scripts/reality-check.js calls scanGame the way any new
// caller would, got a target with no anti-cheat on it, and was one step from
// recommending an injection into a game that bans people for it. main.js
// happens to add the field on its own path, so the application was right and
// everything else was wrong - which is the worst shape for a bug to have,
// because the one place you would test is the one place it works.
//
// So the facts now travel on the target, from the function that produces it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scanGame, UPSCALER_PATTERNS, UPSCALER_INPUTS } = require('../src/core/scan');
const { writePe } = require('./fixtures/pe');

function temp(t, name = 'Game') {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-through-'));
  const dir = path.join(base, name);
  fs.mkdirSync(dir, { recursive: true });
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return dir;
}
function put(dir, ...names) {
  for (const name of names) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'x');
  }
  return dir;
}

test('a scanned game carries its engine on every candidate', async (t) => {
  const dir = temp(t, 'MoriaLike');
  put(dir, 'Moria/Content/Paks/pakchunk0-Windows.pak');
  const exeDir = path.join(dir, 'Moria', 'Binaries', 'Win64');
  fs.mkdirSync(exeDir, { recursive: true });
  writePe(path.join(exeDir, 'Moria-Win64-Shipping.exe'), { bitness: 64, size: 300 * 1024, text: 'D3D12CreateDevice', imports: ['d3d12.dll'] });

  const scan = await scanGame(dir);
  assert.ok(scan.chosen, 'the shipping executable is chosen');
  assert.equal(scan.chosen.engine.engine, 'unreal');
  assert.equal(scan.chosen.engine.upscalerSlot, true, 'which is what tier 2 turns on');
  assert.equal(scan.chosen.engine.projectName, 'Moria');
  for (const candidate of scan.exeCandidates) {
    assert.ok(candidate.engine, 'every candidate carries it, not just the chosen one');
  }
});

test('a game with no recognisable engine says unknown rather than nothing', async (t) => {
  const dir = temp(t);
  writePe(path.join(dir, 'Game.exe'), { bitness: 64, size: 300 * 1024, text: 'D3D12CreateDevice', imports: ['d3d12.dll'] });

  const scan = await scanGame(dir);
  assert.equal(scan.chosen.engine.engine, 'unknown');
  assert.equal(scan.chosen.engine.upscalerSlot, false);
});

test('a scanned game carries anti-cheat on the target, without main.js having to add it', async (t) => {
  // The gap that mattered. Any caller of scanGame now sees the same fact the
  // application sees.
  const dir = temp(t, 'Shooter');
  put(dir, 'ShooterGame/Binaries/Win64/EasyAntiCheat/settings.json');
  const exeDir = path.join(dir, 'ShooterGame', 'Binaries', 'Win64');
  writePe(path.join(exeDir, 'Shooter-Win64-Shipping.exe'), { bitness: 64, size: 300 * 1024, text: 'D3D12CreateDevice', imports: ['d3d12.dll'] });

  const scan = await scanGame(dir);
  assert.equal(scan.chosen.antiCheat, true);
});

test('an ordinary game is marked as having none, not left undefined', async (t) => {
  // undefined and false read the same in an if, and differently in a report.
  const dir = temp(t);
  writePe(path.join(dir, 'Game.exe'), { bitness: 64, size: 300 * 1024, text: 'D3D12CreateDevice', imports: ['d3d12.dll'] });

  const scan = await scanGame(dir);
  assert.equal(scan.chosen.antiCheat, false);
  assert.notEqual(scan.chosen.antiCheat, undefined);
});

test('the inventory knows FSR frame generation, which the frame-gen planner reads', async (t) => {
  // Recorded as an open gap in iteration 18: fg-plan.js branches on
  // upscalers.fsrfg and no pattern could ever set it, so the answer was
  // always "the game has none" whether or not it did.
  assert.ok(Object.hasOwn(UPSCALER_PATTERNS, 'fsrfg'), 'the pattern exists');
  assert.ok(!UPSCALER_INPUTS.includes('fsrfg'), 'but it is not an upscaler input, any more than dlssg is');

  const dir = temp(t);
  put(dir, 'amd_fidelityfx_framegeneration_dx12.dll');
  writePe(path.join(dir, 'Game.exe'), { bitness: 64, size: 300 * 1024, text: 'D3D12CreateDevice', imports: ['d3d12.dll'] });

  const scan = await scanGame(dir);
  assert.equal(scan.chosen.upscalers.fsrfg, true);
  assert.equal(scan.chosen.upscalers.any, false, 'frame generation alone is not an upscaler');
});

test('the router can be handed a scanned target directly and reach tier 2', async (t) => {
  // The end-to-end point of the task: what scanGame produces is now enough on
  // its own, with no caller filling in the missing halves.
  const { route } = require('../src/core/router');
  const dir = temp(t, 'Tier2Like');
  put(dir, 'Proj/Content/Paks/pakchunk0-Windows.pak');
  const exeDir = path.join(dir, 'Proj', 'Binaries', 'Win64');
  fs.mkdirSync(exeDir, { recursive: true });
  writePe(path.join(exeDir, 'Proj-Win64-Shipping.exe'), { bitness: 64, size: 300 * 1024, text: 'D3D12CreateDevice', imports: ['d3d12.dll'] });

  const scan = await scanGame(dir);
  const answer = route(scan.chosen, { vendor: 'amd', fsr4Capable: true }, scan.chosen.engine);
  assert.equal(answer.tier, 2);
  assert.equal(answer.route, 'engine-upscale');
});

test('an anti-cheat game routes to tier 3 straight off a scan', async (t) => {
  const { route } = require('../src/core/router');
  const dir = temp(t, 'ACShooter');
  put(dir, 'Proj/Content/Paks/pakchunk0-Windows.pak', 'Proj/Binaries/Win64/EasyAntiCheat/settings.json');
  const exeDir = path.join(dir, 'Proj', 'Binaries', 'Win64');
  writePe(path.join(exeDir, 'Proj-Win64-Shipping.exe'), { bitness: 64, size: 300 * 1024, text: 'D3D12CreateDevice', imports: ['d3d12.dll'] });

  const scan = await scanGame(dir);
  const answer = route(scan.chosen, { vendor: 'amd', fsr4Capable: true }, scan.chosen.engine);
  assert.equal(answer.tier, 3);
  assert.equal(answer.reason, 'routerAntiCheat');
});
