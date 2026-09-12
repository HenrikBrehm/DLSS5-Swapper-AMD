'use strict';
// Task 1.6: upstream OptiScaler as a pinned component.
// No 7za, no network and no 210 MB of real DLLs are involved: the extractor
// and the verified download are injected, and payloads are built from the
// same non-executable PE fixture the other install tests use.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const upstream = require('../src/core/optiscaler-upstream');
const { writePe } = require('./fixtures/pe');

const FIXTURE_INI = path.join(__dirname, 'fixtures', 'optiscaler-0.9.4.ini');

function temp(t, prefix = 'opti-upstream-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A payload that mirrors the real archive layout, small enough to build in
// milliseconds. `skip` leaves one entry out, `bitness32` writes one of them
// as a 32-bit module.
function payload(root, { skip = [], bitness32 = [] } = {}) {
  for (const rel of upstream.BINARIES) {
    if (skip.includes(rel)) continue;
    writePe(path.join(root, rel), { bitness: bitness32.includes(rel) ? 32 : 64, size: 4096 });
  }
  for (const rel of [...upstream.TEXT_FILES, ...upstream.LICENSES, 'OptiScaler-GPL-3.0.txt']) {
    if (skip.includes(rel)) continue;
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), `contents of ${rel}\n`);
  }
  return root;
}

test('the pinned release is the exact 0.9.4 archive that was downloaded and measured', () => {
  assert.equal(upstream.RELEASE.version, '0.9.4');
  assert.equal(upstream.RELEASE.size, 55016448);
  assert.match(upstream.RELEASE.sha256, /^[0-9a-f]{64}$/);
  assert.equal(upstream.RELEASE.sha256, '575cb4df866116093df75af607e37fd70e10f5163e0f23fd5c804142e80ef0ad');
  assert.ok(upstream.RELEASE.url.endsWith('.7z'), 'upstream ships 7z, not zip');
  assert.ok(upstream.RELEASE.url.startsWith('https://github.com/optiscaler/OptiScaler/releases/download/v0.9.4/'));
  assert.equal(upstream.RELEASE.licenseHash, '3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986');
});

test('a complete payload passes validation', (t) => {
  assert.equal(upstream.validateUpstreamPayload(payload(temp(t))), true);
});

test('a missing module is refused, and the message names it', (t) => {
  const root = payload(temp(t), { skip: ['fakenvapi.dll'] });
  assert.throws(() => upstream.validateUpstreamPayload(root), (error) => {
    assert.equal(error.code, 'errOptiPayload');
    assert.match(error.message, /fakenvapi\.dll/);
    return true;
  });
});

test('a missing text file is refused as well, licences included', (t) => {
  for (const rel of ['OptiScaler.ini', 'fakenvapi.ini', 'Licenses/XeSS_LICENSE.txt']) {
    const root = payload(temp(t), { skip: [rel] });
    assert.throws(() => upstream.validateUpstreamPayload(root), { code: 'errOptiPayload' }, rel);
  }
});

test('a 32-bit module is refused: every shipped component is x64', (t) => {
  const root = payload(temp(t), { bitness32: ['OptiScaler.dll'] });
  assert.throws(() => upstream.validateUpstreamPayload(root), { code: 'errOptiPayload' });
});

test('the D3D12 redistributable keeps upstream spelling, lowercase s', () => {
  assert.ok(upstream.CORE.includes('D3D12_Optiscaler/D3D12Core.dll'));
  assert.equal(upstream.CORE.includes('D3D12_OptiScaler/D3D12Core.dll'), false, 'that is the NVIDIA fork spelling');
});

test('the upstream setup scripts are known but never part of the payload plan', (t) => {
  const root = payload(temp(t));
  for (const rel of upstream.SETUP_SCRIPTS) fs.writeFileSync(path.join(root, rel), 'echo do not run me');
  const targets = upstream.copyPlan(root, 'dxgi').map((item) => item.to);
  for (const rel of upstream.SETUP_SCRIPTS) assert.equal(targets.includes(rel), false, rel);
});

test('the proxy takes the name the API dictates, and nothing else is renamed', (t) => {
  const root = payload(temp(t));
  const dx = upstream.copyPlan(root, 'dxgi');
  const vk = upstream.copyPlan(root, 'vulkan');
  assert.equal(upstream.hookFor('dxgi'), 'dxgi.dll');
  assert.equal(upstream.hookFor('vulkan'), 'winmm.dll');
  assert.ok(dx.some((i) => i.to === 'dxgi.dll' && i.from.endsWith('OptiScaler.dll')));
  assert.ok(vk.some((i) => i.to === 'winmm.dll' && i.from.endsWith('OptiScaler.dll')));
  assert.equal(dx.some((i) => i.to === 'OptiScaler.dll'), false);
  for (const item of dx.filter((i) => i.to.startsWith('amd_fidelityfx'))) {
    assert.equal(path.basename(item.from), item.to, 'FFX modules keep their names');
  }
});

