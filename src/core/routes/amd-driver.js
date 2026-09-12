'use strict';
// Tier 3, the guided half: everything the Radeon driver can already do.
//
// This route installs nothing. There is no API to switch FSR 4, frame
// generation or Radeon Super Resolution on from outside Adrenalin, so
// pretending otherwise would mean lying about what happened. Instead the
// route works out which of those settings are worth turning on for this
// particular game, says where they are, and records what the person ticked
// off so the answer survives the next session.
//
// It is also the only route offered for a game with anti-cheat. Nothing is
// injected, no file beside the executable is touched, so there is nothing
// for an anti-cheat system to object to.
const fs = require('fs');
const path = require('path');

// Every step this route can suggest, in the order a person would do them.
// `applies` is answered per game: an option that cannot possibly help is
// worse than no option, because it sends someone looking for a setting that
// will not change anything.
const STEPS = Object.freeze([
  'fsr4Toggle', 'afmf', 'rsr', 'antiLag2', 'optiscalerFallback'
]);
const I18N = Object.freeze({
  fsr4Toggle: 'driverStepFsr4',
  afmf: 'driverStepAfmf',
  rsr: 'driverStepRsr',
  antiLag2: 'driverStepAntiLag',
  optiscalerFallback: 'driverStepVulkanFallback'
});
// DirectDraw and DirectX 8 reach the card only through a 32-bit wrapper, and
// the driver's own frame generation never sees them.
const NO_DRIVER_APIS = Object.freeze(['d3d8', 'ddraw']);

function appliesTo(step, target = {}, gpu = {}) {
  const upscalers = target.upscalers || {};
  const api = target.api;
  switch (step) {
    // Only a signed FSR 3.1 runtime can be swapped for FSR 4 by the driver,
    // and only in DirectX 12. Offering it anywhere else sends someone to a
    // toggle that silently does nothing.
    case 'fsr4Toggle':
      return Boolean(upscalers.fsr31Signed) && target.apiLabel === 'DirectX 12' && Boolean(gpu.fsr4Capable);
    case 'afmf':
      return !NO_DRIVER_APIS.includes(api);
    case 'rsr':
    case 'antiLag2':
      return true;
    // The driver's FSR 4 override does not reach Vulkan. A Vulkan game that
    // ships FSR 3.1 can still get there, but only through OptiScaler.
    case 'optiscalerFallback':
      return api === 'vulkan' && Boolean(upscalers.fsr31);
    default:
      return false;
  }
}

function steps(target = {}, gpu = {}) {
  return STEPS.map((id) => ({ id, i18nKey: I18N[id], applies: appliesTo(id, target, gpu) }));
}

// Where Adrenalin lives, when it is installed. Returned rather than opened:
// launching another program is the interface's decision, not this module's.
function adrenalinPath(env = process.env) {
  // The given environment is authoritative. Falling back to a hardcoded
  // path alongside it would ignore a machine whose Program Files lives
  // elsewhere, and would quietly find the real installation even when the
  // caller asked about somewhere else entirely.
  const roots = [env['ProgramFiles'], env['ProgramW6432']].filter(Boolean);
  if (!roots.length) roots.push('C:\\Program Files');
  for (const root of roots) {
    const file = path.join(root, 'AMD', 'CNext', 'CNext', 'RadeonSoftware.exe');
    try { if (fs.existsSync(file)) return file; } catch { /* not readable, not usable */ }
  }
  return null;
}

async function install(config, log = () => {}) {
  const { beginManifest, saveActiveManifest } = require('../apply');
  const { gameDir, exePath, api, gpu = {} } = config;
  const manifest = beginManifest(gameDir, exePath, api);
  manifest.route = 'amd-driver';
  manifest.game.apiLabel = config.apiLabel;
  // Nothing is copied and nothing is replaced. The record exists so the
  // library can show which game is on this route and what was ticked off.
  manifest.checklist = {};
  manifest.driverSteps = steps(config, gpu).filter((step) => step.applies).map((step) => step.id);
  await saveActiveManifest(gameDir, manifest);
  log({ code: 'backendSwitching', params: { from: 'none', to: 'amd-driver' } });
  return manifest;
}

module.exports = { steps, appliesTo, adrenalinPath, install, STEPS, I18N, NO_DRIVER_APIS };
