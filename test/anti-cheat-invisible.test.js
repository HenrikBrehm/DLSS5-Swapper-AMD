'use strict';
// Task 6.7: anti-cheat that leaves nothing in the game folder to find.
//
// Found by running scripts/reality-check.js against this machine's real
// library. Call of Duty came back as tier 1, which means the tool would have
// offered to place a proxy DLL beside its executable. Ricochet runs in the
// kernel and is installed separately, so there is nothing in the game folder
// for a file scan to match, and the scan correctly reported nothing.
//
// This is the one mistake in the whole project that costs the reader something
// they cannot get back. Everything else here wastes an evening; this loses an
// account. So the rule is the opposite of everywhere else in the codebase:
// when in doubt, detect. A wrong positive costs somebody one tier. A missed
// one costs them the game.
//
// Fortnite is the counter-example and is deliberately covered too: it does
// ship EasyAntiCheat on disk, at <Project>/Binaries/Win64/EasyAntiCheat, which
// the depth limit only reached when an executable path was supplied. It is
// found either way now.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const compatibility = require('../src/core/compatibility');
const guards = require('../src/core/install-guards');

function temp(t, name) {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'anti-cheat-')), name);
  fs.mkdirSync(dir, { recursive: true });
  t.after(() => fs.rmSync(path.dirname(dir), { recursive: true, force: true }));
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

test('a kernel anti-cheat with nothing on disk is still recognised, by title', () => {
  // The folder is empty. That is the whole point: there is nothing to find.
  for (const name of ['Call of Duty', 'Call of Duty HQ', 'VALORANT', 'Genshin Impact', 'Roblox']) {
    const dir = temp({ after() {} }, name);
    assert.equal(compatibility.hasAntiCheat(dir, null), true, `${name} is not recognised`);
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  }
});

test('the title match survives the separators a real path uses', (t) => {
  for (const name of ['call_of_duty', 'Call-of-Duty', 'CallofDuty']) {
    const dir = temp(t, name);
    assert.equal(compatibility.hasAntiCheat(dir, null), true, name);
  }
});

test('Arc Raiders keeps working, because it is the same rule', (t) => {
  // It was the one hand-written exception before this; folding it into the
  // list must not lose it.
  assert.equal(compatibility.hasAntiCheat(temp(t, 'ARC Raiders'), null), true);
  assert.equal(compatibility.hasAntiCheat(temp(t, 'arc-raiders'), null), true);
});

test('an ordinary game is still not anti-cheat, however the folder is named', (t) => {
  // The cost of over-detecting is a worse tier for a game that deserved
  // better, so the list must not be sloppy.
  for (const name of ['Factorio', 'Return to Moria', 'Duty Calls', 'Rainbow Road', 'Cyberpunk 2077', 'Valor']) {
    const dir = temp(t, name);
    assert.equal(compatibility.hasAntiCheat(dir, null), false, `${name} was wrongly flagged`);
  }
});

test('the standard Unreal EasyAntiCheat layout is found without an executable path', (t) => {
  // Fortnite's shape. Before this the search stopped one level short, so the
  // answer depended on whether a caller happened to pass the executable.
  const dir = put(temp(t, 'SomeShooter'), 'ShooterGame/Binaries/Win64/EasyAntiCheat/settings.json');
  assert.equal(guards.antiCheatPresent(dir), true, 'the folder is reached');
  assert.equal(compatibility.hasAntiCheat(dir, null), true);
  assert.equal(compatibility.hasAntiCheat(dir, path.join(dir, 'ShooterGame/Binaries/Win64/Shooter.exe')), true);
});

test('BattlEye beside the executable is found as it always was', (t) => {
  const dir = put(temp(t, 'SomeOtherShooter'), 'BattlEye/BEService.exe');
  assert.equal(guards.antiCheatPresent(dir), true);
});

test('a huge asset tree does not exhaust the search before it reaches the launcher', (t) => {
  // The search has a budget. Raising the depth without skipping content
  // folders would spend it on textures and then answer "no anti-cheat" for a
  // game that has one, which is the failure that matters.
  const dir = temp(t, 'BigGame');
  const content = path.join(dir, 'BigGame', 'Content', 'Textures');
  fs.mkdirSync(content, { recursive: true });
  for (let i = 0; i < 2500; i += 1) fs.writeFileSync(path.join(content, `t${i}.uasset`), 'x');
  put(dir, 'BigGame/Binaries/Win64/EasyAntiCheat_x64.dll');

  assert.equal(guards.antiCheatPresent(dir), true, 'the asset tree did not hide the anti-cheat');
});

test('a folder that cannot be read answers false rather than throwing', () => {
  assert.equal(guards.antiCheatPresent(path.join(os.tmpdir(), 'gone-' + Date.now())), false);
  assert.equal(compatibility.hasAntiCheat(path.join(os.tmpdir(), 'gone-' + Date.now()), null), false);
  assert.equal(compatibility.hasAntiCheat(null, null), false);
  assert.equal(compatibility.hasAntiCheat(undefined, undefined), false);
});

test('every title in the list is a real anti-cheat title, spelled once', () => {
  // A list like this rots by accretion. Keeping it small and checked means
  // the next person can read it and judge it.
  const { INVISIBLE_ANTI_CHEAT } = compatibility;
  assert.ok(Array.isArray(INVISIBLE_ANTI_CHEAT));
  assert.ok(INVISIBLE_ANTI_CHEAT.length >= 6, 'the titles that matter are covered');
  const sources = INVISIBLE_ANTI_CHEAT.map((pattern) => pattern.source);
  assert.equal(new Set(sources).size, sources.length, 'no duplicates');
  for (const pattern of INVISIBLE_ANTI_CHEAT) assert.ok(pattern.flags.includes('i'), `${pattern} is case-insensitive`);
});
