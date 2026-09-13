'use strict';
// What this machine would actually get, game by game.
//
// The chain was green on 517 tests while giving the wrong tier for the
// reference machine's most important game. No test caught it; running the
// real chain against the real library once did. That was a throwaway script,
// which means the next person would have had to think of it again.
//
// So it lives here instead. The judgement is a pure function over facts a
// scan already produces, and scripts/reality-check.js is the thin shell that
// gathers those facts from disk.
//
// The number it exists to print is the honest one: not how many games got an
// answer, which is all of them, but how many get real upscaling. Tier 3
// sharpens a smaller picture and cannot put back detail that was never
// rendered, so counting it as a success would make the report useless.
const { route } = require('./router');
const { UPSCALER_INPUTS } = require('./scan');

// Tier 1 replaces an upscaler the game already has; tier 2 opens the engine's
// slot and feeds the same FSR 4. Both reconstruct detail from motion vectors
// and a jittered camera. Tier 3 does not, and never will, whatever improves.
const REAL_TIERS = Object.freeze(new Set([1, 2]));

const PROBLEMS = Object.freeze({
  noExecutable: 'noExecutable',
  noRoute: 'noRoute',
  failed: 'failed'
});

function inputsOf(upscalers) {
  if (!upscalers || typeof upscalers !== 'object') return [];
  return UPSCALER_INPUTS.filter((key) => upscalers[key]);
}

function unassessed(name, dir, problem) {
  return {
    name: name || null, dir: dir || null,
    assessed: false, problem,
    exe: null, api: null, apiLabel: null, bitness: null, antiCheat: false,
    inputs: [], engine: null, engineVersion: null, upscalerSlot: false,
    tier: null, route: null, reason: null, fg: null,
    alternatives: [], engineReason: null, realUpscaling: false
  };
}

// One game's verdict. Everything it needs is passed in, so this can be tested
// without a disk and run against a recorded scan later.
function assess(input) {
  const { name = null, dir = null, scan = null, engine = null, gpu = null } = input || {};
  const target = scan && typeof scan === 'object' ? scan.chosen : null;
  if (!target || typeof target !== 'object') return unassessed(name, dir, PROBLEMS.noExecutable);

  let answer;
  try {
    answer = route(target, gpu, engine);
  } catch {
    // A router that throws is a bug, but it must not take the whole report
    // down with it - the other games still have something to say.
    return unassessed(name, dir, PROBLEMS.failed);
  }
  if (!answer || !answer.route) return unassessed(name, dir, PROBLEMS.noRoute);

  return {
    name, dir, assessed: true, problem: null,
    exe: target.path || null,
    api: target.api || null,
    apiLabel: target.apiLabel || null,
    bitness: target.bitness || null,
    antiCheat: Boolean(target.antiCheat),
    inputs: inputsOf(target.upscalers),
    engine: engine ? engine.engine || null : null,
    engineVersion: engine ? engine.version || null : null,
    upscalerSlot: Boolean(engine && engine.upscalerSlot),
    tier: answer.tier,
    route: answer.route,
    reason: answer.reason,
    fg: answer.fg,
    alternatives: answer.alternatives || [],
    engineReason: answer.engineReason,
    realUpscaling: REAL_TIERS.has(answer.tier)
  };
}

function summarise(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const byTier = { 1: 0, 2: 0, 3: 0 };
  let assessed = 0;
  let real = 0;
  for (const row of list) {
    if (!row || !row.assessed) continue;
    assessed += 1;
    if (Object.hasOwn(byTier, row.tier)) byTier[row.tier] += 1;
    if (row.realUpscaling) real += 1;
  }
  return {
    games: list.length,
    assessed,
    unassessed: list.length - assessed,
    real,
    fallback: assessed - real,
    byTier
  };
}

// English on purpose: this is a diagnostic for a terminal, not a surface of
// the application, and translating it would mean another 38 language blocks
// to keep honest for something only a maintainer reads.
const TIER_TEXT = Object.freeze({
  1: 'tier 1  FSR 4, replacing what the game ships',
  2: 'tier 2  FSR 4, through the engine upscaler slot',
  3: 'tier 3  driver and spatial only, no real upscaling'
});
const PROBLEM_TEXT = Object.freeze({
  noExecutable: 'no game executable found in this folder',
  noRoute: 'no route at all, which should not happen',
  failed: 'the router threw on this game'
});

function line(row) {
  const head = `  ${row.name || row.dir || '(unnamed)'}`;
  if (!row.assessed) return `${head}\n      ${PROBLEM_TEXT[row.problem] || row.problem}`;
  const facts = [
    row.apiLabel || row.api,
    row.engine && row.engine !== 'unknown' ? row.engine : null,
    row.inputs.length ? `ships ${row.inputs.join(', ')}` : 'ships no upscaler',
    row.antiCheat ? 'anti-cheat' : null
  ].filter(Boolean).join(' · ');
  const why = row.reason ? `\n      reason: ${row.reason}${row.engineReason ? ` · engine: ${row.engineReason}` : ''}` : '';
  return `${head}\n      ${facts}\n      ${TIER_TEXT[row.tier] || `tier ${row.tier}`} → ${row.route}${why}`;
}

function render(rows, gpu) {
  const list = Array.isArray(rows) ? rows : [];
  const total = summarise(list);
  const card = gpu && gpu.name
    ? `${gpu.name}${gpu.adrenalin ? ` · Adrenalin ${gpu.adrenalin}` : ''}${gpu.fsr4Capable ? ' · FSR 4 available' : ' · no FSR 4'}`
    : 'no graphics adapter detected';

  const out = [
    'What this machine would actually get',
    '',
    `Adapter: ${card}`,
    '',
    ...list.map(line),
    '',
    `Real upscaling: ${total.real} of ${total.games} games (tier 1: ${total.byTier[1]}, tier 2: ${total.byTier[2]}).`,
    `Fallback only: ${total.fallback}. Not assessed: ${total.unassessed}.`,
    '',
    'Tier 3 is not upscaling. It renders smaller and sharpens the result, which',
    'cannot put back detail the game never drew. Counting it as a success would',
    'make this report worthless, so it is counted separately.',
    '',
    'Nothing here has been confirmed by running a game. This says what the tool',
    'would choose, not what the result looks like.'
  ];
  return out.join('\n');
}

module.exports = { assess, summarise, render, inputsOf, REAL_TIERS, PROBLEMS, TIER_TEXT };
