'use strict';
// Refreshes src/data/compat-amd.json from OptiScaler's compatibility list.
//
// Run by hand when the wiki has moved on:
//   node scripts/import-compat-amd.js
//
// The network lives here and nowhere else. The parser it calls is a pure
// function in src/core/compat-amd.js, so the tests never need a connection
// and a wiki outage can never turn into a failing build.
//
// The list is other people's work - roughly seven hundred entries written by
// the people who tried each game. It is quoted here with its source recorded
// in the file it produces, and OptiScaler is credited in
// THIRD_PARTY_NOTICES.md.
const fs = require('fs');
const path = require('path');
const { parseCompatList } = require('../src/core/compat-amd');

const SOURCE = 'https://github.com/optiscaler/OptiScaler/wiki/Compatibility-List';
const RAW = 'https://raw.githubusercontent.com/wiki/optiscaler/OptiScaler/Compatibility-List.md';
const OUT = path.resolve(__dirname, '..', 'src', 'data', 'compat-amd.json');
const MAX_BYTES = 2 * 1024 * 1024;

async function main() {
  const response = await fetch(RAW, {
    headers: { 'User-Agent': 'DLSS5-Swapper-AMD/compat-import' },
    signal: AbortSignal.timeout(60000)
  });
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const markdown = await response.text();

  const games = parseCompatList(markdown);
  // A parse that suddenly finds almost nothing means the page was restructured,
  // and overwriting a good list with a broken one is worse than doing nothing.
  if (games.length < 100) throw new Error(`Only ${games.length} entries parsed; the page layout has probably changed`);

  const data = {
    source: SOURCE,
    imported: new Date().toISOString().slice(0, 10),
    games
  };
  const text = JSON.stringify(data, null, 1) + '\n';
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('The result is too large to ship');

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text);
  const counts = games.reduce((all, entry) => ({ ...all, [entry.status]: (all[entry.status] || 0) + 1 }), {});
  console.log(`${games.length} games written to ${path.relative(process.cwd(), OUT)}`);
  console.log(Object.entries(counts).map(([status, n]) => `${status}: ${n}`).join(', '));
}

main().catch((error) => { console.error(error.message); process.exit(1); });
