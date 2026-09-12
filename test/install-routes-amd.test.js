'use strict';
// Task 1.5: which routes a Radeon is offered. The three tiers of the tool
// are decided here, from two facts gathered earlier: what upscaling the game
// already ships (1.3) and whether its engine has a slot we can open (1.4).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { routesFor, routeMeta, ROUTE_META, routeInjects } = require('../src/shared/install-routes');
const backends = require('../src/core/backend-manager');

const AMD = { vendor: 'amd' };
const NOTHING = { dlss: false, dlssg: false, streamline: false, fsr2: false, fsr31: false, fsr31Signed: false, xess: false, any: false };
const HAS_DLSS = { ...NOTHING, dlss: true, any: true };
const HAS_FSR31 = { ...NOTHING, fsr31: true, fsr31Signed: true, any: true };
const UNREAL = { engine: 'unreal', upscalerSlot: true, projectName: 'Moria' };
const UNITY = { engine: 'unity', upscalerSlot: false, projectName: null };

const dx12 = (extra = {}) => ({ bitness: 64, api: 'dxgi', apiLabel: 'DirectX 12', upscalers: NOTHING, ...extra });

test('without a GPU argument nothing changes at all', () => {
  // Every existing caller passes two arguments. Those answers are the NVIDIA
  // product and must stay byte-identical.
  assert.deepEqual(routesFor({ bitness: 64, api: 'dxgi', apiLabel: 'DirectX 12' }), ['native', 'feeder', 'renodx']);
  assert.deepEqual(routesFor({ bitness: 64, api: 'dxgi', apiLabel: 'DirectX 11' }), ['feeder', 'renodx']);
  assert.deepEqual(routesFor({ bitness: 32, api: 'd3d8' }), ['feeder']);
  assert.deepEqual(routesFor({ bitness: 64, api: 'd3d10' }), []);
  // An explicitly non-AMD GPU is the same question again.
  assert.deepEqual(routesFor({ bitness: 64, api: 'dxgi', apiLabel: 'DirectX 12' }, 'dxgi', { vendor: 'nvidia' }),
    ['native', 'feeder', 'renodx']);
});

test('a Radeon is never offered an NVIDIA route', () => {
  const every = new Set();
  for (const target of [
    dx12({ upscalers: HAS_DLSS }), dx12({ upscalers: NOTHING, engine: UNREAL }),
    { bitness: 32, api: 'dxgi', apiLabel: 'DirectX 11', upscalers: NOTHING },
    { bitness: 64, api: 'd3d9', apiLabel: 'DirectX 9', upscalers: NOTHING },
    { bitness: 64, api: 'vulkan', apiLabel: 'Vulkan', upscalers: HAS_DLSS },
    { bitness: 64, api: 'dxgi', apiLabel: 'DirectX 12', upscalers: NOTHING, emulator: { key: 'xenia' } }
  ]) for (const route of routesFor(target, target.api, AMD)) every.add(route);

  for (const nvidiaOnly of ['native', 'feeder', 'renodx', 'optiscaler']) {
    assert.equal(every.has(nvidiaOnly), false, `${nvidiaOnly} must never reach a Radeon`);
  }
});

test('tier 1: a game that already ships an upscaler reaches FSR 4 through OptiScaler', () => {
  for (const upscalers of [HAS_DLSS, HAS_FSR31, { ...NOTHING, fsr2: true, any: true }, { ...NOTHING, xess: true, any: true }]) {
    assert.ok(routesFor(dx12({ upscalers }), 'dxgi', AMD).includes('amd-optiscaler'));
  }
  assert.ok(routesFor({ bitness: 64, api: 'vulkan', apiLabel: 'Vulkan', upscalers: HAS_DLSS }, 'vulkan', AMD).includes('amd-optiscaler'),
    'Vulkan reaches FSR 4 through the DX12 interop path');
  assert.ok(routesFor({ bitness: 64, api: 'dxgi', apiLabel: 'DirectX 11', upscalers: HAS_DLSS }, 'dxgi', AMD).includes('amd-optiscaler'),
    'DirectX 11 reaches it through D3D11on12');
});

