'use strict';
// Task 6.5: a bundled tool is not the game.
//
// Found by running scripts/reality-check.js against the reference machine's
// library. Forts came back with ffmpeg.exe as its executable, with Forts.exe
// sitting right beside it. Everything downstream then described ffmpeg: its
// rendering API, its bitness, its tier. The advice was about the wrong
// program, and nothing in the chain could notice.
//
// The list this extends already holds installers, launchers and crash
// handlers. These are the other kind: real, signed, useful programs that a
// game ships and that are still not the game.
//
// The risk of the change is over-matching, so every pattern ends on a word
// boundary and the tests below pin the near misses: Curling is not curl.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scanGame } = require('../src/core/scan');
const { writePe } = require('./fixtures/pe');

const GAME = { bitness: 64, size: 300 * 1024, text: 'D3D12CreateDevice' };

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundled-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('a media tool beside the game is not offered as the game', async (t) => {
  // Forts, exactly. ffmpeg is larger and sorts first, so it won.
  const dir = temp(t);
  writePe(path.join(dir, 'ffmpeg.exe'), { ...GAME, size: 900 * 1024 });
  writePe(path.join(dir, 'Forts.exe'), GAME);

  const scan = await scanGame(dir);
  assert.equal(path.basename(scan.chosen.path), 'Forts.exe');
  const offered = scan.exeCandidates.map((candidate) => path.basename(candidate.path));
  assert.ok(!offered.includes('ffmpeg.exe'), 'and it is not offered at all');
});

test('the other bundled tools that ship with games are excluded too', async (t) => {
  for (const tool of ['ffprobe.exe', 'ffplay.exe', '7z.exe', 'curl.exe', 'unrar.exe', 'crashpad_handler.exe', 'EpicWebHelper.exe']) {
    const dir = temp(t);
    writePe(path.join(dir, tool), { ...GAME, size: 900 * 1024 });
    writePe(path.join(dir, 'RealGame.exe'), GAME);

    const scan = await scanGame(dir);
    assert.equal(path.basename(scan.chosen.path), 'RealGame.exe', `${tool} was chosen over the game`);
  }
});

test('a game whose name merely starts the same way is still found', async (t) => {
  // The whole cost of this change would be refusing to see a real game, so
  // these are the near misses that must survive.
  for (const name of ['Curling.exe', 'Sentry Knight.exe', 'Unzipped.exe', 'FFXIV.exe', '7 Days.exe']) {
    const dir = temp(t);
    writePe(path.join(dir, name), GAME);

    const scan = await scanGame(dir);
    assert.ok(scan.chosen, `${name} produced no candidate at all`);
    assert.equal(path.basename(scan.chosen.path), name, `${name} was wrongly excluded`);
  }
});

test('a folder holding nothing but tools says so instead of picking one', async (t) => {
  const dir = temp(t);
  writePe(path.join(dir, 'ffmpeg.exe'), { ...GAME, size: 900 * 1024 });

  const scan = await scanGame(dir);
  assert.equal(scan.chosen, null, 'better no answer than an answer about ffmpeg');
  assert.ok(scan.emptyReason, 'and it says why');
});
