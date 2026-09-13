'use strict';
// The tier 2 dry run: open an Unreal game's upscaler slot, then put it back.
//
//   node scripts/dry-run-engine.js          temporary, cleaned up afterwards
//   node scripts/dry-run-engine.js --keep   leave the folders behind
//
// Tier 2 is the idea this whole project rests on: a game that ships no
// upscaler at all can still reach FSR 4, because it already renders motion
// vectors and a jittered camera for its own temporal anti-aliasing, and
// Unreal will hand that pass over from a configuration file.
//
// It is also the least exercised thing here. Return to Moria was meant to be
// the real instance and turned out to ship DLSS after all, so it is tier 1.
// Of the twelve games installed on the reference machine, not one lands in
// tier 2, which means the headline claim had never run outside its own unit
// tests.
//
// This is the one route that writes outside the game folder: Unreal keeps its
// per-game configuration under %LOCALAPPDATA%. So the run is pointed at a
// temporary folder standing in for it, and the real one is never touched.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const upstream = require('../src/core/optiscaler-upstream');
const backends = require('../src/core/backend-manager');
const engineRoute = require('../src/core/routes/engine-upscale');
const { detectEngine } = require('../src/core/engine-detect');
const { writePe } = require('../test/fixtures/pe');
const { diff, hashTree } = require('./dry-run-install');

const GPU = Object.freeze({ vendor: 'amd', rdnaGen: 3, mobile: false, adrenalin: '26.8.1', fsr4Capable: true });
// The four switches task 2.1 writes into [SystemSettings]. Named here so the
// run says which of them actually landed rather than just "it wrote a file".
const SWITCHES = Object.freeze([
  'r.TemporalAA.Upscaler', 'r.AntiAliasingMethod', 'r.ScreenPercentage', 'r.ScreenPercentage.MinResolution'
]);

// Unreal, and shipping no upscaler at all: exactly the case tier 2 exists for.
function synthesiseUnrealGame(root, project) {
  const exeDir = path.join(root, project, 'Binaries', 'Win64');
  fs.mkdirSync(path.join(root, project, 'Content', 'Paks'), { recursive: true });
  fs.mkdirSync(exeDir, { recursive: true });
  fs.writeFileSync(path.join(root, project, 'Content', 'Paks', 'pakchunk0-Windows.pak'), 'assets');
  const exePath = path.join(exeDir, project + '-Win64-Shipping.exe');
  writePe(exePath, { bitness: 64, size: 300 * 1024, text: 'D3D12CreateDevice' });
  fs.writeFileSync(path.join(root, 'readme.txt'), 'a file the install must not touch\n');
  return { gameDir: root, exePath, exeDir, project };
}

// What a real player's Engine.ini looks like before any of this: settings
// they chose, in sections we have no business touching.
const EXISTING_INI = [
  '[/Script/Engine.RendererSettings]',
  'r.DefaultFeature.MotionBlur=False',
  '',
  '[/Script/Engine.GameUserSettings]',
  'bUseVSync=False',
  ''
].join('\n');