test('tier 2: Unreal without any upscaler gets the engine route instead', () => {
  const routes = routesFor(dx12({ engine: UNREAL }), 'dxgi', AMD);
  assert.ok(routes.includes('engine-upscale'));
  assert.equal(routes.includes('amd-optiscaler'), false, 'there is no input for OptiScaler to read yet');
});

test('an engine with no slot never gets the engine route', () => {
  for (const engine of [UNITY, { engine: 'unknown', upscalerSlot: false }, null, undefined]) {
    const routes = routesFor(dx12({ engine }), 'dxgi', AMD);
    assert.equal(routes.includes('engine-upscale'), false, String(engine && engine.engine));
  }
});

test('a game that already ships an upscaler does not also get the engine route', () => {
  // Both would install OptiScaler, and tier 1 needs no engine edit. Offering
  // the engine route here would mean writing to Engine.ini for nothing.
  const routes = routesFor(dx12({ engine: UNREAL, upscalers: HAS_DLSS }), 'dxgi', AMD);
  assert.ok(routes.includes('amd-optiscaler'));
  assert.equal(routes.includes('engine-upscale'), false);
});

test('tier 3 is always there, so no game is ever left with nothing', () => {
  for (const target of [
    dx12(), dx12({ upscalers: HAS_DLSS }),
    { bitness: 32, api: 'dxgi', apiLabel: 'DirectX 11', upscalers: NOTHING },
    { bitness: 64, api: 'd3d9', apiLabel: 'DirectX 9', upscalers: NOTHING },
    { bitness: 64, api: 'opengl', apiLabel: 'OpenGL', upscalers: NOTHING },
    { bitness: 64, api: 'dxgi', apiLabel: 'DirectX 10', upscalers: NOTHING }
  ]) {
    assert.ok(routesFor(target, target.api, AMD).includes('spatial'), `${target.apiLabel} keeps the spatial fallback`);
  }
});

test('the driver route covers everything the driver can actually reach', () => {
  assert.ok(routesFor(dx12(), 'dxgi', AMD).includes('amd-driver'));
  assert.ok(routesFor({ bitness: 64, api: 'opengl', apiLabel: 'OpenGL', upscalers: NOTHING }, 'opengl', AMD).includes('amd-driver'));
  // DirectDraw and DX8 only reach modern hardware through a 32-bit wrapper,
  // and the driver has nothing to offer them.
  for (const api of ['d3d8', 'ddraw']) {
    assert.equal(routesFor({ bitness: 32, api, upscalers: NOTHING }, api, AMD).includes('amd-driver'), false, api);
  }
});

test('a 32-bit game and an emulator fall to tier 3, because OptiScaler is x64 only', () => {
  assert.deepEqual(routesFor({ bitness: 32, api: 'dxgi', apiLabel: 'DirectX 11', upscalers: HAS_DLSS }, 'dxgi', AMD),
    ['amd-driver', 'spatial']);
  assert.deepEqual(routesFor(dx12({ upscalers: HAS_DLSS, emulator: { key: 'xenia' } }), 'dxgi', AMD),
    ['amd-driver', 'spatial']);
});

test('DirectX 10 and DirectX 9 get no injected route, only the driver and spatial', () => {
  assert.deepEqual(routesFor({ bitness: 64, api: 'dxgi', apiLabel: 'DirectX 10', upscalers: HAS_DLSS, engine: UNREAL }, 'dxgi', AMD),
    ['amd-driver', 'spatial']);
  assert.deepEqual(routesFor({ bitness: 64, api: 'd3d9', apiLabel: 'DirectX 9', upscalers: HAS_DLSS, engine: UNREAL }, 'd3d9', AMD),
    ['amd-driver', 'spatial']);
});

test('a missing inventory is treated as "ships nothing", never as a crash', () => {
  const bare = { bitness: 64, api: 'dxgi', apiLabel: 'DirectX 12' };
  assert.deepEqual(routesFor(bare, 'dxgi', AMD), ['amd-driver', 'spatial']);
  assert.deepEqual(routesFor({ ...bare, engine: UNREAL }, 'dxgi', AMD), ['engine-upscale', 'amd-driver', 'spatial']);
  assert.deepEqual(routesFor(null, 'dxgi', AMD), []);
});

