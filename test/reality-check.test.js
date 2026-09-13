'use strict';
// Task 6.3: the question "does it work everywhere" turned into something a
// machine can answer.
//
// The whole chain was green on 517 tests while quietly giving the wrong tier
// for the reference machine's most important game. What caught it was not a
// test but running the real chain against the real library once. That was a
// throwaway script, so the next person would have had to think of it again.
//
// This is that script's judgement, as a pure function. It takes the facts a
// scan already produces and says which tier each game reaches, how many get
// real upscaling and how many only get the fallback - because "every game
// gets an answer" and "every game gets upscaling" are different claims, and
// the second one is not true.
const test = require('node:test');
const assert = require('node:assert/strict');
const { assess, summarise, render, REAL_TIERS } = require('../src/core/reality-check');

const RADEON = Object.freeze({ name: 'AMD Radeon RX 7900 XT', vendor: 'amd', rdnaGen: 3, fsr4Capable: true, adrenalin: '26.8.1' });

function game(over = {}) {
  const { engine = { engine: 'unknown', upscalerSlot: false }, chosen, ...rest } = over;
  return {
    name: 'A Game', dir: 'C:/games/a', gpu: RADEON, engine,
    scan: { chosen: chosen === null ? null : { bitness: 64, api: 'dxgi', apiLabel: 'DirectX 12', path: 'C:/games/a/a.exe', upscalers: {}, ...chosen } },
    ...rest
  };
}

test('a game that ships an upscaler is assessed as tier 1 and real upscaling', () => {
  const row = assess(game({ chosen: { upscalers: { any: true, dlss: true } } }));
  assert.equal(row.tier, 1);
  assert.equal(row.route, 'amd-optiscaler');
  assert.equal(row.realUpscaling, true);
  assert.equal(row.reason, 'routerTier1');
  assert.deepEqual(row.inputs, ['dlss'], 'it names what the game already has');
});

test('an Unreal game with no upscaler is tier 2, and that is still real upscaling', () => {
  const row = assess(game({ engine: { engine: 'unreal', upscalerSlot: true, version: '5.1.0' } }));
  assert.equal(row.tier, 2);
  assert.equal(row.route, 'engine-upscale');
  assert.equal(row.realUpscaling, true);
  assert.deepEqual(row.inputs, [], 'it has none of its own');
  assert.equal(row.engine, 'unreal');
});

test('a Unity game with no upscaler is tier 3, and that is not upscaling', () => {
  // The honest half of the answer. Tier 3 sharpens a smaller picture; it
  // cannot put back detail that was never rendered.
  const row = assess(game({ engine: { engine: 'unity', upscalerSlot: false } }));
  assert.equal(row.tier, 3);
  assert.equal(row.realUpscaling, false, 'the fallback is not the same thing');
  assert.equal(row.engineReason, 'engineNoMotionVectors', 'and it says why, about this engine');
});

test('an anti-cheat game is tier 3 whatever it ships', () => {
  const row = assess(game({ chosen: { antiCheat: true, upscalers: { any: true, dlss: true } } }));
  assert.equal(row.tier, 3);
  assert.equal(row.realUpscaling, false);
  assert.equal(row.reason, 'routerAntiCheat');
});

test('a folder with no executable is reported as such, not silently dropped', () => {
  const row = assess(game({ chosen: null }));
  assert.equal(row.assessed, false);
  assert.equal(row.problem, 'noExecutable');
  assert.equal(row.tier, null);
  assert.equal(row.realUpscaling, false);
});

test('a game whose API OptiScaler cannot reach says so, rather than blaming the game', () => {
  // Risk of Rain 2 is OpenGL. It could ship every upscaler there is and still
  // not be reachable, and that is a different sentence from "it has none".
  const row = assess(game({ chosen: { api: 'opengl', apiLabel: 'OpenGL', upscalers: { any: true, dlss: true } } }));
  assert.equal(row.tier, 3);
  assert.equal(row.reason, 'routerUnreachable');
});

test('summarise counts what a person actually wants to know', () => {
  const rows = [
    assess(game({ chosen: { upscalers: { any: true, dlss: true } } })),
    assess(game({ engine: { engine: 'unreal', upscalerSlot: true } })),
    assess(game({ engine: { engine: 'unity', upscalerSlot: false } })),
    assess(game({ chosen: { api: 'opengl', apiLabel: 'OpenGL' } })),
    assess(game({ chosen: null }))
  ];
  const total = summarise(rows);
  assert.equal(total.games, 5);
  assert.equal(total.assessed, 4);
  assert.equal(total.real, 2, 'tier 1 and tier 2');
  assert.equal(total.fallback, 2, 'tier 3');
  assert.equal(total.unassessed, 1);
  assert.deepEqual(total.byTier, { 1: 1, 2: 1, 3: 2 });
});

test('REAL_TIERS is the one place that decides what counts as upscaling', () => {
  assert.deepEqual([...REAL_TIERS].sort(), [1, 2]);
});

test('render produces a report that names the limit instead of hiding it', () => {
  const rows = [
    assess(game({ name: 'Moria', chosen: { upscalers: { any: true, dlss: true } } })),
    assess(game({ name: 'Factorio', chosen: { apiLabel: 'DirectX 11' } }))
  ];
  const text = render(rows, RADEON);
  assert.match(text, /Moria/);
  assert.match(text, /Factorio/);
  assert.match(text, /RX 7900 XT/, 'the card the answer depends on is named');
  assert.match(text, /1 of 2/, 'and how many actually get real upscaling');
  assert.doesNotMatch(text, /undefined|\[object/, 'nothing half-formatted reaches the reader');
});

test('render survives a row it could not assess', () => {
  const text = render([assess(game({ name: 'Empty', chosen: null }))], RADEON);
  assert.match(text, /Empty/);
  assert.match(text, /0 of 1/);
});

test('assess never throws on a malformed row, it reports the problem', () => {
  for (const bad of [undefined, null, {}, { scan: null }, { scan: {} }, { scan: { chosen: {} } }]) {
    const row = assess(bad);
    assert.equal(typeof row, 'object');
    assert.equal(row.realUpscaling, false);
    assert.ok(row.problem || row.tier, 'either it answered or it said why not');
  }
});