test('the heavy optional modules are only copied when the chosen option needs them', (t) => {
  const root = payload(temp(t));
  const plan = (options) => upstream.copyPlan(root, 'dxgi', options).map((i) => i.to);

  const plain = plan({});
  assert.equal(plain.includes('dlssg_to_fsr3_amd_is_better.dll'), false, 'Nukem only for nukem FG');
  assert.equal(plain.includes('fakenvapi.dll'), false, 'fakenvapi only when asked for');
  assert.equal(plain.includes('libxess_fg.dll'), false, 'XeSS FG is 100 MB, not a default');

  assert.ok(plan({ inputs: 'fakenvapi' }).includes('fakenvapi.dll'));
  assert.ok(plan({ inputs: 'fakenvapi' }).includes('fakenvapi.ini'), 'its config travels with it');

  const nukem = plan({ fg: 'nukem' });
  assert.ok(nukem.includes('dlssg_to_fsr3_amd_is_better.dll'));
  assert.ok(nukem.includes('fakenvapi.dll'), 'Nukem output needs fakenvapi on AMD');

  const xefg = plan({ fg: 'xefg' });
  assert.ok(xefg.includes('libxess_fg.dll') && xefg.includes('libxell.dll'));
  assert.ok(xefg.includes('fakenvapi.dll'), 'XeFG needs fakenvapi on AMD');
});

test('every plan carries the licences, including the separately fetched GPL', (t) => {
  const root = payload(temp(t));
  const targets = upstream.copyPlan(root, 'dxgi').map((i) => i.to);
  for (const rel of upstream.LICENSES) assert.ok(targets.includes(`OptiScaler/licenses/${path.basename(rel)}`), rel);
  assert.ok(targets.includes('OptiScaler/licenses/LICENSE.GPL-3.0.txt'), 'GPL-3.0 is not inside the archive');
});

test('ensure downloads once, re-extracts every time, and validates what came out', async (t) => {
  const cacheRoot = temp(t, 'opti-cache-');
  const calls = { fetched: [], extracted: 0 };
  const base = path.join(cacheRoot, 'components', `OptiScaler-upstream-${upstream.RELEASE.version}`);
  const deps = {
    cached: () => false,
    fetchVerified: async (url, expected, file) => {
      calls.fetched.push(url);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'verified bytes');
    },
    extract: async (archive, dest) => { calls.extracted++; payload(dest); }
  };
  const root = await upstream.ensureOptiScalerUpstream(cacheRoot, deps);
  assert.equal(root, base);
  assert.deepEqual(calls.fetched, [upstream.RELEASE.url, upstream.RELEASE.licenseUrl]);
  assert.equal(calls.extracted, 1);

  // A cached archive skips the download but is still extracted and validated,
  // so loose files that appeared in the cache are never trusted.
  calls.fetched.length = 0;
  await upstream.ensureOptiScalerUpstream(cacheRoot, { ...deps, cached: () => true });
  assert.deepEqual(calls.fetched, []);
  assert.equal(calls.extracted, 2);
});

test('a download whose bytes do not match is surfaced, not swallowed', async (t) => {
  const cacheRoot = temp(t, 'opti-cache-bad-');
  await assert.rejects(
    upstream.ensureOptiScalerUpstream(cacheRoot, {
      cached: () => false,
      fetchVerified: async () => { throw Object.assign(new Error('expected X, received Y'), { code: 'componentChecksum' }); },
      extract: async () => { throw new Error('must not be reached'); }
    }),
    { code: 'componentChecksum' }
  );
});

test('an extraction that produces an incomplete payload fails validation, not silently succeeds', async (t) => {
  const cacheRoot = temp(t, 'opti-cache-partial-');
  await assert.rejects(
    upstream.ensureOptiScalerUpstream(cacheRoot, {
      cached: () => false,
      fetchVerified: async (url, expected, file) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'bytes'); },
      extract: async (archive, dest) => payload(dest, { skip: ['amd_fidelityfx_upscaler_dx12.dll'] })
    }),
    { code: 'errOptiPayload' }
  );
});