test('routeMeta describes every route the registry can return, and nothing else', () => {
  const seen = new Set();
  for (const target of [
    dx12({ upscalers: HAS_DLSS }), dx12({ engine: UNREAL }), dx12(),
    { bitness: 64, api: 'dxgi', apiLabel: 'DirectX 12' }
  ]) for (const route of routesFor(target, 'dxgi', AMD)) seen.add(route);
  for (const route of routesFor(dx12(), 'dxgi')) seen.add(route);

  for (const route of seen) {
    const meta = routeMeta(route);
    assert.ok(meta, `${route} has no description`);
    assert.ok(['amd', 'nvidia'].includes(meta.vendor), route);
    assert.ok([1, 2, 3].includes(meta.tier), route);
    assert.equal(typeof meta.label, 'string', route);
    assert.ok(meta.label.length > 0, route);
    assert.equal(typeof meta.needsGpu, 'boolean', route);
  }
  assert.equal(routeMeta('does-not-exist'), null);
  assert.equal(routeMeta(null), null);
});

test('the tiers in the registry match the tiers the routes are offered at', () => {
  assert.equal(ROUTE_META['amd-optiscaler'].tier, 1);
  assert.equal(ROUTE_META['engine-upscale'].tier, 2);
  assert.equal(ROUTE_META['amd-driver'].tier, 3);
  assert.equal(ROUTE_META.spatial.tier, 3);
  // The two guided routes touch no file in the game, so they need no GPU
  // capability check before they can be offered.
  assert.equal(ROUTE_META['amd-driver'].needsGpu, false);
  assert.equal(ROUTE_META.spatial.needsGpu, false);
  assert.equal(ROUTE_META['amd-optiscaler'].needsGpu, true);
});

test('the backend manager accepts every route the registry knows, and no other', (t) => {
  // A route missing from this whitelist used to fail an install with nothing
  // but "Invalid route", so it is now driven by the registry itself and
  // cannot fall out of step with it again.
  const gameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'routes-amd-'));
  t.after(() => fs.rmSync(gameDir, { recursive: true, force: true }));
  const exePath = path.join(gameDir, 'bin', 'game.exe');

  for (const route of Object.keys(ROUTE_META)) {
    const file = backends.profileFile(gameDir, exePath, 'dxgi', route);
    assert.ok(file.endsWith(`-${route}.json`), route);
  }
  for (const bogus of ['bogus', '', null, undefined, 'amd_optiscaler']) {
    assert.throws(() => backends.profileFile(gameDir, exePath, 'dxgi', bogus), /Invalid route/, String(bogus));
  }
});

test('the two OptiScaler-based routes own OptiScaler.ini, the guided ones own nothing', () => {
  const gameDir = path.join('C:', 'Games', 'X');
  const exePath = path.join(gameDir, 'bin', 'game.exe');
  const names = (route) => backends.configPaths(gameDir, exePath, route).map((file) => path.basename(file));

  for (const route of ['optiscaler', 'amd-optiscaler', 'engine-upscale']) {
    assert.deepEqual(names(route), ['OptiScaler.ini'], route);
  }
  // The guided routes write nothing into the game, so they carry no settings
  // across a backend switch and must not drag a ReShade preset along.
  for (const route of ['amd-driver', 'spatial']) assert.deepEqual(names(route), [], route);
  assert.ok(names('native').some((name) => name === 'ReShade.ini'), 'the ReShade routes are unchanged');
});

test('an Intel or unknown vendor is not silently treated as AMD', () => {
  // This takes one adapter, not the machine. On a machine with a Radeon
  // beside an RTX, install-guards answers "mixed" for the machine but
  // amdRow() hands back the Radeon itself, and that row is what belongs
  // here. Passing the machine-level verdict is a caller mistake, and it
  // must fail closed rather than guess.
  for (const vendor of ['intel', 'unknown', 'mixed']) {
    const routes = routesFor(dx12({ upscalers: HAS_DLSS }), 'dxgi', { vendor });
    assert.equal(routes.includes('amd-optiscaler'), false, vendor);
  }
});

