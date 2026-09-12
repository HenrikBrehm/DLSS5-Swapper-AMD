'use strict';
// Task 5.6: the documentation.
//
// These tests are here for one reason: a route added later must not be able
// to go undocumented. Everything else about a README a machine cannot judge,
// but "is every route mentioned" and "is every limit still stated" it can.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROUTE_META } = require('../src/shared/install-routes');

const root = path.resolve(__dirname, '..');
const amd = fs.readFileSync(path.join(root, 'README-AMD.md'), 'utf8');
const main = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

test('every route the registry knows is named, so none can go undocumented', () => {
  for (const route of Object.keys(ROUTE_META)) {
    assert.ok(amd.includes(route), `${route} is not mentioned in README-AMD.md`);
  }
});

test('all three tiers are explained, not just the ones that work well', () => {
  for (const tier of [1, 2, 3]) {
    assert.ok(new RegExp(`\\|\\s*${tier}\\s*\\|`).test(amd), `tier ${tier} is missing from the table`);
  }
  // Both language versions have their own table.
  assert.equal((amd.match(/\| Tier \| When \| What you get \|/g) || []).length, 1);
  assert.equal((amd.match(/\| Stufe \| Wann \| Was du bekommst \|/g) || []).length, 1);
});

test('both languages are present and neither is a stub', () => {
  const [english, german] = amd.split(/^# Upscaling auf einer Radeon$/m);
  assert.ok(english.length > 2000, 'the English half is substantial');
  assert.ok(german && german.length > 2000, 'and so is the German one');
  assert.match(english, /^# Upscaling on a Radeon$/m);
});

test('each half stays inside the length it was given', () => {
  const lines = amd.split('\n');
  const split = lines.findIndex((line) => /^# Upscaling auf einer Radeon$/.test(line));
  assert.ok(split > 0, 'the German half starts somewhere');
  assert.ok(split <= 200, `the English half is ${split} lines`);
  assert.ok(lines.length - split <= 200, `the German half is ${lines.length - split} lines`);
});

test('the limits are stated in both languages, because that is the point of the file', () => {
  // Each of these cost somebody an evening to discover. They are the reason
  // this section exists, and a rewrite must not quietly drop one.
  for (const limit of [/anti-cheat/i, /RDNA2/, /Vulkan/, /2027/, /RDNA4/]) {
    assert.match(amd, limit, `the limit ${limit} is not stated`);
  }
  assert.match(amd, /cannot reconstruct detail/i, 'the honest limit of tier 3, in English');
  assert.match(amd, /keine Details rekonstruieren/i, 'and in German');
});

test('the Adrenalin version that decides FSR 4 on an RX 7000 is named', () => {
  // Without it somebody with the right card and the wrong driver has no way
  // to know why they got FSR 3.1.
  assert.equal((amd.match(/26\.6\.2/g) || []).length, 2, 'once in each language');
});

test('upstream is credited and linked, from both files', () => {
  const upstream = 'https://github.com/rakanki911/DLSS5-Swapper';
  assert.ok(amd.includes(upstream), 'README-AMD.md links the original');
  assert.ok(main.includes(upstream), 'and so does the notice on the main README');
  assert.match(amd, /OptiScaler/);
  assert.match(amd, /GPL-3\.0/, 'with the licence that comes with it');
  assert.match(amd, /THIRD_PARTY_NOTICES\.md/);
});

test('the main README says what this fork is, in both languages, before anything else', () => {
  const notice = main.slice(0, 1600);
  assert.match(notice, /This is an AMD fork/);
  assert.match(notice, /Dies ist ein AMD-Fork/);
  assert.match(notice, /README-AMD\.md/);
});

test('nobody is told this has been confirmed against a real game, because it has not', () => {
  // The whole project is verified by tests and by nothing else so far. Saying
  // otherwise in a README is the easiest way to waste somebody's evening.
  assert.match(amd, /Work in progress/i);
  assert.match(amd, /nothing here has\s+been confirmed by running a real game/i);
  assert.match(amd, /In Arbeit/i);
  assert.match(amd, /nichts davon wurde\s+bisher mit einem echten Spiel best/i);
});