test('the shipped OptiScaler.ini is kept verbatim and carries the keys the AMD route will set', () => {
  const text = fs.readFileSync(FIXTURE_INI, 'utf8');
  assert.ok(text.split(/\r?\n/).length > 1000, 'the real file, not a stub');
  // These are read off the real 0.9.4 file. Task 1.7 may only set keys that
  // exist here; the fixture is what makes that checkable.
  for (const [section, key] of [
    ['Upscalers', 'Dx11Upscaler'], ['Upscalers', 'Dx12Upscaler'], ['Upscalers', 'VulkanUpscaler'],
    ['FSR', 'Fsr4Update'], ['FSR', 'Fsr4ForceEnableInt8'], ['FSR', 'FsrAgilitySDKUpgrade'],
    ['Spoofing', 'Dxgi'], ['Spoofing', 'StreamlineSpoofing'],
    ['FrameGen', 'Enabled'], ['FrameGen', 'FGInput'], ['FrameGen', 'FGOutput'],
    ['Inputs', 'EnableDlssInputs'], ['Inputs', 'EnableFsr2Inputs'], ['Inputs', 'EnableXeSSInputs'],
    ['Log', 'LogToFile'], ['Log', 'LogLevel'], ['Log', 'LogFileName'], ['Plugins', 'LoadAsiPlugins'],
    ['ProcessFilter', 'TargetProcessName']
  ]) {
    const start = text.indexOf(`[${section}]`);
    assert.notEqual(start, -1, `section [${section}] missing`);
    const next = text.indexOf('\n[', start + 1);
    const body = text.slice(start, next === -1 ? undefined : next);
    assert.match(body, new RegExp(`^\\s*${key}\\s*=`, 'm'), `[${section}] ${key} missing`);
  }
  // Keys the AMD route must NOT invent. Each of these was checked against the
  // real file: a dead key is written silently and does nothing, which is the
  // worst kind of bug to chase at runtime.
  for (const dead of ['DlssNr', 'Fsr4Enable', 'UpscalerOutput', 'AntiLag2']) {
    assert.equal(text.includes(`\n${dead}=`), false, `${dead} does not exist upstream`);
  }
});

test('FSR 4 on this hardware is reachable through documented values only', () => {
  const text = fs.readFileSync(FIXTURE_INI, 'utf8');
  // The comment above Dx12Upscaler names fsr31 as the FSR 4 path, and
  // Fsr4ForceEnableInt8 is what an RDNA3 card needs. Both are quoted here so
  // a future archive bump that renames them fails loudly.
  assert.match(text, /fsr31 \(also for FSR4\)/);
  assert.match(text, /fsr31_12 \(dx11on12, FSR4\)/);
  assert.match(text, /fsr31_12 \(VKon12, FSR4\)/);
  assert.match(text, /Enables INT8 model for all GPUs/);
  assert.match(text, /Enables updating of FSR3\.X to FSR4/);
});

// ---------------------------------------------------------------------------
// Task 1.7: the AMD configurator.
//
// Every assertion below is anchored to the INI the real archive ships. A key
// this configurator writes that does not exist there would be accepted
// silently by OptiScaler and then do nothing, which is the worst kind of bug
// to chase from a bug report.
// ---------------------------------------------------------------------------
const ini = require('../src/core/feeder-config');

const RDNA3 = { vendor: 'amd', rdnaGen: 3, mobile: false, adrenalin: '26.8.1', fsr4Capable: true };
const RDNA4 = { vendor: 'amd', rdnaGen: 4, mobile: false, adrenalin: '26.8.1', fsr4Capable: true };
const RDNA2 = { vendor: 'amd', rdnaGen: 2, mobile: false, adrenalin: '26.8.1', fsr4Capable: false };

const NO_UPSCALER = { dlss: false, dlssg: false, streamline: false, fsr2: false, fsr31: false, fsr31Signed: false, xess: false, any: false };
const DLSS_ONLY = { ...NO_UPSCALER, dlss: true, any: true };
const FSR31_GAME = { ...NO_UPSCALER, fsr31: true, any: true };

const targetFor = (extra = {}) => ({
  exePath: 'C:\\Games\\Some Game\\bin\\x64\\Game.exe',
  api: 'dxgi', apiLabel: 'DirectX 12', bitness: 64, upscalers: NO_UPSCALER, ...extra
});
const base = () => fs.readFileSync(FIXTURE_INI, 'utf8');
const read = (text, section, key) => ini.getIni(text, section, key);

