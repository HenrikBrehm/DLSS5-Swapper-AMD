'use strict';
// Install the real OptiScaler release into a folder, check it, and take it
// back out again - without going near a game.
//
//   node scripts/dry-run-install.js            temporary folder, cleaned up
//   node scripts/dry-run-install.js --keep     leave it behind to look at
//
// Why this exists. test/apply-amd-optiscaler.test.js already installs and
// restores, but against a payload built in milliseconds from the real file
// list: the names and the INI are real, the DLLs are four kilobytes of
// nothing. So the chain from "the archive on GitHub" to "files in a game
// folder" had never once been run end to end. This runs it: the real
// download, the real 7-Zip extraction, the real copy plan, the real INI
// rewrite, the real verify, and the real restore, with every file hashed
// before and after.
//
// It never touches a game. The folder is synthesised in the system temp
// directory and deleted afterwards, and nothing is started.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const upstream = require('../src/core/optiscaler-upstream');
const backends = require('../src/core/backend-manager');
const verify = require('../src/core/verify');
const { writePe } = require('../test/fixtures/pe');

const GPU = Object.freeze({ vendor: 'amd', rdnaGen: 3, mobile: false, adrenalin: '26.8.1', fsr4Capable: true });

function hashTree(dir) {
  const out = new Map();
  (function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      out.set(path.relative(dir, full).split(path.sep).join('/'),
        crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex'));
    }
  })(dir);
  return out;
}

// A game shaped like one that belongs in tier 1: 64-bit, DirectX 12, and it
// already ships DLSS, which is what OptiScaler replaces.
function synthesiseGame(root) {
  const exeDir = path.join(root, 'bin', 'x64');
  fs.mkdirSync(exeDir, { recursive: true });
  const exePath = path.join(exeDir, 'DryRun.exe');
  writePe(exePath, { bitness: 64, size: 300 * 1024, text: 'D3D12CreateDevice' });
  fs.writeFileSync(path.join(exeDir, 'nvngx_dlss.dll'), 'pretend DLSS runtime');
  fs.writeFileSync(path.join(root, 'readme.txt'), 'a file the install must not touch\n');
  return { gameDir: root, exePath, exeDir };
}

// Restore deliberately keeps two things, and task 1.8 pinned exactly which:
// the spent manifest under a new name, so a later look can say what was once
// installed, and the saved settings profile, so the person's hand edits come
// back if they install again. Anything else under the backup folder, and any
// change to a game file at all, is a real failure.
const BOOKKEEPING = /^_DLSS5_Backup\/(?:manifest\.json\.done-\d+|\.profiles\/[^/]+\.json)$/;

function diff(before, after) {
  const changed = [];
  const kept = [];
  for (const [file, hash] of before) {
    if (!after.has(file)) changed.push(`missing after restore: ${file}`);
    else if (after.get(file) !== hash) changed.push(`changed: ${file}`);
  }
  for (const file of after.keys()) {
    if (before.has(file)) continue;
    if (BOOKKEEPING.test(file)) kept.push(file);
    else changed.push(`left behind: ${file}`);
  }
  return { changed, kept };
}

async function main() {
  const keep = process.argv.includes('--keep');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dry-run-install-'));
  const cacheRoot = path.join(base, 'cache');
  const game = synthesiseGame(path.join(base, 'DryRunGame'));
  const say = (line) => process.stdout.write(line + '\n');

  say('Dry run: the real OptiScaler release into a synthetic game folder.');
  say(`  folder: ${game.gameDir}`);
  say('');

  say(`Fetching OptiScaler ${upstream.RELEASE.version} (cached after the first run)…`);
  const optiRoot = await upstream.ensureOptiScalerUpstream(cacheRoot, {});
  const payloadFiles = fs.readdirSync(optiRoot).length;
  say(`  extracted and validated: ${payloadFiles} entries in ${optiRoot}`);
  say('');

  const before = hashTree(game.gameDir);
  say(`Game folder before: ${before.size} files.`);

  const config = {
    gameDir: game.gameDir, exePath: game.exePath, api: 'dxgi', apiLabel: 'DirectX 12',
    bitness: 64, route: 'amd-optiscaler', optiRoot, gpu: GPU, options: {},
    upscalers: { dlss: true, any: true }
  };
  const added = [];
  const manifest = await backends.install(config, (event) => {
    if (event && event.code === 'added') added.push(event.params.rel);
  });
  say(`Installed. ${added.length} files placed, hook ${manifest.optiscaler.hook}.`);
  for (const rel of added) {
    const size = fs.statSync(path.join(game.gameDir, rel)).size;
    say(`  ${rel}  (${Math.round(size / 1024)} KB)`);
  }
  say('');

  const iniPath = path.join(game.exeDir, 'OptiScaler.ini');
  const ini = fs.readFileSync(iniPath, 'utf8');
  say('Configuration actually written:');
  for (const key of ['Dx12Upscaler', 'Fsr4Update', 'Fsr4ForceEnableInt8', 'Enabled', 'FGInput', 'FGOutput']) {
    const hit = new RegExp(`^${key}=(.*)$`, 'm').exec(ini);
    say(`  ${key} = ${hit ? hit[1].trim() : '(not written)'}`);
  }
  say('');

  const state = verify.verifyInstall(game.gameDir, game.exePath, manifest.route);
  say(`Verify before the game has ever run: ${JSON.stringify(state)}`);
  say('');

  await backends.restore(game.gameDir);
  const after = hashTree(game.gameDir);
  const { changed, kept } = diff(before, after);
  say(`Game folder after restore: ${after.size} files.`);
  if (changed.length) {
    say('NOT byte for byte:');
    for (const line of changed) say(`  ${line}`);
  } else {
    say('Every game file is back with its original hash, and nothing else was left behind.');
    for (const file of kept) say(`  kept on purpose: ${file}`);
  }

  if (keep) say(`\nKept: ${base}`);
  else fs.rmSync(base, { recursive: true, force: true });
  process.exitCode = changed.length ? 1 : 0;
}

// Only when run, so the judgement below can be tested without downloading
// 200 MB of DLLs and without a network at all.
if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`dry run failed: ${error && error.stack}\n`);
    process.exitCode = 1;
  });
}

module.exports = { diff, hashTree, synthesiseGame, BOOKKEEPING };
