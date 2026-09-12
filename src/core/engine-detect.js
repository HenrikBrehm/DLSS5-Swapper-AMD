'use strict';
// Which engine a game is built on, and whether that engine can be talked
// into handing its upscaler slot to us.
//
// This is the hinge of tier 2. A game with no DLSS, FSR or XeSS runtime is
// not automatically out of reach: if it has temporal anti-aliasing, it is
// already producing exactly what FSR needs, namely motion vectors and a
// per-frame jittered camera. AMD's own FSR 2 documentation says as much -
// FSR replaces the game's TAA rather than sitting after it.
//
// What is missing is only a way in. Unreal has one: r.TemporalAA.Upscaler
// switches the temporal pass to the upscaler plugin path, and from there
// OptiScaler can answer. No other engine here exposes an equivalent switch
// from the outside, so `upscalerSlot` is true for Unreal alone, and the
// honest "no" for the rest is what task 2.3 turns into an explanation.
//
// Detection only reads. It never writes, and it never runs anything.
const fs = require('fs');
const path = require('path');

const ENGINES = Object.freeze(['unreal', 'unity', 're-engine', 'creation', 'source', 'idtech', 'godot', 'cryengine', 'unknown']);

function exists(...parts) {
  try { return fs.existsSync(path.join(...parts)); } catch { return false; }
}
function entries(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
}
function dirsIn(dir) { return entries(dir).filter((e) => e.isDirectory()).map((e) => e.name); }
function filesIn(dir) { return entries(dir).filter((e) => e.isFile()).map((e) => e.name); }

// The project folder is the one holding Content/Paks - "Moria" in Return to
// Moria. Everything Unreal writes per game is keyed on that name, including
// the config folder under %LOCALAPPDATA%.
function unrealProject(gameDir, exePath) {
  for (const name of dirsIn(gameDir)) {
    if (name.toLowerCase() === 'engine') continue;
    if (exists(gameDir, name, 'Content', 'Paks')) return name;
  }
  // No paks to go by: the shipping executable carries the project name in
  // front of Unreal's own suffix.
  const shipping = exePath && /^(.+)-Win64-Shipping\.exe$/i.exec(path.basename(exePath));
  return shipping ? shipping[1] : null;
}

function isUnreal(gameDir, exePath) {
  if (exists(gameDir, 'Engine', 'Binaries', 'Win64')) return true;
  if (exePath && /-Win64-Shipping\.exe$/i.test(path.basename(exePath))) return true;
  return dirsIn(gameDir).some((name) => name.toLowerCase() !== 'engine' && exists(gameDir, name, 'Content', 'Paks'));
}

function unrealVersion(gameDir) {
  const file = path.join(gameDir, 'Engine', 'Build', 'Build.version');
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const parts = [data.MajorVersion, data.MinorVersion, data.PatchVersion].filter((n) => Number.isFinite(n));
    return parts.length ? parts.join('.') : null;
  } catch { return null; }
}

// %LOCALAPPDATA%\<Project>\Saved\Config\<platform>. UE4 writes WindowsNoEditor
// there, UE5 writes Windows. An existing folder settles it; otherwise the pak
// file carries the same suffix and says which one the game will create.
//
// The folder is deliberately named even when it does not exist yet, because
// the engine route creates it. What must not happen is picking a neighbour:
// a real install has CrashReportClient sitting right beside the platform
// folder, and "the first subdirectory" would land there.
const PLATFORM_DIRS = Object.freeze(['Windows', 'WindowsNoEditor']);

function unrealConfigDir(gameDir, project, localAppData) {
  if (!project || !localAppData) return null;
  const base = path.join(localAppData, project, 'Saved', 'Config');
  for (const platform of PLATFORM_DIRS) {
    if (exists(base, platform)) return path.join(base, platform);
  }
  const paks = path.join(gameDir || '', project, 'Content', 'Paks');
  const noEditor = filesIn(paks).some((name) => /-WindowsNoEditor\.(pak|utoc)$/i.test(name));
  return path.join(base, noEditor ? 'WindowsNoEditor' : 'Windows');
}

// Ordered, because the first match wins. Unreal is structural and specific,
// so it is asked first and a stray file cannot outvote it.
const DETECTORS = [
  ['unity', (gameDir) => exists(gameDir, 'UnityPlayer.dll') ||
    dirsIn(gameDir).some((name) => /_Data$/i.test(name) && exists(gameDir, name, 'globalgamemanagers'))],
  ['re-engine', (gameDir) => filesIn(gameDir).some((name) => /^re_chunk_\d+\.pak$/i.test(name))],
  ['creation', (gameDir) => filesIn(path.join(gameDir, 'Data')).some((name) => /\.esm$/i.test(name))],
  ['source', (gameDir) => exists(gameDir, 'bin', 'engine.dll') ||
    dirsIn(gameDir).some((name) => filesIn(path.join(gameDir, name)).some((file) => /\.vpk$/i.test(file))) ||
    filesIn(gameDir).some((name) => /\.vpk$/i.test(name))],
  ['idtech', (gameDir) => filesIn(path.join(gameDir, 'base')).some((name) => /\.resources$/i.test(name))],
  ['godot', (gameDir, exePath) => filesIn(exePath ? path.dirname(exePath) : gameDir).some((name) => /\.pck$/i.test(name))],
  ['cryengine', (gameDir) => exists(gameDir, 'CrySystem.dll') ||
    dirsIn(gameDir).some((name) => exists(gameDir, name, 'CrySystem.dll'))]
];

function detectEngine(gameDir, exePath, deps = {}) {
  const localAppData = deps.localAppData || process.env.LOCALAPPDATA || null;
  const none = { engine: 'unknown', version: null, projectName: null, configDir: null, upscalerSlot: false };
  if (!gameDir || typeof gameDir !== 'string') return none;

  if (isUnreal(gameDir, exePath)) {
    const projectName = unrealProject(gameDir, exePath);
    return {
      engine: 'unreal',
      version: unrealVersion(gameDir),
      projectName,
      configDir: unrealConfigDir(gameDir, projectName, localAppData),
      upscalerSlot: true
    };
  }
  for (const [engine, matches] of DETECTORS) {
    let hit = false;
    try { hit = matches(gameDir, exePath); } catch { hit = false; }
    if (hit) return { ...none, engine };
  }
  return none;
}

module.exports = { detectEngine, ENGINES, PLATFORM_DIRS, isUnreal, unrealProject, unrealVersion, unrealConfigDir };
