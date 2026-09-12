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

module.exports = {
  RELEASE, CORE, FFX, XESS, FAKENVAPI, NUKEM, BINARIES, TEXT_FILES, LICENSES, SETUP_SCRIPTS,
  hookFor, validateUpstreamPayload, extract7z, ensureOptiScalerUpstream, copyPlan
};
