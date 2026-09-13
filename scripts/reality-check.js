'use strict';
// Run the whole chain against the games actually installed on this machine and
// print what each one would get.
//
//   node scripts/reality-check.js                 every game the app can find
//   node scripts/reality-check.js "C:\path\to\game" [...]   just these folders
//   node scripts/reality-check.js --json          the same as data
//
// Read-only. It scans folders, reads the registry for the adapter, and prints.
// It starts nothing, installs nothing and writes nothing.
//
// This exists because the chain was green on 517 tests while giving the wrong
// tier for the reference machine's most important game. Tests check the code
// against what I believed; this checks it against the disk.
const path = require('node:path');
const scan = require('../src/core/scan');
const library = require('../src/library');
const gpuDetect = require('../src/core/gpu-detect');
const { detectEngine } = require('../src/core/engine-detect');
const { assess, render, summarise } = require('../src/core/reality-check');

function parse(argv) {
  const args = argv.slice(2);
  return {
    json: args.includes('--json'),
    dirs: args.filter((arg) => !arg.startsWith('--'))
  };
}

function found(dirs) {
  if (dirs.length) return dirs.map((dir) => ({ name: path.basename(dir), dir: path.resolve(dir) }));
  const { games } = library.discover();
  return games.map((game) => ({ name: game.name || path.basename(game.dir), dir: game.dir }));
}

async function main() {
  const { json, dirs } = parse(process.argv);

  let gpu = null;
  try {
    const rows = await gpuDetect.detect();
    gpu = rows.find((row) => row.vendor === 'amd') || rows[0] || null;
  } catch { /* the report says "no adapter detected" and stays useful */ }

  const rows = [];
  for (const { name, dir } of found(dirs)) {
    let scanned = null;
    try { scanned = await scan.scanGame(dir); } catch { scanned = null; }
    const target = scanned && scanned.chosen;
    // Since task 6.4 the engine and the anti-cheat verdict travel on the
    // target itself, so this reads exactly what the application reads. Before
    // that they did not, and this script was one step from recommending an
    // injection into a game that bans people for it.
    const engine = (target && target.engine) || detectEngine(dir, target ? target.path : null);
    rows.push(assess({ name, dir, scan: scanned, engine, gpu }));
  }

  if (json) {
    process.stdout.write(JSON.stringify({ gpu, rows, total: summarise(rows) }, null, 2) + '\n');
    return;
  }
  process.stdout.write(render(rows, gpu) + '\n');
}

main().catch((error) => {
  process.stderr.write(`reality-check failed: ${error && error.message}\n`);
  process.exitCode = 1;
});
