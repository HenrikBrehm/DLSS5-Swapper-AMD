'use strict';
// Task 1.2: install-guards asks gpu-detect instead of nvidia-smi alone.
// The point of the change is that an AMD machine used to answer "no GPU",
// because nvidia-smi.exe does not exist there. Every probe is injected, so
// nothing here touches the real machine.
const test = require('node:test');
const assert = require('node:assert/strict');
const guards = require('../src/core/install-guards');

const RX7900XT = { Name: 'AMD Radeon RX 7900 XT', DriverVersion: '32.0.31041.1004', PNPDeviceID: 'PCI\\VEN_1002&DEV_744C' };
const RX6800 = { Name: 'AMD Radeon RX 6800', DriverVersion: '32.0.31041.1004', PNPDeviceID: 'PCI\\VEN_1002&DEV_73BF' };
const ARC770 = { Name: 'Intel(R) Arc(TM) A770 Graphics', DriverVersion: '32.0.101.5534', PNPDeviceID: 'PCI\\VEN_8086&DEV_56A0' };
const registry = (desc, adrenalin) => JSON.stringify([{ DriverDesc: desc, DriverVersion: '32.0.31041.1004', RadeonSoftwareVersion: adrenalin }]);

function deps(overrides = {}) {
  return {
    runNvidiaSmi: async () => { throw new Error('nvidia-smi.exe not found'); },
    runPowerShell: async () => JSON.stringify([]),
    readRegistry: async () => JSON.stringify([]),
    globDriverStore: async () => JSON.stringify([]),
    ...overrides
  };
}

test('an AMD machine finally answers with its card instead of nothing', async () => {
  const rows = await guards.gpuInfo(deps({
    runPowerShell: async () => JSON.stringify([RX7900XT]),
    readRegistry: async () => registry('AMD Radeon RX 7900 XT', '26.8.1')
  }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].vendor, 'amd');
  assert.equal(rows[0].adrenalin, '26.8.1');
  assert.equal(rows[0].fsr4Capable, true);
  // driverNames feeds dialogs and the diagnostics bundle; it must still read.
  assert.equal(guards.driverNames(rows), 'AMD Radeon RX 7900 XT - 32.0.31041.1004');
});

test('an NVIDIA row keeps the exact shape the existing checks depend on', async () => {
  const rows = await guards.gpuInfo(deps({ runNvidiaSmi: async () => 'NVIDIA GeForce RTX 5090, 616.56' }));
  assert.equal(rows[0].name, 'NVIDIA GeForce RTX 5090');
  assert.equal(rows[0].driver, '616.56', 'the nvidia-smi number, not the WDDM one');
  assert.equal(guards.gpuModelSupported(rows), true);
  assert.equal(guards.driverSupported(rows), true);
  assert.equal(guards.gpuSupported(rows), true);
  assert.equal(guards.driverNeuralFault(rows), false);
  assert.equal(guards.driverNames(rows), 'NVIDIA GeForce RTX 5090 - 616.56');
});

test('no detectable adapter still reads as null, the way every caller already expects', async () => {
  assert.equal(await guards.gpuInfo(deps()), null);
  assert.equal(await guards.gpuInfo(deps({
    runPowerShell: async () => { throw new Error('PowerShell restricted'); },
    readRegistry: async () => { throw new Error('access denied'); }
  })), null);
});

test('the neural-rendering driver warning stays an NVIDIA question', async () => {
  // An AMD driver version is a four-part WDDM number whose first field is far
  // above the NVIDIA threshold. Only the vendor check keeps this quiet, so it
  // is worth pinning: a Radeon must never be warned about NVIDIA's NGX bug.
  const rows = await guards.gpuInfo(deps({
    runPowerShell: async () => JSON.stringify([{ ...RX7900XT, DriverVersion: '9999.99.1.0' }])
  }));
  assert.equal(rows[0].vendor, 'amd');
  assert.equal(guards.driverNeuralFault(rows), false);
  assert.equal(guards.driverNeuralFault([{ name: 'NVIDIA GeForce RTX 4090', driver: '616.92' }]), true);
});

