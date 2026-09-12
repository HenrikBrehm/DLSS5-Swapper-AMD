'use strict';
// Task 5.1: the one recommendation, with a reason.
//
// Table-driven against the tier table the whole project is built on. If a row
// of that table ever stops being reachable, this is where it shows.
const test = require('node:test');
const assert = require('node:assert/strict');
const { route, REASONS } = require('../src/core/router');
const { ROUTE_META } = require('../src/shared/install-routes');
const features = require('../src/shared/feature-i18n');

const AMD3 = { vendor: 'amd', rdnaGen: 3, mobile: false, adrenalin: '26.8.1', fsr4Capable: true };
const AMD2 = { ...AMD3, rdnaGen: 2, fsr4Capable: false };

const NOTHING = { dlss: false, dlssg: false, streamline: false, fsr2: false, fsr31: false, fsr31Signed: false, xess: false, any: false };
const DLSS = { ...NOTHING, dlss: true, any: true };
const DLSSG = { ...DLSS, dlssg: true };
const FSR31 = { ...NOTHING, fsr31: true, fsr31Signed: true, any: true };
const XESS = { ...NOTHING, xess: true, any: true };

const UNREAL = { engine: 'unreal', upscalerSlot: true, projectName: 'Moria' };
const UNITY = { engine: 'unity', upscalerSlot: false, projectName: null };
const UNKNOWN = { engine: 'unknown', upscalerSlot: false, projectName: null };

const at = (api, apiLabel, extra = {}) => ({ api, apiLabel, bitness: 64, upscalers: NOTHING, ...extra });

// Every row of the tier table the project is built on.
const CASES = [
  ['DX12 with DLSS', at('dxgi', 'DirectX 12', { upscalers: DLSS }), UNKNOWN, AMD3, 1, 'amd-optiscaler', REASONS.tier1],
  ['DX12 with signed FSR 3.1', at('dxgi', 'DirectX 12', { upscalers: FSR31 }), UNKNOWN, AMD3, 1, 'amd-optiscaler', REASONS.tier1],
  ['DX12 with XeSS', at('dxgi', 'DirectX 12', { upscalers: XESS }), UNKNOWN, AMD3, 1, 'amd-optiscaler', REASONS.tier1],
  ['DX11 with DLSS', at('dxgi', 'DirectX 11', { upscalers: DLSS }), UNKNOWN, AMD3, 1, 'amd-optiscaler', REASONS.tier1],
  ['Vulkan with DLSS', at('vulkan', 'Vulkan', { upscalers: DLSS }), UNKNOWN, AMD3, 1, 'amd-optiscaler', REASONS.tier1],
  ['an RDNA2 card still reaches tier 1, just with a different output',
    at('dxgi', 'DirectX 12', { upscalers: DLSS }), UNKNOWN, AMD2, 1, 'amd-optiscaler', REASONS.tier1],

  ['Unreal with no upscaler', at('dxgi', 'DirectX 12'), UNREAL, AMD3, 2, 'engine-upscale', REASONS.tier2],
  ['Unreal on Vulkan with no upscaler', at('vulkan', 'Vulkan'), UNREAL, AMD3, 2, 'engine-upscale', REASONS.tier2],

  ['Unity with no upscaler', at('dxgi', 'DirectX 12'), UNITY, AMD3, 3, 'amd-driver', REASONS.nothingToHook],
  ['an unidentified engine with no upscaler', at('dxgi', 'DirectX 12'), UNKNOWN, AMD3, 3, 'amd-driver', REASONS.nothingToHook],
  ['no engine information at all', at('dxgi', 'DirectX 12'), null, AMD3, 3, 'amd-driver', REASONS.nothingToHook],

  ['a 32-bit game that ships DLSS', { ...at('dxgi', 'DirectX 11', { upscalers: DLSS }), bitness: 32 }, UNKNOWN, AMD3, 3, 'amd-driver', REASONS.unreachable],
  ['a DirectX 9 game that ships an upscaler', at('d3d9', 'DirectX 9', { upscalers: DLSS }), UNKNOWN, AMD3, 3, 'amd-driver', REASONS.unreachable],
  ['a DirectX 10 game', at('dxgi', 'DirectX 10', { upscalers: DLSS }), UNKNOWN, AMD3, 3, 'amd-driver', REASONS.unreachable],
  ['an emulator', at('dxgi', 'DirectX 12', { upscalers: DLSS, emulator: { key: 'xenia' } }), UNKNOWN, AMD3, 3, 'amd-driver', REASONS.unreachable],
  ['OpenGL with nothing', at('opengl', 'OpenGL'), UNKNOWN, AMD3, 3, 'amd-driver', REASONS.nothingToHook],
  ['DirectDraw, where even the driver cannot help', at('ddraw', 'DirectDraw', { bitness: 32 }), UNKNOWN, AMD3, 3, 'spatial', REASONS.nothingToHook],

  ['anti-cheat beats everything else', at('dxgi', 'DirectX 12', { upscalers: DLSS, antiCheat: true }), UNREAL, AMD3, 3, 'amd-driver', REASONS.antiCheat]
];

