'use strict';
// Tier 3, the last resort: spatial upscaling.
//
// This is what remains for a game that ships no upscaler and runs on an
// engine with nothing to hand over. It is worth being straight about what it
// is. A spatial upscaler sharpens a smaller picture. It has no motion
// vectors and no history, so it cannot reconstruct detail the way FSR 4
// does, and it will not look the same. What it does have is that it works
// absolutely everywhere, including in games older than the idea of
// temporal anti-aliasing.
//
// Like the driver route, this one installs nothing. It works out a sensible
// render resolution, says where to set it, and points at the two tools that
// can do the scaling - one in the driver, one outside it. Magpie is neither
// bundled nor downloaded nor started: it is looked for, and linked.
const fs = require('fs');
const path = require('path');

// The same per-axis ratios every upscaler calls by these names, so the
// numbers here line up with what a person sees elsewhere.
const PRESETS = Object.freeze([
  Object.freeze({ id: 'quality', ratio: 1.5 }),
  Object.freeze({ id: 'balanced', ratio: 1.7 }),
  Object.freeze({ id: 'performance', ratio: 2.0 })
]);

const STEPS = Object.freeze(['setResolution', 'rsr', 'magpie']);
const I18N = Object.freeze({
  setResolution: 'spatialStepResolution',
  rsr: 'spatialStepRsr',
  magpie: 'spatialStepMagpie'
});
// Said before any of the steps, because someone arriving here after reading
// about FSR 4 deserves to know this is a different thing.
const HONESTY_KEY = 'spatialHonest';

// Rounded to even numbers: an odd render width upsets chroma subsampling in
// capture and streaming, and no game offers one anyway. The result is
// guidance - pick the nearest entry the game actually lists.
const even = (value) => Math.max(2, Math.round(value / 2) * 2);

function resolutions(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2) return [];
  return PRESETS.map(({ id, ratio }) => ({
    id, ratio,
    width: even(width / ratio),
    height: even(height / ratio),
    percent: Math.round(100 / ratio)
  }));
}

// Magpie, if it is installed. Never bundled, never fetched, never launched
// from here: this only answers whether pointing at it is useful.
function magpiePath(env = process.env) {
  const candidates = [
    env['ProgramFiles'] && path.join(env['ProgramFiles'], 'Magpie', 'Magpie.exe'),
    env['LOCALAPPDATA'] && path.join(env['LOCALAPPDATA'], 'Programs', 'Magpie', 'Magpie.exe')
  ].filter(Boolean);
  for (const file of candidates) {
    try { if (fs.existsSync(file)) return file; } catch { /* not readable, not usable */ }
  }
  return null;
}

function steps(target = {}, display = null, env = process.env) {
  const found = magpiePath(env);
  return STEPS.map((id) => ({
    id,
    i18nKey: I18N[id],
    // Every step applies: this route is the floor, and something here works
    // for any game at all.
    applies: true,
    ...(id === 'setResolution' ? { resolutions: resolutions(display && display.width, display && display.height) } : {}),
    ...(id === 'magpie' ? { installed: Boolean(found), path: found } : {})
  }));
}

async function install(config, log = () => {}) {
  const { beginManifest, saveActiveManifest } = require('../apply');
  const { gameDir, exePath, api } = config;
  const manifest = beginManifest(gameDir, exePath, api);
  manifest.route = 'spatial';
  manifest.game.apiLabel = config.apiLabel;
  manifest.checklist = {};
  manifest.spatial = {
    display: config.display ? { width: config.display.width, height: config.display.height } : null,
    resolutions: resolutions(config.display && config.display.width, config.display && config.display.height)
  };
  await saveActiveManifest(gameDir, manifest);
  log({ code: 'backendSwitching', params: { from: 'none', to: 'spatial' } });
  return manifest;
}

module.exports = { steps, resolutions, magpiePath, install, PRESETS, STEPS, I18N, HONESTY_KEY };