test('vendorOf names the single vendor, or says mixed when there are several', async () => {
  const amd = await guards.gpuInfo(deps({ runPowerShell: async () => JSON.stringify([RX7900XT]) }));
  const intel = await guards.gpuInfo(deps({ runPowerShell: async () => JSON.stringify([ARC770]) }));
  const nvidia = await guards.gpuInfo(deps({ runNvidiaSmi: async () => 'NVIDIA GeForce RTX 4090, 616.56' }));
  const mixed = await guards.gpuInfo(deps({
    runNvidiaSmi: async () => 'NVIDIA GeForce RTX 3060, 616.56',
    runPowerShell: async () => JSON.stringify([RX7900XT, { Name: 'NVIDIA GeForce RTX 3060', DriverVersion: '32.0.15.6156', PNPDeviceID: 'PCI\\VEN_10DE&DEV_2503' }])
  }));
  assert.equal(guards.vendorOf(amd), 'amd');
  assert.equal(guards.vendorOf(intel), 'intel');
  assert.equal(guards.vendorOf(nvidia), 'nvidia');
  assert.equal(guards.vendorOf(mixed), 'mixed');
  assert.equal(guards.vendorOf(null), 'unknown');
  assert.equal(guards.vendorOf([]), 'unknown');
  // Rows written by hand elsewhere in the test suite carry no vendor field.
  assert.equal(guards.vendorOf([{ name: 'NVIDIA GeForce RTX 5090', driver: '616.56' }]), 'unknown');
});

test('amdRow picks the Radeon out of a mixed machine, or nothing', async () => {
  const mixed = await guards.gpuInfo(deps({
    runNvidiaSmi: async () => 'NVIDIA GeForce RTX 3060, 616.56',
    runPowerShell: async () => JSON.stringify([{ Name: 'NVIDIA GeForce RTX 3060', DriverVersion: '32.0.15.6156', PNPDeviceID: 'PCI\\VEN_10DE&DEV_2503' }, RX7900XT]),
    readRegistry: async () => registry('AMD Radeon RX 7900 XT', '26.8.1')
  }));
  assert.equal(guards.amdRow(mixed).name, 'AMD Radeon RX 7900 XT');
  assert.equal(guards.amdRow(await guards.gpuInfo(deps({ runNvidiaSmi: async () => 'NVIDIA GeForce RTX 4090, 616.56' }))), null);
  assert.equal(guards.amdRow(null), null);
  assert.equal(guards.amdRow([]), null);
});

test('amdFsr4Ready follows the card and the Adrenalin version, not wishful thinking', async () => {
  const ready = await guards.gpuInfo(deps({
    runPowerShell: async () => JSON.stringify([RX7900XT]),
    readRegistry: async () => registry('AMD Radeon RX 7900 XT', '26.8.1')
  }));
  const tooOld = await guards.gpuInfo(deps({
    runPowerShell: async () => JSON.stringify([RX7900XT]),
    readRegistry: async () => registry('AMD Radeon RX 7900 XT', '26.5.1')
  }));
  const rdna2 = await guards.gpuInfo(deps({
    runPowerShell: async () => JSON.stringify([RX6800]),
    readRegistry: async () => registry('AMD Radeon RX 6800', '26.8.1')
  }));
  const nvidia = await guards.gpuInfo(deps({ runNvidiaSmi: async () => 'NVIDIA GeForce RTX 5090, 616.56' }));
  assert.equal(guards.amdFsr4Ready(ready), true);
  assert.equal(guards.amdFsr4Ready(tooOld), false, 'FSR 4.1 for RDNA3 arrived with Adrenalin 26.6.2');
  assert.equal(guards.amdFsr4Ready(rdna2), false, 'RDNA2 is promised for 2027');
  assert.equal(guards.amdFsr4Ready(nvidia), false);
  assert.equal(guards.amdFsr4Ready(null), false);
});

test('a mixed machine still reports the Radeon as FSR 4 ready', async () => {
  // The AMD routes care whether a Radeon is present and capable, not whether
  // it is the only card. A laptop with a Radeon and an RTX must not lose its
  // FSR 4 option just because vendorOf says "mixed".
  const mixed = await guards.gpuInfo(deps({
    runNvidiaSmi: async () => 'NVIDIA GeForce RTX 3060, 616.56',
    runPowerShell: async () => JSON.stringify([RX7900XT, { Name: 'NVIDIA GeForce RTX 3060', DriverVersion: '32.0.15.6156', PNPDeviceID: 'PCI\\VEN_10DE&DEV_2503' }]),
    readRegistry: async () => registry('AMD Radeon RX 7900 XT', '26.8.1')
  }));
  assert.equal(guards.vendorOf(mixed), 'mixed');
  assert.equal(guards.amdFsr4Ready(mixed), true);
});
