'use strict';
// Task 5.5: reading OptiScaler's compatibility list.
//
// Seven hundred people have already tried this on seven hundred games. The
// parser's job is to not lose what they wrote down, and in particular to not
// turn "does not work, here is why" into silence.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseCompatList, findGame, normalise, clean } = require('../src/core/compat-amd');

const SAMPLE = fs.readFileSync(path.join(__dirname, 'fixtures', 'compat-amd-sample.md'), 'utf8');
const parsed = parseCompatList(SAMPLE);
const byName = (name) => parsed.find((entry) => entry.game === name);

test('every real row becomes an entry, and nothing else does', () => {
  assert.equal(parsed.length, 10);
  // The header, the alignment row, the prose above the table and the template
  // inside the HTML comment are all skipped.
  assert.equal(parsed.some((entry) => /^game$/i.test(entry.game)), false);
  assert.equal(parsed.some((entry) => entry.game.includes('GAME NAME')), false);
  assert.equal(parsed.some((entry) => entry.game.includes('Working')), false);
});

test('a title that links to its own wiki page keeps the title, not the link', () => {
  assert.ok(byName('007 First Light'), 'the link markup is gone');
  assert.ok(byName('7 Days To Die'));
  assert.ok(byName('171'), 'and a title that is only digits still survives');
  assert.equal(parsed.some((entry) => entry.game.includes('](')), false);
});

test('the three status symbols each mean something different', () => {
  assert.equal(byName('63 Days').status, 'works');
  assert.equal(byName('EA Sports WRC').status, 'broken');
  assert.equal(byName('A Synthetic Entry On One OS').status, 'partial');
  for (const entry of parsed) assert.ok(['works', 'broken', 'partial'].includes(entry.status), entry.game);
});

test('the reason a game does not work is kept, because that is the useful half', () => {
  // "Broken" alone sends someone to a forum. "EAC" tells them to stop trying.
  assert.match(byName('EA Sports WRC').notes, /Anti-cheat blocks unknown/);
  assert.match(byName('Gears of War: Reloaded').notes, /EAC\. Game has FSR3\.1, but no FSR dll\./);
  assert.match(byName('Atlas Fallen: Reign Of Sand').notes, /cannot hook this game's FSR2 inputs/);
});

test('notes are readable text: no markup, no image links, no line breaks', () => {
  const daysToDie = byName('7 Days To Die');
  assert.equal(daysToDie.notes, 'Make sure EAC is disabled.', 'bold markers removed');
  const amsterdam = byName('1666: Amsterdam');
  assert.equal(amsterdam.notes.includes('`'), false, 'code ticks removed');
  assert.match(amsterdam.notes, /Non-Linear Color Space/);
  for (const entry of parsed) {
    assert.equal(entry.notes.includes('<br>'), false, entry.game);
    assert.equal(entry.notes.includes('https://'), false, `${entry.game}: images belong in the wiki, not here`);
    assert.equal(entry.notes, entry.notes.trim());
  }
});

test('the inputs decide whether tier 1 is even possible, so they are kept as a list', () => {
  assert.deepEqual(byName('1666: Amsterdam').inputs, ['DLSS', 'FSR3.1/4', 'XeSS']);
  assert.deepEqual(byName('63 Days').inputs, ['XeSS']);
  assert.deepEqual(byName('EA Sports WRC').inputs, [], 'a game with none gets an empty list, not [""]');
});

test('OptiPatcher support is recorded, because it is the alternative to spoofing', () => {
  assert.equal(byName('171').optiPatcher, true);
  assert.equal(byName('007 First Light').optiPatcher, false);
  assert.equal(byName('A Synthetic Entry On One OS').optiPatcher, true);
});

test('a game folder can be matched against the list despite punctuation and trademarks', () => {
  // Store titles and wiki entries never agree on these.
  assert.equal(findGame(parsed, 'The Lord of the Rings Return to Moria').game,
    'The Lord of the Rings: Return to Moria™');
  assert.equal(findGame(parsed, '  7 days to die  ').game, '7 Days To Die');
  assert.equal(findGame(parsed, '1666 Amsterdam').game, '1666: Amsterdam');
  assert.equal(findGame(parsed, 'A Game Nobody Has Tried'), null);
  assert.equal(findGame(parsed, ''), null);
  assert.equal(findGame(null, '63 Days'), null);
});

test('nonsense in gives an empty list rather than a crash', () => {
  for (const input of ['', null, undefined, 'no table here at all', '| | |']) {
    assert.deepEqual(parseCompatList(input), [], JSON.stringify(input));
  }
  assert.equal(normalise(null), '');
  assert.equal(clean(undefined), '');
});

test('the shipped list is real, complete enough to be worth having, and small', () => {
  const file = path.join(__dirname, '..', 'src', 'data', 'compat-amd.json');
  const stat = fs.statSync(file);
  assert.ok(stat.size < 2 * 1024 * 1024, `${stat.size} bytes is too much to ship`);

  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(Array.isArray(data.games), 'games is a list');
  assert.ok(data.games.length >= 100, `only ${data.games.length} games`);
  assert.equal(typeof data.source, 'string', 'and it says where it came from');
  assert.equal(typeof data.imported, 'string');

  for (const entry of data.games) {
    assert.ok(entry.game && typeof entry.game === 'string');
    assert.ok(['works', 'broken', 'partial'].includes(entry.status), `${entry.game}: ${entry.status}`);
    assert.equal(typeof entry.notes, 'string');
    assert.ok(Array.isArray(entry.inputs));
  }
  // The games that do not work are the ones worth shipping most, and they are
  // rare enough to be lost by a parser change without anyone noticing.
  assert.ok(data.games.some((entry) => entry.status === 'broken'), 'the failures survived the import');
});
