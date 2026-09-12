'use strict';
// Did the install actually do anything?
//
// This is the step the reports kept asking for. An install can copy every
// file correctly, report success, and still change nothing in the game -
// because the proxy was never loaded, because the card refused the model, or
// because the game shipped its upscaler under a name OptiScaler did not
// recognise. Until now the only way to find out was to look at the picture
// and guess.
//
// OptiScaler writes a log beside the executable once the game has run, and
// that log says which upscaler was actually selected. Reading it turns "it
// installed" into "it is running", which is a different and far more useful
// statement.
//
// A caveat that belongs in the open: the patterns below are a hypothesis.
// They were written from OptiScaler's documented vocabulary rather than from
// a log this application has seen, because no game has been run with it yet.
// Task H6 replaces the synthetic fixture with a real log and confirms or
// corrects them. They are therefore deliberately loose - substrings, case
// insensitive, no line shape assumed - so a format that differs in spacing
// or prefix still reads correctly.
const fs = require('fs');
const path = require('path');

const LOG_NAME = 'OptiScaler.log';
// Ordered: the first match wins, and the more specific name is asked first
// so "FSR 4" is never reported as plain FSR 3.1.
const UPSCALERS = Object.freeze([
  ['fsr4', /\bfsr\s*-?\s*4(?:\.\d+)*\b/i],
  ['fsr31', /\bfsr\s*-?\s*3(?:\.\d+)*\b/i],
  ['fsr2', /\bfsr\s*-?\s*2(?:\.\d+)*\b/i],
  ['xess', /\bxess\b/i],
  ['dlss', /\bdlss\b/i]
]);
const FRAME_GEN = Object.freeze([
  ['nukems', /\bnukems?\b/i],
  ['xefg', /\bxefg\b/i],
  ['fsrfg', /\bfsr\s*-?\s*fg\b|\bfsrfg\b/i]
]);
const INT8 = /\bint8\b/i;
// spdlog writes its level in brackets; a bare "ERROR:" is covered too.
const ERROR_LINE = /\[(?:error|critical)\]|(?:^|\s)(?:error|failed|failure)\b/i;
// Lines that merely name the word "error" while saying nothing went wrong.
const NOT_AN_ERROR = /error\s*(?:code)?\s*[:=]?\s*0\b|no\s+error|errors?\s*:\s*none/i;

function parseOptiScalerLog(text) {
  const lines = String(text || '').split(/\r?\n/);
  const body = lines.join('\n');
  const found = { upscaler: null, fsr4: false, int8: false, fg: null, errors: [] };
  if (!body.trim()) return found;

  // The selected upscaler is read from the whole log rather than one line,
  // because the name appears in the selection line and again in the init
  // line, and either may be the one a given build writes.
  for (const [name, pattern] of UPSCALERS) {
    if (pattern.test(body)) { found.upscaler = name; break; }
  }
  found.fsr4 = found.upscaler === 'fsr4';
  found.int8 = found.fsr4 && INT8.test(body);
  for (const [name, pattern] of FRAME_GEN) {
    if (pattern.test(body)) { found.fg = name; break; }
  }
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !ERROR_LINE.test(trimmed) || NOT_AN_ERROR.test(trimmed)) continue;
    if (found.errors.length < 20) found.errors.push(trimmed);
  }
  return found;
}

function logPathFor(exePath) { return path.join(path.dirname(exePath), LOG_NAME); }

// 'no-log' is not a failure. It is the normal answer before the game has been
// started once, and the interface has to say so rather than showing a red
// mark at somebody who has done nothing wrong yet.
function verifyInstall(gameDir, exePath, route, deps = {}) {
  const readFile = deps.readFile || ((file) => fs.readFileSync(file, 'utf8'));
  const exists = deps.exists || ((file) => fs.existsSync(file));
  const file = logPathFor(exePath);
  if (!exists(file)) return { state: 'no-log', details: { file, route } };

  let text = '';
  try { text = readFile(file); } catch { return { state: 'no-log', details: { file, route, unreadable: true } }; }

  const parsed = parseOptiScalerLog(text);
  const details = { file, route, ...parsed };
  // An upscaler was selected: whatever else the log complains about, the
  // thing the person installed is running.
  if (parsed.upscaler) return { state: 'ok', details };
  return { state: 'failed', details };
}

module.exports = { parseOptiScalerLog, verifyInstall, logPathFor, LOG_NAME, UPSCALERS, FRAME_GEN };
