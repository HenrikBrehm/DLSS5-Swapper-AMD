'use strict';
// Opening Unreal's upscaler slot from the outside.
//
// A game with temporal anti-aliasing already produces everything FSR needs:
// motion vectors and a per-frame jittered camera. AMD's own FSR 2 docs say
// FSR replaces the game's TAA rather than running after it. What is missing
// is a way in, and Unreal has one - r.TemporalAA.Upscaler hands the temporal
// pass to the upscaler plugin path, where OptiScaler can answer.
//
// ---------------------------------------------------------------------------
// One deliberate exception, and it is worth stating plainly.
//
// Unreal keeps this file per game under %LOCALAPPDATA%, not in the game
// folder. Every other write this application makes goes through
// trackBeforeWrite, whose whole purpose is to refuse anything outside the
// selected game: safePath rejects absolute paths by design. Routing this
// through it is therefore impossible, and forcing it would mean weakening the
// one guard that keeps installs contained.
//
// So this file writes outside the game folder openly instead of quietly. The
// backup still lives inside the game folder - the only place this application
// owns - and the manifest records the absolute path, whether the file existed
// before, and whether it was read-only, so restore can put all three back.
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const ini = require('../feeder-config');
const { safePath } = require('../file-journal');

const SECTION = 'SystemSettings';
const FILE_NAME = 'Engine.ini';
const BACKUP_REL = '_DLSS5_Backup/engine-config/Engine.ini';
// 2 is TAA. The upscaler plugin path replaces the temporal pass, so the game
// has to be running a temporal pass in the first place for there to be one.
const TAA = '2';
// Quality, in the ratio every upscaler calls by that name. Below 50 the
// reconstruction has too little to work with; above 100 there is nothing to
// upscale and the route has no purpose.
const DEFAULT_SCALE = 67;
const MIN_SCALE = 50;
const MAX_SCALE = 100;

function fail(code, message = code) { return Object.assign(new Error(message), { code }); }

function plan(engine, options = {}) {
  if (!engine || !engine.upscalerSlot || !engine.configDir) {
    throw fail('errEngineUnsupported', 'this engine has no upscaler slot to open');
  }
  const scale = options.renderScale === undefined ? DEFAULT_SCALE : options.renderScale;
  if (!Number.isInteger(scale) || scale < MIN_SCALE || scale > MAX_SCALE) {
    throw fail('errEngineScale', `render scale must be a whole number between ${MIN_SCALE} and ${MAX_SCALE}`);
  }
  const file = path.join(engine.configDir, FILE_NAME);
  return [
    ['r.TemporalAA.Upscaler', '1'],
    ['r.AntiAliasingMethod', TAA],
    ['r.ScreenPercentage', String(scale)],
    // Without this the engine clamps the render size back up and the scale
    // above quietly does nothing.
    ['r.ScreenPercentage.MinResolution', '0']
  ].map(([key, value]) => ({ file, section: SECTION, key, value }));
}

const isReadOnly = (file) => { try { return !(fs.statSync(file).mode & 0o200); } catch { return false; } };

function apply(manifest, gameDir, engine, options = {}, io = {}) {
  const readFile = io.readFile || ((file) => fs.readFileSync(file, 'utf8'));
  const writeFile = io.writeFile || ((file, text) => fs.writeFileSync(file, text));
  const entries = plan(engine, options);
  const file = entries[0].file;
  const existed = fs.existsSync(file);

  // The true original is captured once. A second apply must not record our
  // own edit as the original, or restore would hand back a file the game
  // never had.
  if (!manifest.engineConfig) {
    const backup = safePath(gameDir, BACKUP_REL);
    if (existed) {
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.copyFileSync(file, backup);
    }
    manifest.engineConfig = {
      file, backup: existed ? BACKUP_REL : null,
      created: !existed, wasReadOnly: existed && isReadOnly(file)
    };
  }

  if (manifest.engineConfig.wasReadOnly) { try { fs.chmodSync(file, 0o666); } catch { /* nothing to lift */ } }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let text = existed ? readFile(file) : '';
  for (const entry of entries) text = ini.setIni(text, entry.section, entry.key, entry.value);
  writeFile(file, text);
  if (manifest.engineConfig.wasReadOnly) { try { fs.chmodSync(file, 0o444); } catch { /* not ours to set */ } }
  return manifest.engineConfig;
}

function restore(manifest, gameDir) {
  const record = manifest && manifest.engineConfig;
  if (!record || !record.file) return false;
  try {
    if (record.created) {
      fs.rmSync(record.file, { force: true });
    } else if (record.backup) {
      const backup = safePath(gameDir, record.backup);
      if (fs.existsSync(backup)) {
        if (isReadOnly(record.file)) { try { fs.chmodSync(record.file, 0o666); } catch { /* nothing to lift */ } }
        fs.copyFileSync(backup, record.file);
        if (record.wasReadOnly) { try { fs.chmodSync(record.file, 0o444); } catch { /* not ours to set */ } }
        // And then the copy goes too. It has done its job, and leaving it
        // behind would put a stale copy of somebody's settings in their game
        // folder for good - which is not what "restored byte for byte" means.
        // Found by scripts/dry-run-engine.js; no test had looked.
        fs.rmSync(backup, { force: true });
      }
      // Only if it is empty, so a folder holding anything else is left alone.
      try { fs.rmdirSync(path.dirname(backup)); } catch { /* not empty, or not there */ }
    }
  } finally {
    manifest.engineConfig = null;
  }
  return true;
}

module.exports = { plan, apply, restore, SECTION, FILE_NAME, BACKUP_REL, DEFAULT_SCALE, MIN_SCALE, MAX_SCALE };
