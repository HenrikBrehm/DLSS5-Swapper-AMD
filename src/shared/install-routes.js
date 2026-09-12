'use strict';

// Keep the sheet and installer on the same compatibility policy. A copied
// nvngx DLL alone does not prove that the game has native NGX calls.
(function (root) {
  function nativeDlssPresent(scan) {
    const file = scan.primaryDlss;
    if (!file) return false;
    const rel = file.rel.replace(/\\/g, '/').toLowerCase();
    return !((scan.install && scan.install.added) || []).some(item => item.replace(/\\/g, '/').toLowerCase() === rel);
  }
  function optiReason(target, api = target && target.api) {
    if (!target || target.bitness !== 64 || target.emulator) return 'optiUnsupported';
    if (!['dxgi', 'vulkan'].includes(api) || target.apiLabel === 'DirectX 10') return 'optiUnsupported';
    if (!target.hasNativeDlss) return 'optiNeedsDlss';
    return null;
  }
  // Every route this application can install or guide, with the tier it
  // belongs to. `label` is an i18n key rather than text, so the sheet and the
  // dialogs stay translatable in all 38 languages.
  //
  // `needsGpu` says whether the route depends on what the card can do. The
  // two guided routes touch no file in the game and are offered to anyone.
  const ROUTE_META = Object.freeze({
    native: Object.freeze({ vendor: 'nvidia', tier: 1, label: 'routeNative', needsGpu: true }),
    feeder: Object.freeze({ vendor: 'nvidia', tier: 2, label: 'routeFeeder', needsGpu: true }),
    optiscaler: Object.freeze({ vendor: 'nvidia', tier: 1, label: 'routeOptiscaler', needsGpu: true }),
    renodx: Object.freeze({ vendor: 'nvidia', tier: 2, label: 'routeRenodx', needsGpu: true }),
    'amd-optiscaler': Object.freeze({ vendor: 'amd', tier: 1, label: 'routeAmdOptiscaler', needsGpu: true }),
    'engine-upscale': Object.freeze({ vendor: 'amd', tier: 2, label: 'routeEngineUpscale', needsGpu: true }),
    'amd-driver': Object.freeze({ vendor: 'amd', tier: 3, label: 'routeAmdDriver', needsGpu: false }),
    spatial: Object.freeze({ vendor: 'amd', tier: 3, label: 'routeSpatial', needsGpu: false })
  });
  function routeMeta(route) { return (route && ROUTE_META[route]) || null; }

  // The two guided routes copy nothing into the game and change no file
  // beside its executable. Everything else puts a proxy DLL there.
  //
  // This distinction is what makes an honest answer possible for a game with
  // anti-cheat: there is nothing for the anti-cheat system to see, so there
  // is nothing to warn about and nothing to risk.
  const GUIDED = Object.freeze(['amd-driver', 'spatial']);
  function routeInjects(route) { return Boolean(route) && !GUIDED.includes(route); }

  // OptiScaler is a 64-bit proxy DLL that hooks DXGI or Vulkan. Anything
  // outside that cannot take either of the two injected AMD routes, whatever
  // else the game offers.
  function optiScalerReachable(target, api) {
    return target.bitness === 64 && !target.emulator &&
      ['dxgi', 'vulkan'].includes(api) && target.apiLabel !== 'DirectX 10';
  }

  // The three tiers, in order of how good the result is.
  //
  // Tier 1 needs an input OptiScaler can read. Tier 2 is for a game that has
  // none but runs on an engine whose temporal pass we can claim - today only
  // Unreal, and only when there is no input already, because a game in tier 1
  // has nothing to gain from editing its Engine.ini. Tier 3 is the driver and
  // the spatial fallback, and it is always present so that no game is ever
  // left with nothing at all.
  function amdRoutesFor(target, api) {
    const routes = [];
    const upscalers = target.upscalers || {};
    const engine = target.engine || null;
    // A game with anti-cheat gets the guided routes and nothing else. The
    // NVIDIA routes treat anti-cheat as an acknowledged risk rather than a
    // block, and that stays as it is; here there is simply no need to take
    // the risk at all, because the driver reaches these games anyway without
    // a single file being placed beside the executable.
    if (target.antiCheat) return ['amd-driver', 'spatial'];
    if (optiScalerReachable(target, api)) {
      if (upscalers.any) routes.push('amd-optiscaler');
      else if (engine && engine.upscalerSlot) routes.push('engine-upscale');
    }
    // DirectDraw and DX8 reach the card only through a 32-bit wrapper, and
    // the driver's own upscaling and frame generation never see them.
    if (!['d3d8', 'ddraw'].includes(api)) routes.push('amd-driver');
    routes.push('spatial');
    return routes;
  }

  // `gpu` describes one adapter, not the machine: on a mixed machine the
  // caller passes the Radeon row itself. Called with two arguments, as every
  // existing caller does, the answer is unchanged.
  function routesFor(target, api = target && target.api, gpu = null) {
    if (!target || ![32, 64].includes(target.bitness)) return [];
    if (gpu && gpu.vendor === 'amd') return amdRoutesFor(target, api);
    if (api === 'd3d10' || (api === 'dxgi' && target.apiLabel === 'DirectX 10')) return [];
    // DirectDraw and DX8 both reach modern hardware only through dgVoodoo's
    // 32-bit wrapper, so the Feeder route is the only one either can take.
    if (api === 'd3d8' || api === 'ddraw') return target.bitness === 32 ? ['feeder'] : [];
    if (['d3d9', 'opengl', 'vulkan'].includes(api)) {
      const list = !optiReason(target, api) ? ['feeder', 'optiscaler'] : ['feeder'];
      // The DLSS Tool presents on D3D9 itself - "D3D9 and D3D11 use a
      // same-adapter, device-only D3D12 endpoint" - so it does not need
      // dgVoodoo's translation the way the Feeder route does here. OpenGL and
      // Vulkan are not on its list, and the add-on is 64-bit only.
      if (api === 'd3d9' && target.bitness === 64 && !target.emulator) list.push('renodx');
      return list;
    }
    if (api !== 'dxgi') return [];
    const routes = target.bitness === 32 || target.emulator || target.apiLabel !== 'DirectX 12' ? ['feeder'] : ['native', 'feeder'];
    if (!optiReason(target, api)) routes.push('optiscaler');
    // #251. The DLSS Tool hooks Present, and its own description says what that
    // covers: "Present supports D3D9, D3D11, and D3D12 presentation. D3D9 and
    // D3D11 use a same-adapter, device-only D3D12 endpoint." So DX11 is offered
    // too - it is the larger half of the games with no DLSS of their own, and
    // the reason this route exists. D3D9 goes through dgVoodoo here and is a
    // separate question. 32-bit is out: the add-on is 64-bit only.
    if (target.bitness === 64 && !target.emulator) routes.push('renodx');
    return routes;
  }
  function recommendedRoute(scan, target = scan.chosen) {
    const routes = routesFor(target);
    const nativeDlss = nativeDlssPresent(scan);
    const wanted = scan.install && scan.install.route === 'feeder'
      ? 'feeder' : nativeDlss ? 'native' : 'feeder';
    return routes.includes(wanted) ? wanted : (routes[0] || null);
  }
  const api = { routesFor, recommendedRoute, nativeDlssPresent, optiReason, routeMeta, ROUTE_META, amdRoutesFor, routeInjects, GUIDED };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.installRoutes = api;
})(typeof window !== 'undefined' ? window : globalThis);
