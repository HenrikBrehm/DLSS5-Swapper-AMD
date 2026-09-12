'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const diagnostics = require('../src/core/diagnostics');

// Every report worth answering has needed the same files, asked for one at a
// time: the game's dlss5-feed.log, its ReShade.log, the install manifest, and
// which driver the person is on. This gathers them into one attachable file.
function game(t, files = {}) {
  const gameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diagnostics-'));
  t.after(() => fs.rmSync(gameDir, { recursive: true, force: true }));
  const exeDir = path.join(gameDir, 'bin');
  fs.mkdirSync(path.join(exeDir, 'host64'), { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    const file = path.join(gameDir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }
  return { gameDir, exeDir };
}

test('the logs a report needs are found and named', (t) => {
  const { gameDir, exeDir } = game(t, {
    'bin/dlss5-feed.log': 'feature ready: 3840x2160 DLAA',
    'bin/ReShade.log': 'Initializing crosire’s ReShade',
    'bin/host64/dlss5-feed-host.log': 'host started',
    '_DLSS5_Backup/manifest.json': '{"version":1,"route":"feeder"}'
  });

  const found = diagnostics.sources({ gameDir, exeDir });
  const labels = found.map(item => item.label);
  assert.ok(labels.includes('game: dlss5-feed.log'));
  assert.ok(labels.includes('game: ReShade.log'));
  assert.ok(labels.includes(`game: ${path.join('host64', 'dlss5-feed-host.log')}`));
  assert.ok(labels.includes('install manifest'));
});

test('every file found is in the report, with what the caller knew', (t) => {
  const { gameDir, exeDir } = game(t, {
    'bin/dlss5-feed.log': 'NGX feature 18 -> the query itself failed 0xBAD0000C',
    'bin/ReShade.log': 'loaded from bin\\\\dxgi.dll'
  });

  const { text, sources } = diagnostics.report({
    gameDir, exeDir,
    facts: { app: '2.2.3', gpu: 'NVIDIA GeForce RTX 5090 - 616.64', empty: null }
  });

  assert.equal(sources.length, 2);
  assert.match(text, /app: 2\.2\.3/);
  assert.match(text, /gpu: NVIDIA GeForce RTX 5090 - 616\.64/);
  assert.doesNotMatch(text, /empty/, 'a fact the caller did not have is left out, not printed as null');
  assert.match(text, /0xBAD0000C/, 'the feeder log is carried in full');
  assert.match(text, /dxgi\.dll/, 'so is the ReShade log');
});

// A ReShade log from a long session runs to megabytes and the useful part is
// the end - where the crash is.
test('a huge log is cut from the front, and says where it was cut', (t) => {
  const big = 'x'.repeat(diagnostics.TAIL_BYTES * 3) + 'THE-END-OF-THE-FILE';
  const { gameDir, exeDir } = game(t, { 'bin/ReShade.log': big });

  const { text } = diagnostics.report({ gameDir, exeDir });
  assert.match(text, /THE-END-OF-THE-FILE/, 'the end is kept');
  assert.match(text, /the first \d+ bytes are omitted/);
  assert.ok(text.length < big.length / 2, 'the report is a fraction of the log it read');
});

test('a game with no logs yet says so instead of producing an empty file', (t) => {
  const { gameDir, exeDir } = game(t);
  const { text, sources } = diagnostics.report({ gameDir, exeDir });
  assert.deepEqual(sources, []);
  assert.match(text, /No log files were found/);
  assert.match(text, /Run the install once, launch the game/);
});

// Nothing may be collected that the person is not shown first.
test('what would be gathered can be listed without reading any of it', (t) => {
  const { gameDir, exeDir } = game(t, { 'bin/dlss5-feed.log': 'secret-looking content' });
  const found = diagnostics.sources({ gameDir, exeDir });
  assert.equal(found.length, 1);
  assert.equal(found[0].bytes, 'secret-looking content'.length);
  assert.ok(!JSON.stringify(found).includes('secret-looking'), 'the listing carries paths and sizes, not contents');
});

// ---------------------------------------------------------------------------
// Task 5.4: what an AMD report has to carry to be answerable.
// ---------------------------------------------------------------------------
const RDNA3 = {
  name: 'AMD Radeon RX 7900 XT', vendor: 'amd', driver: '32.0.31041.1004',
  adrenalin: '26.8.1', rdnaGen: 3, mobile: false, fsr4Capable: true,
  fsr4Dll: { path: 'C:/Windows/System32/DriverStore/FileRepository/u0203304/amdxcffx64.dll', version: '2.3.0.3193' }
};
const RTX = { name: 'NVIDIA GeForce RTX 4090', vendor: 'nvidia', driver: '616.56', adrenalin: null, rdnaGen: null, mobile: false, fsr4Capable: false, fsr4Dll: null };

test('the OptiScaler log is collected, because it names the upscaler that actually ran', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-opti-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'OptiScaler.log'), '[info] Fsr4Update enabled, upgrading FSR 3.1 to FSR 4.1.1\n');

  const found = diagnostics.sources({ exeDir: dir });
  assert.ok(found.some((item) => item.file.endsWith('OptiScaler.log')), 'it is offered as a source');
  const { text } = diagnostics.report({ exeDir: dir });
  assert.match(text, /upgrading FSR 3\.1 to FSR 4\.1\.1/, 'and its contents reach the file');
});