// ---------------------------------------------------------------------------
// Task 3.3: a game with anti-cheat, on a Radeon.
// ---------------------------------------------------------------------------

test('anti-cheat on a Radeon leaves only the two routes that inject nothing', () => {
  // The driver reaches these games anyway, without a single file being put
  // beside the executable. There is simply no reason to take the risk.
  const guarded = dx12({ upscalers: HAS_DLSS, engine: UNREAL, antiCheat: true });
  assert.deepEqual(routesFor(guarded, 'dxgi', AMD), ['amd-driver', 'spatial']);
  assert.deepEqual(routesFor({ ...guarded, api: 'vulkan', apiLabel: 'Vulkan' }, 'vulkan', AMD), ['amd-driver', 'spatial']);
  assert.deepEqual(routesFor({ ...guarded, bitness: 32 }, 'dxgi', AMD), ['amd-driver', 'spatial']);
});

test('the same game without anti-cheat keeps every route it had', () => {
  const plain = dx12({ upscalers: HAS_DLSS, engine: UNREAL });
  assert.ok(routesFor(plain, 'dxgi', AMD).includes('amd-optiscaler'));
  assert.ok(routesFor({ ...plain, antiCheat: false }, 'dxgi', AMD).includes('amd-optiscaler'));
  assert.equal(routesFor({ ...plain, antiCheat: true }, 'dxgi', AMD).includes('amd-optiscaler'), false);
});

test('the NVIDIA side is not changed by this: there anti-cheat stays a decision', () => {
  // Those routes have always treated it as an acknowledged risk rather than a
  // block, and that is deliberately left alone.
  const guarded = { bitness: 64, api: 'dxgi', apiLabel: 'DirectX 12', hasNativeDlss: true, antiCheat: true };
  assert.deepEqual(routesFor(guarded), ['native', 'feeder', 'optiscaler', 'renodx']);
  assert.deepEqual(routesFor(guarded, 'dxgi', { vendor: 'nvidia' }), ['native', 'feeder', 'optiscaler', 'renodx']);
});

test('routeInjects draws the line the anti-cheat promise depends on', () => {
  for (const route of ['amd-optiscaler', 'engine-upscale', 'native', 'feeder', 'optiscaler', 'renodx']) {
    assert.equal(routeInjects(route), true, route);
  }
  for (const route of ['amd-driver', 'spatial']) assert.equal(routeInjects(route), false, route);
  assert.equal(routeInjects(null), false);
  assert.equal(routeInjects(undefined), false);
  // Every route the registry knows is on one side of the line or the other.
  for (const route of Object.keys(ROUTE_META)) assert.equal(typeof routeInjects(route), 'boolean', route);
});

test('a route that injects nothing is exactly the set tier 3 offers', () => {
  const guarded = dx12({ upscalers: HAS_DLSS, antiCheat: true });
  for (const route of routesFor(guarded, 'dxgi', AMD)) {
    assert.equal(routeInjects(route), false, `${route} must not be offered for an anti-cheat game`);
    assert.equal(routeMeta(route).tier, 3, route);
  }
});

test('main.js mirrors the route registry, and this fails the moment they drift', () => {
  // The install IPC is exercised against a stub of the routes module, so
  // main.js keeps its own copy of these two lists rather than importing a
  // newer export the fixture does not have. That copy is only safe while
  // something checks it, which is what this does.
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'main.js'), 'utf8');
  const listOf = (name) => {
    const found = new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(source);
    assert.ok(found, `${name} is not declared in main.js`);
    return found[1].split(',').map((item) => item.trim().replace(/^'|'$/g, '')).filter(Boolean).sort();
  };
  const guided = Object.keys(ROUTE_META).filter((route) => !routeInjects(route)).sort();
  const amdInjecting = Object.keys(ROUTE_META)
    .filter((route) => ROUTE_META[route].vendor === 'amd' && routeInjects(route)).sort();

  assert.deepEqual(listOf('GUIDED_ROUTES'), guided);
  assert.deepEqual(listOf('AMD_INJECTING_ROUTES'), amdInjecting);
  assert.ok(guided.length > 0 && amdInjecting.length > 0, 'and neither list is empty');
});
