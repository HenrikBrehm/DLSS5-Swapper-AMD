'use strict';
// Why tier 2 is or is not available for a game, in words a person can act on.
//
// A silent "this route is not offered" is the worst possible answer. It reads
// as a bug, it sends people to forums, and it hides the fact that the limit is
// real rather than an oversight. So every engine gets an answer, and the
// answer says which of the two things is missing.
//
// Two things have to be true for tier 2. The game must produce motion vectors
// and a jittered camera, which any engine with temporal anti-aliasing already
// does. And something must let us claim that temporal pass from outside the
// game, without patching it. Unreal is the only engine here with the second
// part: r.TemporalAA.Upscaler.
//
// The reasons are grouped by what is actually missing rather than split one
// per engine, because writing eight subtly different sentences that all mean
// "no external switch exists" would be padding, not information. Each engine
// still gets the answer that is true for it.
const { ENGINES } = require('../engine-detect');

const REASONS = Object.freeze({
  // The one that works.
  unreal: 'engineSlotUnreal',
  // Deeper than a missing switch: Unity's built-in render pipeline does not
  // produce motion vectors at all, so there would be nothing to hand over
  // even if a switch existed.
  unity: 'engineNoMotionVectors',
  // Source predates temporal anti-aliasing; there is no temporal pass here to
  // claim in the first place.
  source: 'engineNoTemporalPass',
  // These do run a temporal pass. What they lack is any way to redirect it
  // from a configuration file, which is the only lever this tool has.
  're-engine': 'engineNoExternalSwitch',
  creation: 'engineNoExternalSwitch',
  idtech: 'engineNoExternalSwitch',
  godot: 'engineNoExternalSwitch',
  cryengine: 'engineNoExternalSwitch',
  // Not a judgement about the engine, a statement about our knowledge.
  unknown: 'engineUnknownEngine'
});

function supportFor(engine) {
  const name = engine && typeof engine === 'object' ? engine.engine : engine;
  const known = Object.prototype.hasOwnProperty.call(REASONS, name);
  return {
    engine: known ? name : 'unknown',
    supported: known && name === 'unreal',
    reason: known ? REASONS[name] : REASONS.unknown
  };
}

// Every reason key the module can return, for the translation check.
const REASON_KEYS = Object.freeze([...new Set(Object.values(REASONS))]);

module.exports = { supportFor, REASONS, REASON_KEYS, ENGINES };
