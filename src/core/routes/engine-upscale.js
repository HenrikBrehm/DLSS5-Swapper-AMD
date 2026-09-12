'use strict';
// Tier 2: a game that ships no upscaler at all, reaching FSR 4 through its
// own engine.
//
// Two halves that only work together. The engine half opens Unreal's upscaler
// slot, which makes the game offer the temporal pass to a plugin instead of
// resolving it itself. The OptiScaler half is the plugin that answers. Either
// one alone does nothing useful, so they share a manifest and are undone
// together.
//
// The default is deliberately different from tier 1: no spoofing. There is no
// DLSS here to pretend at - the engine is handing the inputs over directly,
// and telling the game it has an NVIDIA card would only add risk.
//
// One thing worth knowing and saying out loud: the engine half edits a file
// Unreal keeps per game under %LOCALAPPDATA%, outside the game folder. It
// applies to that game however it is launched, not only through this
// application. Restore puts it back.
const amdOptiscaler = require('./amd-optiscaler');
const unreal = require('../engine-tweaks/unreal');

async function install(config, log = () => {}) {
  const { saveActiveManifest } = require('../apply');
  const { gameDir, engine, options = {} } = config;

  // Validate the engine before a single file is copied: plan() throws for an
  // engine with no slot and for a nonsense render scale, and neither should
  // leave a half-installed game behind.
  unreal.plan(engine, options);

  const manifest = await amdOptiscaler.install({
    ...config,
    // Named explicitly so the frame-generation record in the manifest says
    // which route actually made the choice, rather than the one whose
    // installer happened to run it.
    planRoute: 'engine-upscale',
    options: { inputs: 'none', ...options }
  }, log);
  manifest.route = 'engine-upscale';

  unreal.apply(manifest, gameDir, engine, options);
  await saveActiveManifest(gameDir, manifest);
  return manifest;
}

// Undoing the engine half. Kept here rather than in the generic restore
// because core.restore only knows about files inside the game folder, and
// this one is not.
function restoreEngineConfig(manifest, gameDir) {
  return unreal.restore(manifest, gameDir);
}

module.exports = { install, restoreEngineConfig };
