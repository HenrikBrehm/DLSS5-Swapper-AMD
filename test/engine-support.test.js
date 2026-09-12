'use strict';
// Task 2.3: every engine gets an answer about tier 2, and the answer says
// what is actually missing.
//
// A route that is simply not offered reads as a bug. These tests exist to
// make sure nobody is ever left guessing why their game cannot have it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { supportFor, REASONS, REASON_KEYS } = require('../src/core/engine-tweaks');
const { ENGINES, detectEngine } = require('../src/core/engine-detect');
const features = require('../src/shared/feature-i18n');

test('Unreal is the one engine whose slot can be opened from outside', () => {
  const answer = supportFor({ engine: 'unreal', upscalerSlot: true });
  assert.equal(answer.supported, true);
  assert.equal(answer.reason, 'engineSlotUnreal');
  assert.equal(answer.engine, 'unreal');
});

test('every engine the detector can name has an answer, and only Unreal says yes', () => {
  for (const engine of ENGINES) {
    const answer = supportFor(engine);
    assert.equal(typeof answer.reason, 'string', engine);
    assert.ok(answer.reason.length > 0, engine);
    assert.equal(answer.supported, engine === 'unreal', engine);
  }
  // No engine is missing from the table, and none was invented for it.
  assert.deepEqual(Object.keys(REASONS).sort(), [...ENGINES].sort());
});

test('Unity is told the deeper reason, not a generic refusal', () => {
  // Its built-in render pipeline produces no motion vectors at all, so even a
  // switch would have nothing to hand over. That is worth saying.
  assert.equal(supportFor('unity').reason, 'engineNoMotionVectors');
  assert.match(features.t('en', 'engineNoMotionVectors'), /motion vector/i);
  assert.notEqual(supportFor('unity').reason, supportFor('re-engine').reason);
});

test('Source is told it has no temporal pass, which is a different problem again', () => {
  assert.equal(supportFor('source').reason, 'engineNoTemporalPass');
  assert.notEqual(supportFor('source').reason, supportFor('unity').reason);
  assert.notEqual(supportFor('source').reason, supportFor('godot').reason);
});

test('the engines that do have a temporal pass but no way in share that answer', () => {
  // Grouped on purpose: eight near-identical sentences would be padding.
  for (const engine of ['re-engine', 'creation', 'idtech', 'godot', 'cryengine']) {
    assert.equal(supportFor(engine).reason, 'engineNoExternalSwitch', engine);
  }
  assert.match(features.t('en', 'engineNoExternalSwitch'), /config/i);
});

test('an unidentified engine is told that, not that it is unsupported', () => {
  // The difference matters: one is a fact about the engine, the other is a
  // fact about what this application managed to work out.
  const answer = supportFor('unknown');
  assert.equal(answer.reason, 'engineUnknownEngine');
  assert.equal(answer.supported, false);
  assert.notEqual(answer.reason, supportFor('godot').reason);
});

test('nonsense in gets the unknown answer, never a crash and never a yes', () => {
  for (const input of [null, undefined, '', 'frostbite', 42, {}, { engine: 'not-an-engine' }, []]) {
    const answer = supportFor(input);
    assert.equal(answer.supported, false, JSON.stringify(input));
    assert.equal(answer.reason, 'engineUnknownEngine', JSON.stringify(input));
    assert.equal(answer.engine, 'unknown');
  }
});

test('it takes the detector output directly, in the shape the detector returns it', () => {
  const detected = detectEngine(__dirname, null);
  const answer = supportFor(detected);
  assert.equal(answer.engine, detected.engine);
  assert.equal(answer.supported, detected.upscalerSlot);
});

test('every reason exists in all 38 languages, not just English', () => {
  const codes = Object.keys(features.catalog);
  assert.equal(codes.length, 38);
  for (const key of REASON_KEYS) {
    for (const code of codes) {
      const text = features.t(code, key);
      assert.equal(typeof text, 'string', `${code}.${key}`);
      assert.ok(text.trim().length > 0, `${code}.${key}`);
      assert.notEqual(text, key, `${code}.${key} fell back to its own key`);
    }
  }
});

test('the reasons read as explanations, not as apologies or as blame', () => {
  // A person whose game cannot have this has done nothing wrong, and the
  // limit is not the engine developer's fault either.
  for (const key of REASON_KEYS) {
    const text = features.t('en', key);
    assert.ok(text.length > 20, `${key} is too short to explain anything`);
    for (const wrong of ['sorry', 'unfortunately', 'sadly', 'fail', 'error', 'not supported by us']) {
      assert.equal(text.toLowerCase().includes(wrong), false, `${key} should not say "${wrong}"`);
    }
  }
});
