'use strict';
// Task 6.8: the judgement the dry run makes about a restore.
//
// The dry run itself downloads 200 MB and cannot live in a test suite. What
// can is the part that decides whether a restore was clean, because that is
// the claim the whole thing exists to make and a wrong "clean" is worse than
// no check at all.
//
// The two files a restore keeps on purpose were pinned in task 1.8: the spent
// manifest under a new name, and the saved settings profile. Everything else
// under the backup folder is a leak, and any change to a game file is a
// corrupted folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { diff, hashTree, synthesiseGame, BOOKKEEPING } = require('../scripts/dry-run-install');

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dry-run-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('an untouched folder is reported as clean', () => {
  const before = new Map([['bin/x64/Game.exe', 'aaa'], ['readme.txt', 'bbb']]);
  const { changed, kept } = diff(before, new Map(before));
  assert.deepEqual(changed, []);
  assert.deepEqual(kept, []);
});

test('the two files a restore keeps on purpose are not counted against it', () => {
  const before = new Map([['bin/x64/Game.exe', 'aaa']]);
  const after = new Map([
    ['bin/x64/Game.exe', 'aaa'],
    ['_DLSS5_Backup/manifest.json.done-1789261508218', 'ccc'],
    ['_DLSS5_Backup/.profiles/f093baf8-amd-optiscaler.json', 'ddd']
  ]);
  const { changed, kept } = diff(before, after);
  assert.deepEqual(changed, []);
  assert.equal(kept.length, 2, 'they are named rather than ignored');
});

test('a game file that came back different is a failure, not a detail', () => {
  const before = new Map([['bin/x64/Game.exe', 'aaa']]);
  const { changed } = diff(before, new Map([['bin/x64/Game.exe', 'zzz']]));
  assert.equal(changed.length, 1);
  assert.match(changed[0], /^changed: bin\/x64\/Game\.exe$/);
});

test('a game file that did not come back at all is a failure', () => {
  const { changed } = diff(new Map([['readme.txt', 'bbb']]), new Map());
  assert.equal(changed.length, 1);
  assert.match(changed[0], /^missing after restore: readme\.txt$/);
});

test('anything else left behind is a leak, including inside the backup folder', () => {
  const before = new Map();
  const after = new Map([
    ['bin/x64/dxgi.dll', 'eee'],
    ['_DLSS5_Backup/manifest.json', 'fff'],
    ['_DLSS5_Backup/originals/dxgi.dll', 'ggg']
  ]);
  const { changed, kept } = diff(before, after);
  assert.equal(kept.length, 0);
  assert.equal(changed.length, 3, 'a live manifest and a stashed original are both leaks after a restore');
});

test('the bookkeeping pattern does not accept a near miss', () => {
  // A pattern this permissive would quietly pass a real leak.
  for (const ok of ['_DLSS5_Backup/manifest.json.done-1', '_DLSS5_Backup/.profiles/x.json']) {
    assert.ok(BOOKKEEPING.test(ok), ok);
  }
  for (const leak of [
    '_DLSS5_Backup/manifest.json',
    '_DLSS5_Backup/manifest.json.done-',
    '_DLSS5_Backup/manifest.json.done-abc',
    '_DLSS5_Backup/.profiles/x.json.bak',
    '_DLSS5_Backup/.profiles/deeper/x.json',
    'bin/_DLSS5_Backup/manifest.json.done-1'
  ]) {
    assert.ok(!BOOKKEEPING.test(leak), `${leak} was wrongly accepted`);
  }
});

test('the synthetic game is the tier 1 shape the dry run means to exercise', (t) => {
  const game = synthesiseGame(path.join(temp(t), 'DryRunGame'));
  assert.ok(fs.existsSync(game.exePath), 'there is an executable');
  assert.ok(fs.existsSync(path.join(game.exeDir, 'nvngx_dlss.dll')), 'and an upscaler to replace');
  assert.equal(path.basename(game.exeDir), 'x64');

  const hashes = hashTree(game.gameDir);
  assert.equal(hashes.size, 3);
  assert.ok(hashes.has('readme.txt'), 'plus a file the install has no business touching');
  for (const hash of hashes.values()) assert.match(hash, /^[0-9a-f]{64}$/);
});
