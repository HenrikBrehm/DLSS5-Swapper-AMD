'use strict';
// Reading OptiScaler's compatibility list.
//
// Seven hundred people have already tried this on seven hundred games and
// written down what happened. That is worth more than any amount of guessing
// from file names, and it is the difference between "this should work" and
// "this worked for someone, and here is what they had to do first".
//
// Pure text in, data out. The download lives in scripts/import-compat-amd.js
// so that nothing here ever touches the network, and the tests never need to.
const STATUS = Object.freeze({
  '✅': 'works',
  '❌': 'broken',
  // Used for a game that works on one operating system but not the other.
  '➖': 'partial',
  '💥': 'partial'
});

// `[Title](Some-Page)` is a link to the game's own wiki page; the title is
// what a person recognises.
const linkText = (text) => String(text || '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

function clean(cell) {
  return linkText(cell)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    // Bold and italics carry no meaning once the table is data.
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// For matching a folder name against the list. Punctuation, edition suffixes
// and spacing differ constantly between a store's title and a wiki entry.
function normalise(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[™®]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseCompatList(markdown) {
  // The template row lives inside an HTML comment and would otherwise be
  // parsed as a game called "GAME NAME".
  const text = String(markdown || '').replace(/<!--[\s\S]*?-->/g, '');
  const rows = [];
  const seen = new Set();

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|');
    if (cells.length < 4) continue;

    const game = clean(cells[0]);
    const statusCell = cells[1] || '';
    if (!game) continue;
    // The header row and the alignment row underneath it.
    if (/^game$/i.test(game) || /^-{2,}$/.test(game.replace(/[\s:]/g, ''))) continue;

    const symbol = Object.keys(STATUS).find((key) => statusCell.includes(key));
    if (!symbol) continue;

    // The list has one row per game; a duplicate means the page was edited
    // into an inconsistent state, and the first entry is the one to keep.
    const key = normalise(game);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    rows.push({
      game,
      key,
      status: STATUS[symbol],
      // Which inputs OptiScaler can read in this game. This is what decides
      // whether tier 1 is available at all.
      inputs: clean(cells[2]).split(/\s*,\s*/).filter(Boolean),
      optiPatcher: (cells[3] || '').includes('✨'),
      notes: clean(cells[4] || '')
    });
  }
  return rows;
}

// What somebody else already found out about this game, if anything.
function findGame(list, title) {
  const key = normalise(title);
  if (!key || !Array.isArray(list)) return null;
  return list.find((entry) => entry.key === key) || null;
}

module.exports = { parseCompatList, findGame, normalise, clean, STATUS };
