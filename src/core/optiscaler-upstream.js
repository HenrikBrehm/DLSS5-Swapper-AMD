'use strict';
// Upstream OptiScaler (optiscaler/OptiScaler) as a pinned, verified component.
//
// This is the AMD counterpart to optiscaler.js, which pins Dagherbou's
// DLSS-NR fork for NVIDIA. Upstream is what turns a game's DLSS, FSR 2+ or
// XeSS inputs into FSR 4.1 output on a Radeon, and it ships fakenvapi and
// Nukem's DLSSG-to-FSR3 mod in the same archive.
//
// Three rules carried over from the NVIDIA route, and they are not
// negotiable: the archive is pinned by URL and SHA-256, it is re-extracted
// from verified bytes on every install rather than trusted from a cache, and
// the upstream setup scripts (setup_windows.bat, setup_linux.sh) are never
// executed. This application decides what gets copied where.
//
// Everything below was read off the real 0.9.4 archive, not guessed. The
// file list lives in loop/optiscaler-0.9.4-files.txt and the shipped
// OptiScaler.ini is kept verbatim as test/fixtures/optiscaler-0.9.4.ini so
// the configurator can be held to keys that actually exist.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const pe = require('./pe');
const ini = require('./feeder-config');
const { cached, fetchVerified } = require('./runtime-components');
const { safePath } = require('./file-journal');

const RELEASE = Object.freeze({
  version: '0.9.4',
  url: 'https://github.com/optiscaler/OptiScaler/releases/download/v0.9.4/Optiscaler_0.9.4-final.20260718._MM.7z',
  size: 55016448,
  sha256: '575cb4df866116093df75af607e37fd70e10f5163e0f23fd5c804142e80ef0ad',
  // The GPL text is not inside the archive, so it is fetched and verified
  // separately and copied into the game beside the binaries.
  licenseUrl: 'https://raw.githubusercontent.com/optiscaler/OptiScaler/v0.9.4/LICENSE',
  licenseHash: '3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986'
});

// 64-bit modules the archive must contain. Note the folder spelling:
// upstream ships "D3D12_Optiscaler" with a lowercase s, unlike the NVIDIA
// fork's "D3D12_OptiScaler". Getting that wrong makes the Agility SDK
// redistributable silently absent.
const CORE = Object.freeze(['OptiScaler.dll', 'D3D12_Optiscaler/D3D12Core.dll']);
const FFX = Object.freeze([
  'amd_fidelityfx_dx12.dll', 'amd_fidelityfx_upscaler_dx12.dll',
  'amd_fidelityfx_framegeneration_dx12.dll', 'amd_fidelityfx_vk.dll'
]);
const XESS = Object.freeze(['libxess.dll', 'libxess_dx11.dll', 'libxess_fg.dll', 'libxell.dll']);
const FAKENVAPI = Object.freeze(['fakenvapi.dll']);
const NUKEM = Object.freeze(['dlssg_to_fsr3_amd_is_better.dll']);
const BINARIES = Object.freeze([...CORE, ...FFX, ...XESS, ...FAKENVAPI, ...NUKEM]);
const TEXT_FILES = Object.freeze(['OptiScaler.ini', 'fakenvapi.ini']);
const LICENSES = Object.freeze([
  'Licenses/DirectX_LICENSE.txt', 'Licenses/FidelityFX_v1_LICENSE.md',
  'Licenses/FidelityFX_v2_LICENSE.md', 'Licenses/XeSS_LICENSE.txt'
]);
// Present in the archive, deliberately never copied and never run.
const SETUP_SCRIPTS = Object.freeze(['setup_windows.bat', 'setup_linux.sh']);

function fail(code, message = code) { return Object.assign(new Error(message), { code }); }

// Which proxy name OptiScaler is installed under. DXGI covers DX11 and DX12;
// a Vulkan game never loads dxgi.dll, so winmm.dll is the entry point there.
function hookFor(api) { return api === 'vulkan' ? 'winmm.dll' : 'dxgi.dll'; }

function validateUpstreamPayload(root) {
  for (const rel of BINARIES) {
    if (pe.getBitness(safePath(root, rel)) !== 64) throw fail('errOptiPayload', `not a 64-bit module: ${rel}`);
  }
  for (const rel of [...TEXT_FILES, ...LICENSES]) {
    if (!fs.existsSync(safePath(root, rel))) throw fail('errOptiPayload', `missing from payload: ${rel}`);
  }
  return true;
}

