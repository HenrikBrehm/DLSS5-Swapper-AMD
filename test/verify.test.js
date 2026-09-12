'use strict';
// Task 1.9: reading OptiScaler's log to tell "it installed" apart from
// "it is running". Those are different statements, and until now the
// application could only make the first one.
//
// The patterns under test are a hypothesis until a real log exists (H6), so
// the tests are written against what the parser must tolerate rather than
// against one exact format.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseOptiScalerLog, verifyInstall, logPathFor, LOG_NAME } = require('../src/core/verify');

const SYNTHETIC = fs.readFileSync(path.join(__dirname, 'fixtures', 'optiscaler-log-synthetic.txt'), 'utf8');
const exePath = path.join('C:', 'Games', 'X', 'bin', 'x64', 'Game.exe');
const withLog = (text) => ({ exists: () => true, readFile: () => text });

test('the synthetic log reads as FSR 4 on the INT8 model, with no frame generation', () => {
  const found = parseOptiScalerLog(SYNTHETIC);
  assert.equal(found.upscaler, 'fsr4');
  assert.equal(found.fsr4, true);
  assert.equal(found.int8, true, 'this is what an RX 7000 runs');
  assert.equal(found.fg, null);
  assert.deepEqual(found.errors, [], '"error code 0" is not an error');
});

test('FSR 4 is never reported as plain FSR 3.1, however the line is spelled', () => {
  for (const line of ['Upgrading FSR 3.1 to FSR 4.1.1', 'selected: FSR4', 'using fsr-4', 'FSR 4 ready']) {
    const found = parseOptiScalerLog(line);
    assert.equal(found.upscaler, 'fsr4', line);
    assert.equal(found.fsr4, true, line);
  }
});

test('a log that only ever reaches FSR 3.1 says so', () => {
  const found = parseOptiScalerLog('[info] Dx12Upscaler = fsr31\n[info] FSR 3.1.4 init ok');
  assert.equal(found.upscaler, 'fsr31');
  assert.equal(found.fsr4, false);
  assert.equal(found.int8, false, 'INT8 only means anything alongside FSR 4');
});

test('XeSS and DLSS are recognised too, so a wrong backend is visible rather than silent', () => {
  assert.equal(parseOptiScalerLog('[info] XeSS 2.0 initialised').upscaler, 'xess');
  assert.equal(parseOptiScalerLog('[info] DLSS inputs hooked, DLSS selected').upscaler, 'dlss');
});

test('the frame generation actually in use is read back', () => {
  assert.equal(parseOptiScalerLog('[info] FGOutput = fsrfg').fg, 'fsrfg');
  assert.equal(parseOptiScalerLog('[info] FG output: XeFG active').fg, 'xefg');
  assert.equal(parseOptiScalerLog('[info] nukems swapchain created').fg, 'nukems');
  assert.equal(parseOptiScalerLog('[info] Frame generation: disabled').fg, null);
});

test('real errors are collected and harmless mentions of the word are not', () => {
  const text = [
    '[2026-09-12 22:41:03] [info] OptiScaler loaded',
    '[2026-09-12 22:41:04] [error] Failed to create FSR context',
    '[2026-09-12 22:41:05] [info] First frame presented, error code 0',
    '[2026-09-12 22:41:06] [info] no error reported by the backend',
    '[2026-09-12 22:41:07] [critical] amdxcffx64.dll could not be loaded'
  ].join('\n');
  const found = parseOptiScalerLog(text);
  assert.equal(found.errors.length, 2);
  assert.match(found.errors[0], /Failed to create FSR context/);
  assert.match(found.errors[1], /amdxcffx64\.dll/);
});

test('the error list is capped, so one broken frame loop cannot flood the report', () => {
  const spam = Array.from({ length: 500 }, (_, i) => `[error] dispatch failed ${i}`).join('\n');
  assert.equal(parseOptiScalerLog(spam).errors.length, 20);
});

test('an empty or whitespace-only log parses to nothing found, not to a crash', () => {
  for (const text of ['', '   \n\n  ', null, undefined]) {
    const found = parseOptiScalerLog(text);
    assert.equal(found.upscaler, null);
    assert.deepEqual(found.errors, []);
  }
});

test('a log that names no upscaler at all is a failure, and that is the point', () => {
  // The proxy loaded and wrote a log, but nothing was ever selected. This is
  // exactly the case that used to be invisible.
  const text = '[info] OptiScaler v0.9.4 loaded as dxgi.dll\n[error] No supported inputs found in this game';
  const result = verifyInstall('C:\\Games\\X', exePath, 'amd-optiscaler', withLog(text));
  assert.equal(result.state, 'failed');
  assert.equal(result.details.upscaler, null);
  assert.equal(result.details.errors.length, 1);
});

test('a working install reports ok, even if the log grumbles about something else', () => {
  const text = SYNTHETIC + '\n[error] Could not create the overlay font atlas';
  const result = verifyInstall('C:\\Games\\X', exePath, 'amd-optiscaler', withLog(text));
  assert.equal(result.state, 'ok', 'the upscaler is running, which is what was asked');
  assert.equal(result.details.fsr4, true);
  assert.equal(result.details.errors.length, 1, 'and the grumble is still reported');
});

test('no log yet is not a failure: the game simply has not been started', () => {
  const result = verifyInstall('C:\\Games\\X', exePath, 'amd-optiscaler', { exists: () => false });
  assert.equal(result.state, 'no-log');
  assert.equal(result.details.file, logPathFor(exePath));
});

test('a log that cannot be read reads as "not yet", never as a false success', () => {
  const result = verifyInstall('C:\\Games\\X', exePath, 'amd-optiscaler', {
    exists: () => true,
    readFile: () => { throw new Error('EBUSY: the game still has it open'); }
  });
  assert.equal(result.state, 'no-log');
  assert.equal(result.details.unreadable, true);
});

test('the log is looked for beside the executable, under the name the config sets', () => {
  assert.equal(path.basename(logPathFor(exePath)), LOG_NAME);
  assert.equal(path.dirname(logPathFor(exePath)), path.dirname(exePath));
  // configureAmd writes exactly this name into [Log] LogFileName; if one of
  // the two ever changes, the verify step would look in the wrong place.
  const upstream = require('../src/core/optiscaler-upstream');
  assert.equal(upstream.LOG_FILE, LOG_NAME);
});

test('the fixture is marked as synthetic, so nobody mistakes it for evidence', () => {
  assert.match(SYNTHETIC, /SYNTHETIC FIXTURE/);
  assert.match(SYNTHETIC, /H6/, 'and names the task that replaces it');
});
