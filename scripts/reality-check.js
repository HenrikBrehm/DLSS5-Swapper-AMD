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
const compatibility = require('../src/core/compatibility');
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
    const engine = detectEngine(dir, target ? target.path : null);
    // scanGame does not put anti-cheat on the target; main.js adds it on its
    // own path. Without this the report would recommend injecting a DLL into
    // a game that bans people for it, which is the one mistake here that
    // costs the reader something they cannot get back.
    const enriched = target
      ? { ...scanned, chosen: { ...target, antiCheat: compatibility.hasAntiCheat(dir, target.path) } }
      : scanned;
    rows.push(assess({ name, dir, scan: enriched, engine, gpu }));
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