function sevenZipPath() { return require('7zip-bin').path7za; }

function extract7z(archive, dest, exe = sevenZipPath()) {
  return new Promise((resolve, reject) => {
    execFile(exe, ['x', archive, `-o${dest}`, '-y'], { windowsHide: true, timeout: 300000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => error ? reject(fail('errOptiExtract', `7za failed: ${stderr || error.message}`)) : resolve(stdout));
  });
}

// Mirrors ensureOptiScaler: verified bytes in, validated payload out. The
// extractor is injectable so tests never need the 7za binary or 210 MB of
// real DLLs on disk.
async function ensureOptiScalerUpstream(cacheRoot, deps = {}) {
  const extract = deps.extract || extract7z;
  const verify = deps.fetchVerified || fetchVerified;
  const isCached = deps.cached || cached;
  const base = path.join(path.resolve(cacheRoot), 'components', `OptiScaler-upstream-${RELEASE.version}`);
  const archive = base + '.7z';
  if (!isCached(archive, RELEASE.sha256)) await verify(RELEASE.url, RELEASE.sha256, archive);
  await extract(archive, base);
  const license = path.join(base, 'OptiScaler-GPL-3.0.txt');
  if (!isCached(license, RELEASE.licenseHash)) await verify(RELEASE.licenseUrl, RELEASE.licenseHash, license);
  validateUpstreamPayload(base);
  return base;
}

// What actually lands in the game folder. Deliberately an explicit list, not
// "copy the archive": the FFX frame-generation module alone is 40 MB and the
// XeSS frame-generation pair another 100 MB, so a game that asked for
// upscaling only should not pay for them.
function copyPlan(root, api, options = {}) {
  const { inputs = 'none', fg = 'none' } = options;
  // Nukem's mod converts DLSS-FG calls to FSR 3 FG, and its own notes say an
  // AMD user needs fakenvapi alongside it. The same goes for XeFG output.
  const needsFakenvapi = inputs === 'fakenvapi' || fg === 'nukem' || fg === 'xefg';
  const files = [...CORE, ...FFX];
  if (fg === 'xefg') files.push(...XESS);
  else files.push('libxess.dll', 'libxess_dx11.dll');
  if (needsFakenvapi) files.push(...FAKENVAPI);
  if (fg === 'nukem') files.push(...NUKEM);

  const plan = [];
  for (const rel of files) {
    // OptiScaler.dll is the only file that changes name: it is the proxy.
    const to = rel === 'OptiScaler.dll' ? hookFor(api) : rel;
    plan.push({ from: safePath(root, rel), to });
  }
  if (needsFakenvapi) plan.push({ from: safePath(root, 'fakenvapi.ini'), to: 'fakenvapi.ini' });
  for (const rel of LICENSES) plan.push({ from: safePath(root, rel), to: `OptiScaler/licenses/${path.basename(rel)}` });
  plan.push({ from: safePath(root, 'OptiScaler-GPL-3.0.txt'), to: 'OptiScaler/licenses/LICENSE.GPL-3.0.txt' });
  return plan;
}

// --------------------------------------------------------------------------
// The AMD configuration.
//
// Every key below was read off the shipped OptiScaler.ini, and a test walks
// this plan against test/fixtures/optiscaler-0.9.4.ini to prove each one
// exists. That check matters because OptiScaler accepts an unknown key in
// silence: a misspelled switch does nothing at all and leaves no trace.
//
// The values are equally literal. FSR 4 is not its own backend - the shipped
// comment says "fsr31 (also for FSR4)" - so the way to it is the fsr31
// backend plus Fsr4Update, and on an RX 7000 also Fsr4ForceEnableInt8,
// because Fsr4Update on its own defaults to true for RDNA4 only.
const UPSCALER_BACKENDS = Object.freeze({
  // output -> [Dx12Upscaler, Dx11Upscaler, VulkanUpscaler]
  fsr4: Object.freeze(['fsr31', 'fsr31_12', 'fsr31_12']),
  fsr31: Object.freeze(['fsr31', 'fsr31', 'fsr31']),
  xess: Object.freeze(['xess', 'xess_12', 'xess'])
});
// FGInput/FGOutput pairs. "optifg" is spelled `upscaler` upstream: it drives
// frame generation from the upscaler's own output rather than from a frame
// generation input the game provides.
const FRAME_GEN = Object.freeze({
  none: Object.freeze(['false', 'nofg', 'nofg']),
  nukem: Object.freeze(['true', 'nukems', 'nukems']),
  optifg: Object.freeze(['true', 'upscaler', 'fsrfg']),
  fsrfg: Object.freeze(['true', 'fsrfg', 'fsrfg']),
  xefg: Object.freeze(['true', 'upscaler', 'xefg'])
});
const INPUT_MODES = Object.freeze(['dxgi-spoof', 'fakenvapi', 'none']);
const LOG_FILE = 'OptiScaler.log';

function resolveOptions(target, gpu, options = {}) {
  const upscalers = (target && target.upscalers) || {};
  // Only DLSS to read means the game has to be told it is talking to an
  // NVIDIA card; a game that already speaks FidelityFX or XeSS does not.
  const dlssOnly = Boolean(upscalers.dlss) && !upscalers.fsr2 && !upscalers.fsr31 && !upscalers.xess;
  const resolved = {
    output: options.output || (gpu && gpu.fsr4Capable ? 'fsr4' : 'fsr31'),
    inputs: options.inputs || (dlssOnly ? 'dxgi-spoof' : 'none'),
    fg: options.fg || 'none'
  };
  if (!UPSCALER_BACKENDS[resolved.output]) throw fail('errOptiOption', `unknown output: ${resolved.output}`);
  if (!INPUT_MODES.includes(resolved.inputs)) throw fail('errOptiOption', `unknown inputs: ${resolved.inputs}`);
  if (!FRAME_GEN[resolved.fg]) throw fail('errOptiOption', `unknown frame generation: ${resolved.fg}`);
  return resolved;
}

// The full set of [section, key, value] entries this configuration writes.
// Exposed so a test can hold every one of them against the shipped INI.
function amdPlan(target, gpu, options = {}) {
  const { output, inputs, fg } = resolveOptions(target, gpu, options);
  const [dx12, dx11, vulkan] = UPSCALER_BACKENDS[output];
  const [fgEnabled, fgInput, fgOutput] = FRAME_GEN[fg];
  const wantsFsr4 = output === 'fsr4';
  const entry = (section, key, value) => ({ section, key, value: String(value) });

  return [
    entry('Upscalers', 'Dx12Upscaler', dx12),
    entry('Upscalers', 'Dx11Upscaler', dx11),
    entry('Upscalers', 'VulkanUpscaler', vulkan),
    // Written even when false, so switching away from FSR 4 actually turns it
    // off again instead of leaving the previous run's setting behind.
    entry('FSR', 'Fsr4Update', wantsFsr4),
    entry('FSR', 'Fsr4ForceEnableInt8', wantsFsr4 && gpu && gpu.rdnaGen === 3),
    entry('Spoofing', 'Dxgi', inputs === 'dxgi-spoof'),
    entry('Spoofing', 'StreamlineSpoofing', inputs !== 'none'),
    entry('FrameGen', 'Enabled', fgEnabled),
    entry('FrameGen', 'FGInput', fgInput),
    entry('FrameGen', 'FGOutput', fgOutput),
    entry('Log', 'LogToFile', 'true'),
    entry('Log', 'LogLevel', '2'),
    entry('Log', 'LogFileName', LOG_FILE),
    entry('Plugins', 'LoadAsiPlugins', 'false'),
    // Without this the proxy also loads inside launchers and crash handlers
    // that happen to sit in the same folder.
    entry('ProcessFilter', 'TargetProcessName', path.basename((target && target.exePath) || ''))
  ];
}

// FsrAgilitySDKUpgrade is deliberately absent from the plan above. It exists
// for Windows 10 and demands that the D3D12 redistributable folder sits
// beside the executable; switching it on from here would be wrong on
// Windows 11 and a silent trap on Windows 10.
function configureAmd(text, target, gpu, options = {}) {
  let out = String(text || '');
  for (const { section, key, value } of amdPlan(target, gpu, options)) out = ini.setIni(out, section, key, value);
  return out;
}

module.exports = {
  RELEASE, CORE, FFX, XESS, FAKENVAPI, NUKEM, BINARIES, TEXT_FILES, LICENSES, SETUP_SCRIPTS,
  UPSCALER_BACKENDS, FRAME_GEN, INPUT_MODES, LOG_FILE,
  hookFor, validateUpstreamPayload, extract7z, ensureOptiScalerUpstream, copyPlan,
  amdPlan, configureAmd, resolveOptions
};