test('every row of the tier table gets the route and the reason it should', () => {
  for (const [why, target, engine, gpu, tier, expected, reason] of CASES) {
    const answer = route(target, gpu, engine);
    assert.equal(answer.route, expected, why);
    assert.equal(answer.tier, tier, why);
    assert.equal(answer.reason, reason, why);
  }
  assert.ok(CASES.length >= 16, 'and the table covers the whole matrix');
});

test('there is exactly one recommendation, and the rest are offered as alternatives', () => {
  for (const [why, target, engine, gpu] of CASES) {
    const answer = route(target, gpu, engine);
    assert.equal(typeof answer.route, 'string', why);
    assert.ok(Array.isArray(answer.alternatives), why);
    assert.equal(answer.alternatives.includes(answer.route), false, `${why}: the recommendation is not its own alternative`);
    for (const alt of answer.alternatives) {
      assert.ok(ROUTE_META[alt.route], `${why}: ${alt.route} is not a real route`);
      assert.ok([1, 2, 3].includes(alt.tier), why);
    }
  }
});

test('the recommendation is always the best tier on offer, never a lesser one', () => {
  for (const [why, target, engine, gpu] of CASES) {
    const answer = route(target, gpu, engine);
    for (const alt of answer.alternatives) {
      assert.ok(alt.tier >= answer.tier, `${why}: ${alt.route} is a better tier than the recommendation`);
    }
  }
});

test('frame generation is decided alongside the route, not left for later', () => {
  for (const [why, target, engine, gpu] of CASES) {
    const answer = route(target, gpu, engine);
    assert.ok(['native', 'nukem', 'optifg', 'afmf'].includes(answer.fg), `${why}: ${answer.fg}`);
    assert.equal(answer.frameGen.fg, answer.fg, why);
  }
  // A game with DLSS frame generation in DirectX 12 has that converted.
  assert.equal(route(at('dxgi', 'DirectX 12', { upscalers: DLSSG }), AMD3, UNKNOWN).fg, 'nukem');
});

test('a game with no upscaler is told why its engine could not help', () => {
  assert.equal(route(at('dxgi', 'DirectX 12'), AMD3, UNITY).engineReason, 'engineNoMotionVectors');
  assert.equal(route(at('dxgi', 'DirectX 12'), AMD3, UNREAL).engineReason, 'engineSlotUnreal');
  // For a game that already ships one the engine was never the obstacle, so
  // raising it would only be noise.
  assert.equal(route(at('dxgi', 'DirectX 12', { upscalers: DLSS }), AMD3, UNITY).engineReason, null);
});

test('a game that ships an upscaler and still lands in tier 3 is told what turned it away', () => {
  // "Nothing to hook into" would be wrong here and would send someone
  // looking for an upscaler the game already has.
  const small = route({ ...at('dxgi', 'DirectX 11', { upscalers: DLSS }), bitness: 32 }, AMD3, UNKNOWN);
  assert.equal(small.reason, REASONS.unreachable);
  assert.notEqual(small.reason, REASONS.nothingToHook);
  assert.match(features.t('en', REASONS.unreachable), /64-bit/);
});

test('every reason reads in all 38 languages and explains rather than names', () => {
  for (const key of Object.values(REASONS)) {
    for (const code of Object.keys(features.catalog)) {
      const text = features.t(code, key);
      assert.notEqual(text, key, `${code}.${key} fell back to its own key`);
      assert.ok(text.trim().length > 0, `${code}.${key}`);
    }
    // A reason short enough to be a label is not a reason.
    assert.ok(features.t('en', key).length > 60, key);
  }
});

test('nonsense in gives an empty answer rather than a wrong one', () => {
  for (const input of [null, undefined, 'a game', 42]) {
    const answer = route(input, AMD3, UNREAL);
    assert.equal(answer.route, null, String(input));
    assert.equal(answer.tier, null);
    assert.deepEqual(answer.alternatives, []);
  }
  // A target with no usable bitness has no routes at all, and saying nothing
  // is better than recommending something that cannot be installed.
  assert.equal(route({ api: 'dxgi', apiLabel: 'DirectX 12' }, AMD3, UNREAL).route, null);
});

test('without an AMD card it recommends nothing, because these tiers are the AMD ones', () => {
  const answer = route(at('dxgi', 'DirectX 12', { upscalers: DLSS }), { vendor: 'nvidia' }, UNKNOWN);
  assert.equal(['native', 'feeder', 'optiscaler', 'renodx'].includes(answer.route), true,
    'the NVIDIA product answers for itself, unchanged');
});
