'use strict';
// Task 1.1: vendor-neutral GPU detection. Every external call is injected, so
// these tests never touch nvidia-smi, PowerShell, the registry or the
// DriverStore. The fixtures are real strings recorded on the reference PC
// (RX 7900 XT, Adrenalin 26.8.1) and on an RTX machine.
const test = require('node:test');
const assert = require('node:assert/strict');
const gpu = require('../src/core/gpu-detect');

const RX7900XT = { Name: 'AMD Radeon RX 7900 XT', DriverVersion: '32.0.31041.1004', PNPDeviceID: 'PCI\\VEN_1002&DEV_744C&SUBSYS_0E3D1002&REV_C8\\6&1A2B3C4D&0&00000008' };
const RX9070XT = { Name: 'AMD Radeon RX 9070 XT', DriverVersion: '32.0.21001.1001', PNPDeviceID: 'PCI\\VEN_1002&DEV_7550&SUBSYS_00001002&REV_C0\\4&1&0&0008' };
const RX6800 = { Name: 'AMD Radeon RX 6800', DriverVersion: '32.0.31041.1004', PNPDeviceID: 'PCI\\VEN_1002&DEV_73BF&SUBSYS_0E3A1002&REV_C1\\4&1&0&0008' };
const R890M = { Name: 'AMD Radeon 890M', DriverVersion: '32.0.31041.1004', PNPDeviceID: 'PCI\\VEN_1002&DEV_150E&SUBSYS_00001002&REV_C1\\3&1&0&0008' };
const RTX4090 = { Name: 'NVIDIA GeForce RTX 4090', DriverVersion: '32.0.15.6156', PNPDeviceID: 'PCI\\VEN_10DE&DEV_2684&SUBSYS_88B21043&REV_A1\\4&1&0&0019' };

const registry = (desc, adrenalin) => JSON.stringify([{ DriverDesc: desc, DriverVersion: '32.0.31041.1004', RadeonSoftwareVersion: adrenalin, ReleaseVersion: `26.10.41.01-260811a-203304C-AMD-Software-Adrenalin-Edition` }]);
const driverStore = JSON.stringify([{ FullName: 'C:\\Windows\\System32\\DriverStore\\FileRepository\\u0203304.inf_amd64_a6e5a337568ce3f0\\B026373\\amdxcffx64.dll', FileVersion: '2.3.0.3193' }]);

function deps(overrides = {}) {
  return {
    runNvidiaSmi: async () => { throw new Error('nvidia-smi.exe not found'); },
    runPowerShell: async () => JSON.stringify([]),
    readRegistry: async () => JSON.stringify([]),
    globDriverStore: async () => JSON.stringify([]),
    ...overrides
  };
}

test('RX 7900 XT on Adrenalin 26.8.1 is an FSR 4 capable RDNA3 desktop card with the driver DLL attached', async () => {
  const rows = await gpu.detect(deps({
    runPowerShell: async () => JSON.stringify(RX7900XT),
    readRegistry: async () => registry('AMD Radeon RX 7900 XT', '26.8.1'),
    globDriverStore: async () => driverStore
  }));
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.equal(row.name, 'AMD Radeon RX 7900 XT');
  assert.equal(row.vendor, 'amd');
  assert.equal(row.driver, '32.0.31041.1004');
  assert.equal(row.adrenalin, '26.8.1');
  assert.equal(row.rdnaGen, 3);
  assert.equal(row.mobile, false);
  assert.equal(row.fsr4Capable, true);
  assert.deepEqual(row.fsr4Dll, { path: 'C:\\Windows\\System32\\DriverStore\\FileRepository\\u0203304.inf_amd64_a6e5a337568ce3f0\\B026373\\amdxcffx64.dll', version: '2.3.0.3193' });
});

test('RX 7900 XT on Adrenalin 26.5.1 is not FSR 4 capable: the INT8 model arrived with 26.6.2', async () => {
  const [row] = await gpu.detect(deps({
    runPowerShell: async () => JSON.stringify([RX7900XT]),
    readRegistry: async () => registry('AMD Radeon RX 7900 XT', '26.5.1')
  }));
  assert.equal(row.adrenalin, '26.5.1');
  assert.equal(row.rdnaGen, 3);
  assert.equal(row.fsr4Capable, false);
});

test('RX 9070 XT is FSR 4 capable on any Adrenalin, even without a registry match', async () => {
  const [row] = await gpu.detect(deps({ runPowerShell: async () => JSON.stringify([RX9070XT]) }));
  assert.equal(row.vendor, 'amd');
  assert.equal(row.rdnaGen, 4);
  assert.equal(row.adrenalin, null);
  assert.equal(row.fsr4Capable, true);
});