test('every key the configurator writes exists in the shipped INI', () => {
  const text = base();
  const seen = new Set();
  for (const gpu of [RDNA2, RDNA3, RDNA4]) {
    for (const output of ['fsr4', 'fsr31', 'xess']) {
      for (const inputs of ['dxgi-spoof', 'fakenvapi', 'none']) {
        for (const fg of ['none', 'nukem', 'optifg', 'fsrfg', 'xefg']) {
          for (const entry of upstream.amdPlan(targetFor(), gpu, { output, inputs, fg })) {
            seen.add(`${entry.section}.${entry.key}`);
            const start = text.indexOf(`[${entry.section}]`);
            assert.notEqual(start, -1, `no section [${entry.section}]`);
            const next = text.indexOf('\n[', start + 1);
            const body = text.slice(start, next === -1 ? undefined : next);
            assert.match(body, new RegExp(`^\\s*${entry.key}\\s*=`, 'm'), `[${entry.section}] ${entry.key} does not exist upstream`);
          }
        }
      }
    }
  }
  assert.ok(seen.size >= 12, `only ${seen.size} keys planned`);
});

test('RDNA3 needs both FSR 4 switches, because one of them is RDNA4-only by default', () => {
  const out = upstream.configureAmd(base(), targetFor(), RDNA3, {});
  assert.equal(read(out, 'Upscalers', 'Dx12Upscaler'), 'fsr31', 'FSR 4 is reached through the fsr31 backend');
  assert.equal(read(out, 'FSR', 'Fsr4Update'), 'true', 'auto means true only for RDNA4');
  assert.equal(read(out, 'FSR', 'Fsr4ForceEnableInt8'), 'true', 'the INT8 model is what an RX 7000 runs');
});

test('RDNA4 gets FSR 4 without being forced onto the INT8 model', () => {
  const out = upstream.configureAmd(base(), targetFor(), RDNA4, {});
  assert.equal(read(out, 'FSR', 'Fsr4Update'), 'true');
  assert.equal(read(out, 'FSR', 'Fsr4ForceEnableInt8'), 'false', 'RDNA4 has FP8 in hardware');
});

test('a card that cannot run FSR 4 is configured for FSR 3.1 instead', () => {
  const out = upstream.configureAmd(base(), targetFor(), RDNA2, {});
  assert.equal(read(out, 'Upscalers', 'Dx12Upscaler'), 'fsr31');
  assert.equal(read(out, 'FSR', 'Fsr4Update'), 'false');
  assert.equal(read(out, 'FSR', 'Fsr4ForceEnableInt8'), 'false');
});

test('each API is pointed at the backend that actually reaches FSR 4 there', () => {
  const out = upstream.configureAmd(base(), targetFor(), RDNA3, { output: 'fsr4' });
  assert.equal(read(out, 'Upscalers', 'Dx12Upscaler'), 'fsr31');
  assert.equal(read(out, 'Upscalers', 'Dx11Upscaler'), 'fsr31_12', 'DX11 goes through D3D11on12');
  assert.equal(read(out, 'Upscalers', 'VulkanUpscaler'), 'fsr31_12', 'Vulkan goes through the DX12 interop');

  const plain = upstream.configureAmd(base(), targetFor(), RDNA2, { output: 'fsr31' });
  assert.equal(read(plain, 'Upscalers', 'Dx11Upscaler'), 'fsr31', 'FSR 3.1 has a native DX11 path');
  assert.equal(read(plain, 'Upscalers', 'VulkanUpscaler'), 'fsr31');

  const xess = upstream.configureAmd(base(), targetFor(), RDNA3, { output: 'xess' });
  assert.equal(read(xess, 'Upscalers', 'Dx12Upscaler'), 'xess');
  assert.equal(read(xess, 'Upscalers', 'Dx11Upscaler'), 'xess_12', 'native DX11 XeSS is Arc only');
  assert.equal(read(xess, 'FSR', 'Fsr4Update'), 'false', 'a switch away from FSR 4 turns it off again');
});

test('spoofing is only armed when the game needs to be told it has an NVIDIA card', () => {
  const spoof = upstream.configureAmd(base(), targetFor(), RDNA3, { inputs: 'dxgi-spoof' });
  assert.equal(read(spoof, 'Spoofing', 'Dxgi'), 'true');

  const fake = upstream.configureAmd(base(), targetFor(), RDNA3, { inputs: 'fakenvapi' });
  assert.equal(read(fake, 'Spoofing', 'Dxgi'), 'false', 'fakenvapi avoids spoofing the whole game');
  assert.equal(read(fake, 'Spoofing', 'StreamlineSpoofing'), 'true');

  const none = upstream.configureAmd(base(), targetFor(), RDNA3, { inputs: 'none' });
  assert.equal(read(none, 'Spoofing', 'Dxgi'), 'false');
  assert.equal(read(none, 'Spoofing', 'StreamlineSpoofing'), 'false');
});