async function runCase(base, { seedExisting }) {
  const label = seedExisting ? 'an Engine.ini that already exists' : 'no Engine.ini at all';
  const suffix = seedExisting ? 'Existing' : 'Fresh';
  const localAppData = path.join(base, 'LocalAppData' + suffix);
  fs.mkdirSync(localAppData, { recursive: true });
  const game = synthesiseUnrealGame(path.join(base, 'DryRunUnreal' + suffix), 'DryRunProj');
  const say = (line) => process.stdout.write(line + '\n');

  say('');
  say('='.repeat(72));
  say(`Tier 2, the Unreal upscaler slot, starting from ${label}.`);
  say(`  game: ${game.gameDir}`);
  say('');

  const engine = detectEngine(game.gameDir, game.exePath, { localAppData });
  if (seedExisting) {
    fs.mkdirSync(engine.configDir, { recursive: true });
    fs.writeFileSync(path.join(engine.configDir, 'Engine.ini'), EXISTING_INI);
  }
  say(`Engine detected: ${engine.engine}, project ${engine.projectName}, slot ${engine.upscalerSlot}`);
  say(`  config it will edit: ${engine.configDir}`);
  if (!engine.upscalerSlot) throw new Error('the synthetic game was not recognised as Unreal');
  const configFile = path.join(engine.configDir, 'Engine.ini');
  say(`  exists beforehand: ${fs.existsSync(configFile)}`);
  say('');

  const optiRoot = await upstream.ensureOptiScalerUpstream(path.join(base, 'cache'), {});
  const before = hashTree(game.gameDir);

  const added = [];
  const manifest = await engineRoute.install({
    gameDir: game.gameDir, exePath: game.exePath, api: 'dxgi', apiLabel: 'DirectX 12',
    bitness: 64, route: 'engine-upscale', optiRoot, gpu: GPU, engine,
    options: {}, upscalers: { any: false }
  }, (event) => { if (event && event.code === 'added') added.push(event.params.rel); });

  say(`Installed. Route ${manifest.route}, ${added.length} files placed, hook ${manifest.optiscaler.hook}.`);
  say(`  the game shipped no upscaler, so inputs were configured as: ${manifest.optiscaler.inputs}`);
  say('');

  const record = manifest.engineConfig;
  say('Engine configuration record kept with the game, so restore can undo it:');
  say(`  file:    ${record && record.file}`);
  say(`  created: ${record && record.created}  (true means the file did not exist before)`);
  say(`  backup:  ${record && record.backup}`);
  say('');

  const ini = fs.readFileSync(configFile, 'utf8');
  say('Written into the engine configuration:');
  say(`  [SystemSettings] present: ${/\[SystemSettings\]/.test(ini)}`);
  for (const key of SWITCHES) {
    const hit = new RegExp('^' + key.replace(/\./g, '\\.') + '=(.*)$', 'm').exec(ini);
    say(`  ${key} = ${hit ? hit[1].trim() : '(not written)'}`);
  }
  say('');

  await backends.restore(game.gameDir);
  const { changed, kept } = diff(before, hashTree(game.gameDir));
  say('After restore:');
  if (changed.length) for (const line of changed) say(`  GAME FOLDER: ${line}`);
  else {
    say('  game folder: every original file back with its original hash');
    for (const file of kept) say(`    kept on purpose: ${file}`);
  }

  // The half that matters most here, because it is the only thing this tool
  // ever writes outside the folder it was pointed at.
  const stillThere = fs.existsSync(configFile);
  const after = stillThere ? fs.readFileSync(configFile, 'utf8') : null;
  const leftovers = after ? SWITCHES.filter((key) => new RegExp('^' + key.replace(/\./g, '\\.') + '=', 'm').test(after)) : [];
  const shouldExist = !record.created;
  say(`  engine configuration exists: ${stillThere} (expected ${shouldExist})`);
  say(`  switches left behind: ${leftovers.length ? leftovers.join(', ') : 'none'}`);

  // The stronger claim for the case that matters: a file the person already
  // had comes back exactly as it was, settings and all, not merely stripped
  // of our four lines.
  let identical = true;
  if (seedExisting) {
    identical = after === EXISTING_INI;
    say(`  original content byte for byte: ${identical}`);
    if (!identical && after !== null) {
      say('  --- what came back instead ---');
      for (const line of after.split('\n')) say(`  | ${line}`);
    }
  }

  const ok = !changed.length && !leftovers.length && stillThere === shouldExist && identical;
  say('');
  say(ok ? 'Clean. Nothing of tier 2 survived the restore, inside the game folder or outside it.'
        : 'NOT clean. Something survived the restore.');
  return ok;
}

async function main() {
  const keep = process.argv.includes('--keep');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dry-run-engine-'));
  process.stdout.write('Dry run: tier 2, both starting states.\n');
  process.stdout.write(`  standing in for %LOCALAPPDATA%: under ${base}\n`);

  // Both, because they undo differently: one deletes a file it created, the
  // other has to put a file back that the person already had.
  const fresh = await runCase(base, { seedExisting: false });
  const existing = await runCase(base, { seedExisting: true });

  if (keep) process.stdout.write(`\nKept: ${base}\n`);
  else fs.rmSync(base, { recursive: true, force: true });
  process.exitCode = fresh && existing ? 0 : 1;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`tier 2 dry run failed: ${error && error.stack}\n`);
    process.exitCode = 1;
  });
}

module.exports = { synthesiseUnrealGame, SWITCHES };