test('RX 6800 (RDNA2) is not FSR 4 capable regardless of driver', async () => {
  const [row] = await gpu.detect(deps({
    runPowerShell: async () => JSON.stringify([RX6800]),
    readRegistry: async () => registry('AMD Radeon RX 6800', '26.8.1')
  }));
  assert.equal(row.rdnaGen, 2);
  assert.equal(row.fsr4Capable, false);
});

test('Radeon 890M is a mobile RDNA3 part and stays off the FSR 4 list', async () => {
  const [row] = await gpu.detect(deps({
    runPowerShell: async () => JSON.stringify([R890M]),
    readRegistry: async () => registry('AMD Radeon 890M', '26.8.1')
  }));
  assert.equal(row.vendor, 'amd');
  assert.equal(row.rdnaGen, 3);
  assert.equal(row.mobile, true);
  assert.equal(row.fsr4Capable, false);
});

test('an RTX 4090 seen by nvidia-smi is reported once, with the nvidia-smi driver string', async () => {
  const rows = await gpu.detect(deps({
    runNvidiaSmi: async () => 'NVIDIA GeForce RTX 4090, 616.56\n',
    runPowerShell: async () => JSON.stringify([RTX4090])
  }));
  assert.equal(rows.length, 1, 'WMI and nvidia-smi describe the same card');
  assert.equal(rows[0].vendor, 'nvidia');
  assert.equal(rows[0].driver, '616.56');
  assert.equal(rows[0].rdnaGen, null);
  assert.equal(rows[0].fsr4Capable, false);
  assert.equal(rows[0].fsr4Dll, null);
});

test('no adapter at all is an empty list, never a throw', async () => {
  const rows = await gpu.detect(deps({
    runPowerShell: async () => { throw new Error('PowerShell restricted'); },
    readRegistry: async () => { throw new Error('access denied'); },
    globDriverStore: async () => { throw new Error('no such path'); }
  }));
  assert.deepEqual(rows, []);
});

