'use strict';
// Task 4.1: choosing frame generation.
//
// Table-driven, because the rule is a small decision tree and the value of
// the tests is coverage of its corners rather than depth in any one of them.
const test = require('node:test');
const assert = require('node:assert/strict');
const { planFrameGen, CONFIGURE_AS, NOTES } = require('../src/core/fg-plan');

const RDNA3 = { vendor: 'amd', rdnaGen: 3, fsr4Capable: true };
const RDNA4 = { vendor: 'amd', rdnaGen: 4, fsr4Capable: true };
const RDNA2 = { vendor: 'amd', rdnaGen: 2, fsr4Capable: false };

const NONE = {};
const DLSSG = { dlss: true, dlssg: true, any: true };
const FSRFG = { fsr31: true, fsrfg: true, any: true };

const dx12 = { api: 'dxgi', apiLabel: 'DirectX 12', bitness: 64 };
const dx11 = { api: 'dxgi', apiLabel: 'DirectX 11', bitness: 64 };
const vulkan = { api: 'vulkan', apiLabel: 'Vulkan', bitness: 64 };
const opengl = { api: 'opengl', apiLabel: 'OpenGL', bitness: 64 };
const dx9 = { api: 'd3d9', apiLabel: 'DirectX 9', bitness: 32 };

const CASES = [
  // [why, input, expected fg]
  ['a game with its own FSR frame generation is left alone',
    { ...dx12, upscalers: FSRFG, gpu: RDNA3, route: 'amd-optiscaler' }, 'native'],
  ['even when another method would be available',
    { ...dx12, upscalers: { ...FSRFG, dlssg: true }, gpu: RDNA4, route: 'amd-optiscaler' }, 'native'],
  ['and even on the driver route, where we install nothing',
    { ...dx12, upscalers: FSRFG, gpu: RDNA3, route: 'amd-driver' }, 'native'],

  ['DLSS frame generation in DirectX 12 is answered with FSR instead',
    { ...dx12, upscalers: DLSSG, gpu: RDNA3, route: 'amd-optiscaler' }, 'nukem'],
  ['the same in Vulkan, where that conversion also works',
    { ...vulkan, upscalers: DLSSG, gpu: RDNA3, route: 'amd-optiscaler' }, 'nukem'],
  ['but not in DirectX 11, where it does not',
    { ...dx11, upscalers: DLSSG, gpu: RDNA3, route: 'amd-optiscaler' }, 'afmf'],

  ['a DirectX 12 game with no frame generation gets it from the upscaler',
    { ...dx12, upscalers: NONE, gpu: RDNA3, route: 'amd-optiscaler' }, 'optifg'],
  ['including on the engine route, which installs the same thing',
    { ...dx12, upscalers: NONE, gpu: RDNA3, route: 'engine-upscale' }, 'optifg'],
  ['but not on a route that installs nothing to generate from',
    { ...dx12, upscalers: NONE, gpu: RDNA3, route: 'amd-driver' }, 'afmf'],
  ['and not on the spatial fallback either',
    { ...dx12, upscalers: NONE, gpu: RDNA3, route: 'spatial' }, 'afmf'],

  ['DirectX 11 falls to the driver, because that path is DirectX 12 only',
    { ...dx11, upscalers: NONE, gpu: RDNA3, route: 'amd-optiscaler' }, 'afmf'],
  ['Vulkan without DLSS frame generation does too',
    { ...vulkan, upscalers: NONE, gpu: RDNA3, route: 'amd-optiscaler' }, 'afmf'],
  ['OpenGL has only the driver, and the driver does reach it',
    { ...opengl, upscalers: NONE, gpu: RDNA3, route: 'spatial' }, 'afmf'],
  ['a 32-bit DirectX 9 game likewise',
    { ...dx9, upscalers: NONE, gpu: RDNA2, route: 'spatial' }, 'afmf'],
  ['an RDNA2 card is no different here: frame generation is not the ML part',
    { ...dx12, upscalers: NONE, gpu: RDNA2, route: 'amd-optiscaler' }, 'optifg'],
  ['nothing known at all still answers, with the one that works anywhere',
    {}, 'afmf']
];

test('the frame generation decision covers every corner of its own rule', () => {
  for (const [why, input, expected] of CASES) {
    assert.equal(planFrameGen(input).fg, expected, why);
  }
  assert.ok(CASES.length >= 14, 'and the table is worth having');
});

test('every answer carries how to configure it and why it was chosen', () => {
  for (const [why, input] of CASES) {
    const plan = planFrameGen(input);
    assert.equal(plan.configureAs, CONFIGURE_AS[plan.fg], why);
    assert.equal(plan.note, NOTES[plan.fg], why);
    assert.ok(['none', 'nukem', 'optifg'].includes(plan.configureAs), `${plan.configureAs} is not an OptiScaler option`);
  }
});

test('the two answers that happen outside OptiScaler tell it to do nothing', () => {
  // Otherwise the game would get two generators at once, which is worse than
  // either alone.
  assert.equal(planFrameGen({ ...dx12, upscalers: FSRFG, route: 'amd-optiscaler', gpu: RDNA3 }).configureAs, 'none');
  assert.equal(planFrameGen({ ...dx11, upscalers: NONE, route: 'amd-optiscaler', gpu: RDNA3 }).configureAs, 'none');
});

test('an RX 7000 is never told it has the machine-learning frame generation', () => {
  // That is RDNA4 hardware. The same option on RDNA3 runs the FSR 3
  // generator, and promising otherwise would be a lie about the card.
  for (const [, input] of CASES) {
    const plan = planFrameGen({ ...input, gpu: RDNA3 });
    assert.equal(plan.mlFrameGen, false, JSON.stringify(input.upscalers || {}));
  }
  assert.equal(planFrameGen({ ...dx12, upscalers: NONE, gpu: RDNA2, route: 'amd-optiscaler' }).mlFrameGen, false);
  assert.equal(planFrameGen({ ...dx12, upscalers: NONE, gpu: RDNA4, route: 'amd-optiscaler' }).mlFrameGen, true);
  // And only where FSR frame generation is what actually runs.
  assert.equal(planFrameGen({ ...dx12, upscalers: DLSSG, gpu: RDNA4, route: 'amd-optiscaler' }).mlFrameGen, false);
});

test('nothing in, something out: the planner never throws', () => {
  for (const input of [undefined, null, {}, { upscalers: null }, { gpu: null }, { api: 'dxgi' }]) {
    const plan = planFrameGen(input || undefined);
    assert.ok(NOTES[plan.fg], JSON.stringify(input));
    assert.equal(typeof plan.mlFrameGen, 'boolean');
  }
});

test('the driver answer is the floor, and it is a real answer rather than a shrug', () => {
  // Frame generation tolerates estimated motion in a way upscaling does not:
  // an error lives one frame and is gone. That is why this one is worth
  // offering at all, and it is the reason it reaches OpenGL and DirectX 9.
  for (const target of [opengl, dx9, dx11]) {
    assert.equal(planFrameGen({ ...target, upscalers: NONE, gpu: RDNA3, route: 'spatial' }).fg, 'afmf');
  }
});
