'use strict';
// Vendor-neutral GPU detection (task 1.1 of the AMD port).
//
// install-guards.js only ever asked nvidia-smi, so an AMD machine answered
// "no GPU". This module asks every source that exists on a Windows box and
// merges the answers into one row per adapter:
//
//   nvidia-smi        name + the driver string NVIDIA's tooling knows (616.56)
//   Win32_VideoController  every adapter, WDDM driver version, PCI vendor id
//   display class registry  RadeonSoftwareVersion = the Adrenalin release (26.8.1)
//   DriverStore       amdxcffx64.dll = the FSR 4 model the driver ships
//
// Every external call is injectable and every parser is a pure function, so
// the rules can be tested without a GPU. Nothing here throws: a source that
// fails simply contributes nothing.
const path = require('path');
const { execFile } = require('child_process');

const DISPLAY_CLASS = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}';
// Adrenalin 26.6.2 (June 2026) brought the INT8 FSR 4.1 model to RDNA3
// desktop cards. RDNA4 has run FSR 4 since launch. RDNA2 is promised for
// 2027 and mobile RDNA3/3.5 parts are still waiting for lighter models.
const FSR4_RDNA3_ADRENALIN = '26.6.2';

function run(file, args) {
  return new Promise((resolve, reject) => execFile(file, args, { windowsHide: true, timeout: 20000, maxBuffer: 4 * 1024 * 1024 },
    (error, stdout) => error ? reject(error) : resolve(stdout)));
}
const powershell = () => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const ps = (script) => run(powershell(), ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='Stop'; ${script}`]);

// The PowerShell side, kept as plain strings so a test can hold them to the
// one rule that bit on the reference PC: the display class key contains
// subkeys a normal user may not read ("Requested registry access is not
// allowed"), and under the Stop preference that single subkey emptied the
// whole answer. Both registry cmdlets therefore continue silently.
const SCRIPTS = Object.freeze({
  videoControllers: '@(Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,PNPDeviceID) | ConvertTo-Json -Compress',
  registry: `@(Get-ChildItem '${DISPLAY_CLASS}' -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -match '^\\d{4}$' } | ForEach-Object { Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue } | Select-Object DriverDesc,DriverVersion,RadeonSoftwareVersion,ReleaseVersion) | ConvertTo-Json -Compress`,
  driverStore: "@(Get-ChildItem (Join-Path $env:SystemRoot 'System32\\DriverStore\\FileRepository') -Filter amdxcffx64.dll -Recurse -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ FullName = $_.FullName; FileVersion = $_.VersionInfo.FileVersion } }) | ConvertTo-Json -Compress"
});
const defaults = {
  runNvidiaSmi: () => run('nvidia-smi.exe', ['--query-gpu=name,driver_version', '--format=csv,noheader']),
  runPowerShell: () => ps(SCRIPTS.videoControllers),
  readRegistry: () => ps(SCRIPTS.registry),
  globDriverStore: () => ps(SCRIPTS.driverStore)
};

function parseJsonList(text) {
  try {
    const value = JSON.parse(String(text || '').trim());
    if (Array.isArray(value)) return value.filter(item => item && typeof item === 'object');
    return value && typeof value === 'object' ? [value] : [];
  } catch { return []; }
}
const str = (value) => (typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim());
const key = (name) => str(name).toLowerCase().replace(/\s+/g, ' ');

function parseNvidiaSmi(text) {
  return String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const [name, driver] = line.split(',').map(s => s.trim());
    return { name, driver: driver || null };
  });
}
function parseVideoControllers(text) {
  return parseJsonList(text).map(row => ({ name: str(row.Name), driver: str(row.DriverVersion) || null, pnp: str(row.PNPDeviceID) })).filter(row => row.name);
}
function parseRegistryRows(text) {
  return parseJsonList(text).map(row => ({
    name: str(row.DriverDesc), driver: str(row.DriverVersion) || null,
    adrenalin: str(row.RadeonSoftwareVersion) || null, release: str(row.ReleaseVersion) || null
  })).filter(row => row.name);
}
function parseDriverStore(text) {
  const copies = parseJsonList(text).map(row => ({ path: str(row.FullName), version: str(row.FileVersion) || null })).filter(row => row.path);
  return copies.reduce((best, copy) => (!best || compareVersions(copy.version, best.version) > 0 ? copy : best), null);
}

function vendorOf(name, pnp = '') {
  const text = str(name);
  if (/nvidia|geforce|quadro|\b[gr]tx\b/i.test(text)) return 'nvidia';
  if (/\bamd\b|radeon/i.test(text)) return 'amd';
  if (/\bintel\b|\barc\b/i.test(text)) return 'intel';
  const ven = /VEN_([0-9A-F]{4})/i.exec(str(pnp));
  return ven ? ({ '10DE': 'nvidia', '1002': 'amd', '8086': 'intel' }[ven[1].toUpperCase()] || 'unknown') : 'unknown';
}

// { gen, mobile }: the RDNA generation read off the marketing name. Only
// Radeon parts get a generation; mobile is anything with an M suffix on the
// model number (7600M, 780M, 890M) or the nameless "Radeon(TM) Graphics" of
// an APU. RX 5xx and older are pre-RDNA and get null.
function rdnaGenFromName(name) {
  const text = str(name);
  if (!/radeon/i.test(text)) return { gen: null, mobile: false };
  const rx = /\bRX\s*([5679])\d{3}(M?)\b/i.exec(text);
  if (rx) return { gen: { 5: 1, 6: 2, 7: 3, 9: 4 }[rx[1]], mobile: rx[2].toUpperCase() === 'M' };
  if (/\bRadeon\s*[78]\d{2}M\b/i.test(text)) return { gen: 3, mobile: true };
  if (/\bRadeon\s*(?:\(TM\)\s*)?Graphics\b/i.test(text)) return { gen: null, mobile: true };
  return { gen: null, mobile: false };
}

function compareVersions(a, b) {
  const parse = (value) => {
    const parts = str(value).split('.').map(part => parseInt(part, 10));
    return parts.length && parts.every(Number.isFinite) ? parts : null;
  };
  const left = parse(a);
  const right = parse(b);
  if (!left) return -1;
  if (!right) return 1;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function fsr4Capable({ rdnaGen, mobile, adrenalin }) {
  if (rdnaGen >= 4) return true;
  return rdnaGen === 3 && !mobile && compareVersions(adrenalin, FSR4_RDNA3_ADRENALIN) >= 0;
}

async function attempt(call) { try { return await call(); } catch { return ''; } }

async function detect(deps = {}) {
  const io = { ...defaults, ...deps };
  const [smi, wmi, reg, store] = await Promise.all([
    attempt(io.runNvidiaSmi), attempt(io.runPowerShell), attempt(io.readRegistry), attempt(io.globDriverStore)
  ]);
  const rows = new Map();
  for (const card of parseNvidiaSmi(smi)) rows.set(key(card.name), { name: card.name, driver: card.driver, pnp: '', smi: true });
  for (const card of parseVideoControllers(wmi)) {
    const existing = rows.get(key(card.name));
    // nvidia-smi's "616.56" is the number people and this app reason about;
    // the WDDM "32.0.15.6156" only fills in when nothing better exists.
    if (existing) existing.pnp = existing.pnp || card.pnp;
    else rows.set(key(card.name), { name: card.name, driver: card.driver, pnp: card.pnp, smi: false });
  }
  const registry = parseRegistryRows(reg);
  const fsr4Dll = parseDriverStore(store);
  return Array.from(rows.values()).map(row => {
    const vendor = vendorOf(row.name, row.pnp);
    const { gen, mobile } = vendor === 'amd' ? rdnaGenFromName(row.name) : { gen: null, mobile: false };
    const match = vendor === 'amd' ? registry.find(r => key(r.name) === key(row.name)) || null : null;
    const adrenalin = match ? match.adrenalin : null;
    return {
      name: row.name, vendor, driver: row.driver || (match && match.driver) || null, adrenalin,
      rdnaGen: gen, mobile, fsr4Capable: vendor === 'amd' && fsr4Capable({ rdnaGen: gen, mobile, adrenalin }),
      fsr4Dll: vendor === 'amd' ? fsr4Dll : null
    };
  });
}

module.exports = { detect, defaults, SCRIPTS, parseNvidiaSmi, parseVideoControllers, parseRegistryRows, parseDriverStore, vendorOf, rdnaGenFromName, compareVersions, fsr4Capable, FSR4_RDNA3_ADRENALIN };
