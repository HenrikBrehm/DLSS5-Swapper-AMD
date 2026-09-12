'use strict';
// The point of the whole tool: one recommendation per game, with a reason.
//
// Everything before this gathered facts. This turns them into a single
// answer. A list of four routes with no guidance is not help, it is
// homework - and the person asking has no way to know that a Vulkan game
// cannot use the driver toggle, or that editing an Engine.ini for a game
// that already ships FSR would achieve nothing.
//
// Three rules it follows, in order:
//   1. Recommend the highest tier the game can actually reach. The tiers are
//      ranked by result, not by convenience.
//   2. Always give a reason, and make the reason about this game rather than
//      about the tool.
//   3. Never leave an empty answer. Tier 3 reaches everything, so there is
//      always something to say.
const routes = require('../shared/install-routes');
const { planFrameGen } = require('./fg-plan');
const { supportFor } = require('./engine-tweaks');

const REASONS = Object.freeze({
  tier1: 'routerTier1',
  tier2: 'routerTier2',
  antiCheat: 'routerAntiCheat',
  unreachable: 'routerUnreachable',
  nothingToHook: 'routerNothingToHook'
});

// OptiScaler is a 64-bit proxy on DXGI or Vulkan. A game outside that cannot
// take tier 1 or tier 2 however much upscaling it ships, and saying so is
// more useful than silently offering tier 3.
function outOfReach(target, api) {
  return target.bitness !== 64 || Boolean(target.emulator) ||
    !['dxgi', 'vulkan'].includes(api) || target.apiLabel === 'DirectX 10';
}

function reasonFor(recommended, target, api) {
  if (target.antiCheat) return REASONS.antiCheat;
  if (recommended === 'amd-optiscaler') return REASONS.tier1;
  if (recommended === 'engine-upscale') return REASONS.tier2;
  const upscalers = target.upscalers || {};
  // A game that ships an upscaler and still lands in tier 3 was turned away
  // by what it runs on, not by what it has. That is a different sentence.
  if (upscalers.any && outOfReach(target, api)) return REASONS.unreachable;
  return REASONS.nothingToHook;
}

function route(target, gpu, engine) {
  const empty = { tier: null, route: null, fg: null, reason: null, alternatives: [], engineReason: null };
  if (!target || typeof target !== 'object') return empty;

  const api = target.api;
  // The engine travels on the target for routesFor, which is a shared module
  // and cannot look it up itself.
  const withEngine = engine ? { ...target, engine } : target;
  const available = routes.routesFor(withEngine, api, gpu);
  if (!available.length) return empty;

  const recommended = available[0];
  const meta = routes.routeMeta(recommended);
  const plan = planFrameGen({
    api, apiLabel: target.apiLabel, bitness: target.bitness,
    upscalers: target.upscalers, gpu, route: recommended
  });

  return {
    tier: meta ? meta.tier : null,
    route: recommended,
    fg: plan.fg,
    frameGen: plan,
    reason: reasonFor(recommended, withEngine, api),
    alternatives: available.slice(1).map((name) => ({
      route: name, tier: (routes.routeMeta(name) || {}).tier || null
    })),
    // Why the engine could not help, when that is the interesting part. Only
    // said for a game that has no upscaler of its own; for anything else the
    // engine was never the obstacle.
    engineReason: (target.upscalers || {}).any ? null : supportFor(engine).reason
  };
}

module.exports = { route, reasonFor, outOfReach, REASONS };