test('an AMD machine is described by the facts that decide whether FSR 4 can run', () => {
  const { text } = diagnostics.report({ gpuRows: [RDNA3] });
  assert.match(text, /adrenalin: 26\.8\.1/, 'the version that decides FSR 4 on an RX 7000');
  assert.match(text, /architecture: RDNA3/);
  assert.match(text, /fsr4Capable: yes/);
  assert.match(text, /amdxcffx64\.dll \(2\.3\.0\.3193\)/);
  assert.match(text, /AMD Radeon RX 7900 XT \(32\.0\.31041\.1004\)/);
});

test('a missing FSR 4 library is written down, because its absence explains the report', () => {
  // Without it FSR 4 cannot load at all. Saying nothing would turn an
  // obvious answer into a puzzling one.
  const { text } = diagnostics.report({ gpuRows: [{ ...RDNA3, fsr4Dll: null }] });
  assert.match(text, /fsr4Library: not found in the driver store/);
});

test('a Radeon beside an RTX is still described, and both adapters are listed', () => {
  const { text } = diagnostics.report({ gpuRows: [RTX, RDNA3] });
  assert.match(text, /NVIDIA GeForce RTX 4090/);
  assert.match(text, /AMD Radeon RX 7900 XT/);
  assert.match(text, /adrenalin: 26\.8\.1/, 'the Radeon is what the AMD facts are about');
});

test('an NVIDIA-only machine gets no AMD lines at all', () => {
  const { text } = diagnostics.report({ gpuRows: [RTX] });
  assert.equal(/adrenalin:/.test(text), false);
  assert.equal(/fsr4Capable:/.test(text), false);
  assert.match(text, /NVIDIA GeForce RTX 4090/, 'but the adapter is still named');
});

test('the engine is recorded with whether it had a slot to open', () => {
  const unreal = diagnostics.report({ engine: { engine: 'unreal', upscalerSlot: true, projectName: 'Moria', configDir: 'C:/Users/x/AppData/Local/Moria/Saved/Config/WindowsNoEditor' } });
  assert.match(unreal.text, /engine: unreal \(has an upscaler slot\)/);
  assert.match(unreal.text, /engineProject: Moria/);
  assert.match(unreal.text, /WindowsNoEditor/);

  const unity = diagnostics.report({ engine: { engine: 'unity', upscalerSlot: false } });
  assert.match(unity.text, /engine: unity \(no upscaler slot\)/);
});

test('a fact the caller stated by hand is never overwritten by a derived one', () => {
  const { text } = diagnostics.report({ gpuRows: [RDNA3], facts: { adrenalin: 'stated by the caller' } });
  assert.match(text, /adrenalin: stated by the caller/);
  assert.equal(/adrenalin: 26\.8\.1/.test(text), false);
});

test('no rows and no engine changes nothing about the old behaviour', () => {
  const before = diagnostics.report({ facts: { app: '2.2.6' }, now: new Date(0) }).text;
  const after = diagnostics.report({ facts: { app: '2.2.6' }, gpuRows: null, engine: null, now: new Date(0) }).text;
  assert.equal(after, before);
  assert.deepEqual(diagnostics.amdFacts(null, null), {});
  assert.deepEqual(diagnostics.amdFacts([], undefined), {});
});
