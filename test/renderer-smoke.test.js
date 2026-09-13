'use strict';
// Task 6.2: proof that the interface actually runs.
//
// The AMD port changed the renderer in 24 tasks and never once opened it. Every
// other test that mentions the renderer reads it as text - it checks that a
// string appears in the file, which a broken file would also pass. So the one
// risk nobody had covered was the cheapest kind of failure there is: a call to
// something that is not there, crashing the first paint, on a build whose
// 509 tests were all green.
//
// These tests load the real file into a browser-shaped sandbox and call it.
// They cannot say whether the sheet reads well; a person still has to look at
// it once. They can say that it runs, and that the AMD additions produce the
// text they are supposed to produce, in every language the app ships.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRenderer, call, settle } = require('./fixtures/dom');
const { ROUTE_META } = require('../src/shared/install-routes');

// A Radeon game in tier 1: ships an upscaler, DirectX 12, 64-bit.
const TIER1 = Object.freeze({
  bitness: 64, api: 'dxgi', apiLabel: 'DirectX 12',
  upscalers: { any: true, dlss: true },
  amdRoutes: ['amd-optiscaler', 'amd-driver', 'spatial'],
  recommendation: { tier: 1, route: 'amd-optiscaler', reason: 'routerTier1' }
});

function optionsOf(html, selectId) {
  const block = new RegExp(`id="${selectId}">([\\s\\S]*?)</select>`).exec(html);
  if (!block) return [];
  return Array.from(block[1].matchAll(/<option value="([^"]*)"[^>]*>([^<]*)</g), (m) => [m[1], m[2]]);
}

test('the renderer loads and boots without throwing', async () => {
  // The whole point. If this ever goes red, the application does not start.
  const context = loadRenderer();
  await settle();
  assert.equal(typeof context.installOptions, 'function', 'the file was evaluated to the end');
  assert.equal(context.window.i18n.getLang(), 'en', 'and the boot sequence ran through applyLang');
});

test('a Radeon recommendation reaches the sheet as a tier and a reason', async () => {
  const context = loadRenderer();
  await settle();
  const html = call(context, 'installOptions', [{}, TIER1, 'C:/game']);

  const note = /<span class="tier-badge tier-1">([^<]*)<\/span><span>([^<]*)<\/span>/.exec(html);
  assert.ok(note, 'the tier note is rendered');
  assert.equal(note[1], 'Tier 1', 'the placeholder is filled in, not printed');
  assert.doesNotMatch(note[1], /\{\d\}/, 'no unresolved placeholder reaches a user');
  assert.match(note[2], /ships an upscaler/, 'the reason is the translated sentence, not the key');
  assert.doesNotMatch(note[2], /^router/, 'and not the lookup key either');
});

test('the AMD routes are offered under their names, in the order the router ranked them', async () => {
  const context = loadRenderer();
  await settle();
  const html = call(context, 'installOptions', [{}, TIER1, 'C:/game']);
  const offered = optionsOf(html, 'routeChoice');

  assert.deepEqual(offered.map(([value]) => value), ['amd-optiscaler', 'amd-driver', 'spatial']);
  for (const [value, label] of offered) {
    assert.ok(label.trim(), `${value} has a label`);
    assert.notEqual(label, ROUTE_META[value].label, `${value} shows its name, not its translation key`);
  }
  assert.equal(offered[0][1], 'FSR 4 via OptiScaler');
});

test('a game with no recommendation renders the sheet without one', async () => {
  // Tier 3 games, NVIDIA cards and a router that threw all arrive here. None
  // of them may take the sheet down with them.
  const context = loadRenderer();
  await settle();
  const html = call(context, 'installOptions', [{}, { bitness: 64, api: 'dxgi', apiLabel: 'DirectX 12' }, 'C:/game']);

  assert.doesNotMatch(html, /tier-badge/, 'no badge without an answer to put in it');
  assert.match(html, /id="apiChoice"/, 'the rest of the sheet is still there');
});

test('the NVIDIA route names are unchanged by the registry lookup', async () => {
  // routeLabel now asks the registry first. The four original routes have no
  // entry there, so they must still come out of the original expression.
  const context = loadRenderer();
  await settle();
  const nvidia = { bitness: 64, api: 'dxgi', apiLabel: 'DirectX 12' };
  const html = call(context, 'installOptions', [{}, nvidia, 'C:/game']);
  const offered = optionsOf(html, 'routeChoice');

  assert.ok(offered.length, 'an NVIDIA card is still offered routes');
  const byValue = Object.fromEntries(offered);
  // Pinned to what the original expression produces, so a future registry
  // entry for one of these names cannot silently rename it.
  if ('native' in byValue) assert.equal(byValue.native, 'Native DLSS (RenoDX)');
  if ('feeder' in byValue) assert.equal(byValue.feeder, 'DLSS5-Feeder (No DLSS / Incompatible DLSS)');
  for (const [value, label] of offered) assert.doesNotMatch(label, /^route[A-Z]/, `${value} is a name, not a key`);
});

test('the tier note is translated in every language the app ships', async () => {
  // 38 languages, no English fallback in the feature catalogue. A key missing
  // from one of them shows as the key itself in that language and nowhere
  // else, which is exactly the kind of thing nobody notices.
  const context = loadRenderer();
  await settle();
  const languages = context.window.i18n.LANGS.map((lang) => lang.code);
  assert.equal(languages.length, 38);

  for (const code of languages) {
    context.window.i18n.setLang(code);
    const html = call(context, 'installOptions', [{}, TIER1, 'C:/game']);
    const note = /<span class="tier-badge tier-1">([^<]*)<\/span><span>([^<]*)<\/span>/.exec(html);
    assert.ok(note, `${code}: the tier note renders`);
    assert.doesNotMatch(note[1], /\{\d\}/, `${code}: the tier number is substituted`);
    assert.match(note[1], /1/, `${code}: and the number is actually in there`);
    assert.notEqual(note[2], 'routerTier1', `${code}: the reason is translated`);
    assert.ok(note[2].length > 20, `${code}: and it is a sentence, not a word`);
  }
  context.window.i18n.setLang('en');
});

test('the sheet escapes what it puts in the page', async () => {
  // Route names and reasons come from a registry, but the emulator name and
  // the API label do not, and this is the function that writes them out.
  const context = loadRenderer();
  await settle();
  const nasty = {
    ...TIER1,
    apiLabel: '<script>alert(1)</script>',
    emulator: { name: '<img src=x onerror=1>', system: 'X', hint: 'h', key: 'other' }
  };
  const html = call(context, 'installOptions', [{}, nasty, 'C:/game']);

  assert.doesNotMatch(html, /<script>alert/, 'the API label is escaped');
  assert.doesNotMatch(html, /<img src=x/, 'and so is the emulator name');
  assert.match(html, /&lt;script&gt;/);
});

test('a Radeon game falls back to the shared module when the main process sent nothing', async () => {
  // amdRoutes only arrives on a scan that reached the router. A cached or
  // half-built payload has none, and the sheet still has to render.
  const context = loadRenderer();
  await settle();
  const stale = { bitness: 64, api: 'dxgi', apiLabel: 'DirectX 12', amdRoutes: [] };
  const html = call(context, 'installOptions', [{}, stale, 'C:/game']);

  assert.match(html, /id="apiChoice"/, 'the sheet renders');
  const offered = optionsOf(html, 'routeChoice');
  assert.ok(offered.every(([value]) => !value.startsWith('amd-')), 'and offers the shared answer');
});