test('garbage PowerShell output does not hide the cards other sources found', async () => {
  const rows = await gpu.detect(deps({
    runNvidiaSmi: async () => 'NVIDIA GeForce RTX 5090, 616.56',
    runPowerShell: async () => 'Get-CimInstance : Access denied\r\n<html>not json</html>',
    readRegistry: async () => '{ "DriverDesc": truncated'
  }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'NVIDIA GeForce RTX 5090');
  assert.equal(rows[0].vendor, 'nvidia');
});

test('a mixed machine lists both vendors and only attaches the FSR 4 DLL to the AMD card', async () => {
  const rows = await gpu.detect(deps({
    runNvidiaSmi: async () => 'NVIDIA GeForce RTX 3060, 616.56',
    runPowerShell: async () => JSON.stringify([RX7900XT, { Name: 'NVIDIA GeForce RTX 3060', DriverVersion: '32.0.15.6156', PNPDeviceID: 'PCI\\VEN_10DE&DEV_2503' }]),
    readRegistry: async () => registry('AMD Radeon RX 7900 XT', '26.8.1'),
    globDriverStore: async () => driverStore
  }));
  assert.deepEqual(rows.map(r => r.vendor).sort(), ['amd', 'nvidia']);
  const amd = rows.find(r => r.vendor === 'amd');
  const nv = rows.find(r => r.vendor === 'nvidia');
  assert.equal(amd.fsr4Dll.version, '2.3.0.3193');
  assert.equal(nv.fsr4Dll, null);
  assert.equal(nv.driver, '616.56');
});

test('the registry row is matched to its adapter by name, ignoring case and spacing', async () => {
  const [row] = await gpu.detect(deps({
    runPowerShell: async () => JSON.stringify([RX7900XT]),
    readRegistry: async () => registry('amd radeon rx  7900 xt', '26.8.1')
  }));
  assert.equal(row.adrenalin, '26.8.1');
});

test('with several DriverStore copies the newest amdxcffx64.dll wins', async () => {
  const [row] = await gpu.detect(deps({
    runPowerShell: async () => JSON.stringify([RX7900XT]),
    globDriverStore: async () => JSON.stringify([
      { FullName: 'C:\\old\\amdxcffx64.dll', FileVersion: '2.2.0.1001' },
      { FullName: 'C:\\new\\amdxcffx64.dll', FileVersion: '2.3.0.3193' },
      { FullName: 'C:\\mid\\amdxcffx64.dll', FileVersion: '2.2.9.9999' }
    ])
  }));
  assert.equal(row.fsr4Dll.path, 'C:\\new\\amdxcffx64.dll');
});

test('rdnaGenFromName covers the desktop generations and the mobile spellings', () => {
  const cases = [
    ['AMD Radeon RX 5700 XT', 1, false], ['AMD Radeon RX 6900 XT', 2, false], ['AMD Radeon RX 7800 XT', 3, false],
    ['AMD Radeon RX 7900 XTX', 3, false], ['AMD Radeon RX 9060 XT', 4, false], ['AMD Radeon RX 7600M XT', 3, true],
    ['AMD Radeon 780M', 3, true], ['AMD Radeon 890M', 3, true], ['AMD Radeon(TM) Graphics', null, true],
    ['AMD Radeon Graphics', null, true], ['AMD Radeon RX 580', null, false], ['NVIDIA GeForce RTX 4090', null, false]
  ];
  for (const [name, gen, mobile] of cases) assert.deepEqual(gpu.rdnaGenFromName(name), { gen, mobile }, name);
});

test('compareVersions compares numerically, segment by segment, and treats junk as lower', () => {
  assert.equal(gpu.compareVersions('26.8.1', '26.6.2'), 1);
  assert.equal(gpu.compareVersions('26.6.2', '26.6.2'), 0);
  assert.equal(gpu.compareVersions('26.5.1', '26.6.2'), -1);
  assert.equal(gpu.compareVersions('26.10.1', '26.9.9'), 1, 'not a string compare');
  assert.equal(gpu.compareVersions('26.6', '26.6.0'), 0, 'missing segments are zero');
  assert.equal(gpu.compareVersions(null, '26.6.2'), -1);
  assert.equal(gpu.compareVersions('n/a', '26.6.2'), -1);
});

test('fsr4Capable is the documented rule: RDNA4 always, RDNA3 desktop from 26.6.2, nothing else', () => {
  assert.equal(gpu.fsr4Capable({ rdnaGen: 4, mobile: false, adrenalin: null }), true);
  assert.equal(gpu.fsr4Capable({ rdnaGen: 3, mobile: false, adrenalin: '26.6.2' }), true);
  assert.equal(gpu.fsr4Capable({ rdnaGen: 3, mobile: false, adrenalin: '26.6.1' }), false);
  assert.equal(gpu.fsr4Capable({ rdnaGen: 3, mobile: false, adrenalin: null }), false);
  assert.equal(gpu.fsr4Capable({ rdnaGen: 3, mobile: true, adrenalin: '26.8.1' }), false);
  assert.equal(gpu.fsr4Capable({ rdnaGen: 2, mobile: false, adrenalin: '26.8.1' }), false);
  assert.equal(gpu.fsr4Capable({ rdnaGen: null, mobile: false, adrenalin: '26.8.1' }), false);
});

test('parseNvidiaSmi reads one card per line and drops blank lines', () => {
  assert.deepEqual(gpu.parseNvidiaSmi('NVIDIA GeForce RTX 4090, 616.56\r\nNVIDIA RTX PRO 6000 Blackwell, 616.56\r\n\r\n'),
    [{ name: 'NVIDIA GeForce RTX 4090', driver: '616.56' }, { name: 'NVIDIA RTX PRO 6000 Blackwell', driver: '616.56' }]);
  assert.deepEqual(gpu.parseNvidiaSmi(''), []);
});

test('the registry query tolerates subkeys the user may not read', () => {
  // Seen on the reference PC: one unreadable subkey under the display class
  // key, and with the Stop preference the whole query answered nothing, so
  // Adrenalin 26.8.1 was read as "unknown" and FSR 4 as unavailable.
  const script = gpu.SCRIPTS.registry;
  assert.match(script, /Get-ChildItem '[^']+' -ErrorAction SilentlyContinue/);
  assert.match(script, /Get-ItemProperty \$_\.PSPath -ErrorAction SilentlyContinue/);
  assert.match(script, /RadeonSoftwareVersion/);
  assert.match(gpu.SCRIPTS.driverStore, /amdxcffx64\.dll -Recurse -ErrorAction SilentlyContinue/);
});

test('vendorOf uses the name first and the PCI vendor id as the tie-breaker', () => {
  assert.equal(gpu.vendorOf('AMD Radeon RX 7900 XT'), 'amd');
  assert.equal(gpu.vendorOf('NVIDIA GeForce RTX 4090'), 'nvidia');
  assert.equal(gpu.vendorOf('Intel(R) Arc(TM) A770 Graphics'), 'intel');
  assert.equal(gpu.vendorOf('Unknown adapter', 'PCI\\VEN_1002&DEV_744C'), 'amd');
  assert.equal(gpu.vendorOf('Unknown adapter', 'PCI\\VEN_10DE&DEV_2684'), 'nvidia');
  assert.equal(gpu.vendorOf('Unknown adapter', 'PCI\\VEN_8086&DEV_56A0'), 'intel');
  assert.equal(gpu.vendorOf('Microsoft Basic Display Adapter', 'ROOT\\BasicDisplay'), 'unknown');
});
