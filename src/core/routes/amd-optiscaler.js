'use strict';
// The tier 1 route: turn whatever upscaler a game already ships into FSR 4.
//
// Structurally this is the NVIDIA OptiScaler route's twin, and deliberately
// so - the same manifest shape, the same tracked copies, the same restore.
// What differs is the payload (upstream OptiScaler rather than the DLSS-NR
// fork), the configuration (configureAmd rather than the neural-rendering
// one), and the fact that nothing here needs a model file from the user.
const path = require('path');
const upstream = require('../optiscaler-upstream');
const optiscaler = require('../optiscaler');
const ini = require('../feeder-config');
const { planFrameGen } = require('../fg-plan');

async function install(config, log = () => {}) {
  const { beginManifest, copyTracked, writeTracked, saveActiveManifest } = require('../apply');
  const { gameDir, exePath, api, optiRoot, gpu, options = {}, previousManifest = null } = config;

  // Refuse before touching anything, so a bad payload or a foreign injector
  // never leaves a half-installed folder behind.
  upstream.validateUpstreamPayload(optiRoot);
  optiscaler.checkConflicts(gameDir, exePath, previousManifest, api);

  const manifest = beginManifest(gameDir, exePath, api);
  manifest.route = 'amd-optiscaler';
  manifest.game.bitness = 64;
  manifest.game.apiLabel = config.apiLabel;
  // Frame generation defaults to whatever the planner recommends for this
  // game rather than to "off", because "off" is only right for a game that
  // already has its own - and the planner is what knows the difference.
  const frameGen = planFrameGen({ api, apiLabel: config.apiLabel, upscalers: config.upscalers, gpu, route: config.planRoute || manifest.route });
  const chosen = options.fg === undefined ? { ...options, fg: frameGen.configureAs } : options;
  const resolved = upstream.resolveOptions(config, gpu, chosen);
  manifest.optiscaler = { version: upstream.RELEASE.version, hook: upstream.hookFor(api), ...resolved };
  // Kept with the game so the interface can say why this was chosen, and so
  // a later look at the manifest explains itself.
  manifest.frameGen = frameGen;

  const exeDir = path.dirname(exePath);
  for (const item of upstream.copyPlan(optiRoot, api, resolved)) {
    const rel = await copyTracked(manifest, gameDir, item.from, path.join(exeDir, item.to), { kind: 'optiscaler' });
    log({ code: 'added', params: { rel } });
  }

  // Settings the person changed by hand come back through the saved profile
  // when one exists, then from the file already in the game, and only then
  // from the pristine copy in the payload.
  const file = path.join(exeDir, 'OptiScaler.ini');
  const prior = (config.profile && config.profile[path.relative(gameDir, file)]) ?? ini.readText(file);
  const seed = prior || ini.readText(path.join(optiRoot, 'OptiScaler.ini'));
  await writeTracked(manifest, gameDir, file, upstream.configureAmd(seed, config, gpu, resolved), { kind: 'config' });

  await saveActiveManifest(gameDir, manifest);
  return manifest;
}

module.exports = { install };