test('a DLSS-only game is spoofed by default, a game with an AMD input is not', () => {
  const dlss = upstream.configureAmd(base(), targetFor({ upscalers: DLSS_ONLY }), RDNA3, {});
  assert.equal(read(dlss, 'Spoofing', 'Dxgi'), 'true', 'nothing else would expose the inputs');

  const fsr = upstream.configureAmd(base(), targetFor({ upscalers: FSR31_GAME }), RDNA3, {});
  assert.equal(read(fsr, 'Spoofing', 'Dxgi'), 'false', 'the game already speaks FidelityFX');
});

test('frame generation writes an input and an output that belong together', () => {
  const cases = {
    none: ['false', 'nofg', 'nofg'],
    nukem: ['true', 'nukems', 'nukems'],
    optifg: ['true', 'upscaler', 'fsrfg'],
    fsrfg: ['true', 'fsrfg', 'fsrfg'],
    xefg: ['true', 'upscaler', 'xefg']
  };
  for (const [fg, [enabled, input, output]] of Object.entries(cases)) {
    const out = upstream.configureAmd(base(), targetFor(), RDNA3, { fg });
    assert.equal(read(out, 'FrameGen', 'Enabled'), enabled, fg);
    assert.equal(read(out, 'FrameGen', 'FGInput'), input, fg);
    assert.equal(read(out, 'FrameGen', 'FGOutput'), output, fg);
  }
});

test('logging is armed so the verify step has something to read', () => {
  const out = upstream.configureAmd(base(), targetFor(), RDNA3, {});
  assert.equal(read(out, 'Log', 'LogToFile'), 'true');
  assert.equal(read(out, 'Log', 'LogLevel'), '2');
  assert.equal(read(out, 'Log', 'LogFileName'), 'OptiScaler.log');
});

test('the proxy is pinned to the game executable and foreign ASI plugins stay out', () => {
  const out = upstream.configureAmd(base(), targetFor(), RDNA3, {});
  assert.equal(read(out, 'ProcessFilter', 'TargetProcessName'), 'Game.exe', 'so launchers are left alone');
  assert.equal(read(out, 'Plugins', 'LoadAsiPlugins'), 'false');
});

test('the Windows 10 Agility workaround is never switched on from here', () => {
  // It requires copying a folder beside the executable, and on Windows 11 it
  // is simply wrong. Nothing here may enable it silently.
  const out = upstream.configureAmd(base(), targetFor(), RDNA3, {});
  assert.equal(read(out, 'FSR', 'FsrAgilitySDKUpgrade'), 'auto', 'left exactly as shipped');
  const planned = upstream.amdPlan(targetFor(), RDNA3, {}).map((e) => `${e.section}.${e.key}`);
  assert.equal(planned.includes('FSR.FsrAgilitySDKUpgrade'), false);
});

test('applying the configuration twice changes nothing the second time', () => {
  for (const options of [{}, { output: 'xess', inputs: 'fakenvapi', fg: 'nukem' }, { fg: 'optifg' }]) {
    const once = upstream.configureAmd(base(), targetFor(), RDNA3, options);
    assert.equal(upstream.configureAmd(once, targetFor(), RDNA3, options), once, JSON.stringify(options));
  }
});

test('settings the person changed by hand survive', () => {
  const edited = ini.setIni(ini.setIni(base(), 'Menu', 'Scale', '1.4'), 'Sharpness', 'Sharpness', '0.8');
  const out = upstream.configureAmd(edited, targetFor(), RDNA3, {});
  assert.equal(read(out, 'Menu', 'Scale'), '1.4');
  assert.equal(read(out, 'Sharpness', 'Sharpness'), '0.8');
});

test('no key that does not exist upstream is ever written', () => {
  const out = upstream.configureAmd(base(), targetFor(), RDNA3, { fg: 'optifg', inputs: 'fakenvapi' });
  for (const dead of ['DlssNr', 'Fsr4Enable', 'UpscalerOutput', 'AntiLag2']) {
    assert.equal(out.includes(`\n${dead}=`), false, dead);
  }
  // Anti-Lag 2 is fakenvapi's job, not a setting in this file.
  assert.equal(out.includes('[DlssNr]'), false);
});

test('an unknown option is refused rather than quietly ignored', () => {
  for (const options of [{ output: 'dlss' }, { inputs: 'magic' }, { fg: 'lsfg' }]) {
    assert.throws(() => upstream.configureAmd(base(), targetFor(), RDNA3, options), { code: 'errOptiOption' }, JSON.stringify(options));
  }
});
