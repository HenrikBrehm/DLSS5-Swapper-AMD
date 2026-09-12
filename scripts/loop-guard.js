'use strict';
// Loop-Guard: der unabhängige, deterministische Richter für jede Loop-Iteration.
// Exit 0 = bestanden, Exit 1 = durchgefallen. Gründe werden ausgegeben.
//
// Der Loop darf diese Datei und loop/baseline-tests.json NIE ändern. Beides
// wird hier geprüft: die Dateien dürfen in der Git-Historie genau einmal
// hinzugefügt und danach nie modifiziert worden sein (git log --diff-filter=M
// muss leer sein), und im Arbeitsbaum dürfen sie nicht verändert sein.
//
// Was geprüft wird:
//   1. Guard und Baseline sind unverändert (Historie + Arbeitsbaum).
//   2. `npm test` läuft durch: fail == 0, tests >= Baseline-Anzahl.
//   3. Jeder Testname der Baseline existiert noch (kein Test gelöscht/umbenannt).
//   4. Keine Testdatei der Baseline wurde entfernt.
//   5. package.json "test"-Script unverändert.
//   6. Keine neuen Binärdateien (dll/exe/7z/zip/asi/bin/sys/msi) oder Dateien
//      > 5 MB im Git-Index, keine Datei namens nvngx*/amdxcffx*/dlssnr_on_amd*.
//   7. Niemals ein Push-Remote: origin push muss "no_push" sein.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const baselineFile = path.join(root, 'loop', 'baseline-tests.json');
const PROTECTED = ['scripts/loop-guard.js', 'loop/baseline-tests.json'];
const BINARY = /\.(dll|exe|7z|zip|asi|bin|sys|msi|dylib|so)$/i;
const FORBIDDEN_NAME = /^(nvngx|amdxcffx|dlssnr_on_amd|fakenvapi\.dll|OptiScaler\.dll)/i;
const MAX_BYTES = 5 * 1024 * 1024;
const TEST_NAME = /(?:^|[^\w.])test\(\s*(['"`])((?:\\.|(?!\1).)+)\1/g;

const failures = [];
const fail = (msg) => failures.push(msg);

function git(args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

function testNames() {
  const dir = path.join(root, 'test');
  const out = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort()) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    TEST_NAME.lastIndex = 0;
    let m;
    while ((m = TEST_NAME.exec(text))) out.push(`${file}::${m[2]}`);
  }
  return out;
}

function runTests() {
  const r = spawnSync('npm', ['test'], { cwd: root, encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 });
  const text = `${r.stdout || ''}\n${r.stderr || ''}`;
  const num = (label) => {
    const m = text.match(new RegExp(`^[^\\w\\n]*${label} (\\d+)\\s*$`, 'm'));
    return m ? Number(m[1]) : null;
  };
  return { status: r.status, tests: num('tests'), pass: num('pass'), fail: num('fail'), tail: text.split('\n').slice(-30).join('\n') };
}

function main() {
  if (!fs.existsSync(baselineFile)) { console.error('GUARD: loop/baseline-tests.json fehlt - erst `node scripts/loop-baseline.js` (nur Mensch).'); process.exit(1); }
  const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));

  // 1. Guard/Baseline unverändert
  for (const rel of PROTECTED) {
    const modified = git(['log', '--format=%H', '--diff-filter=M', '--', rel]).trim();
    if (modified) fail(`geschützte Datei wurde in der Historie geändert: ${rel} (${modified.split('\n').length} Commit(s))`);
    const dirty = git(['status', '--porcelain', '--', rel]).trim();
    if (dirty) fail(`geschützte Datei im Arbeitsbaum verändert: ${rel}`);
  }

  // 7. Kein Push möglich
  const push = spawnSync('git', ['remote', 'get-url', '--push', 'origin'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  if (push !== 'no_push') fail(`origin push-URL ist "${push}", muss "no_push" sein`);

  // 5. Test-Script unverändert
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (pkg.scripts.test !== baseline.packageTestScript) fail(`package.json scripts.test geändert: "${pkg.scripts.test}"`);

  // 4. Testdateien vorhanden
  for (const file of baseline.testFiles) {
    if (!fs.existsSync(path.join(root, 'test', file))) fail(`Testdatei entfernt: test/${file}`);
  }

  // 3. Testnamen vorhanden
  const current = new Set(testNames());
  const missing = baseline.testNames.filter((name) => !current.has(name));
  if (missing.length) fail(`${missing.length} Baseline-Test(s) fehlen, z.B.: ${missing.slice(0, 5).join(' | ')}`);

  // 6. Binärdateien / verbotene Namen / Größe
  const tracked = git(['ls-files']).split(/\r?\n/).filter(Boolean);
  const known = new Set(baseline.trackedFiles);
  for (const rel of tracked) {
    const base = path.basename(rel);
    if (FORBIDDEN_NAME.test(base)) fail(`verbotene Datei im Index: ${rel}`);
    if (known.has(rel)) continue;
    if (BINARY.test(rel)) fail(`neue Binärdatei im Index: ${rel}`);
    try { if (fs.statSync(path.join(root, rel)).size > MAX_BYTES) fail(`neue Datei > 5 MB im Index: ${rel}`); } catch { /* gelöscht, egal */ }
  }

  // 2. Tests
  const t = runTests();
  if (t.status !== 0 || t.fail !== 0) fail(`npm test fehlgeschlagen (exit ${t.status}, fail=${t.fail})\n${t.tail}`);
  if (t.tests === null || t.tests < baseline.testCount) fail(`Testanzahl ${t.tests} < Baseline ${baseline.testCount}`);

  const summary = { ok: failures.length === 0, tests: t.tests, pass: t.pass, fail: t.fail, baselineTests: baseline.testCount, failures };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.ok ? 0 : 1);
}

main();
