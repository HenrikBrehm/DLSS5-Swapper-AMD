'use strict';
// Erzeugt loop/baseline-tests.json - die Abnahme-Grundlage für scripts/loop-guard.js.
// NUR vom Menschen auszuführen (z.B. nachdem eine Aufgabe akzeptiert wurde und die
// Baseline bewusst angehoben werden soll). Der Loop darf dieses Script nie starten.
// Voraussetzung: `npm test` ist grün, Arbeitsbaum ist committed.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const TEST_NAME = /(?:^|[^\w.])test\(\s*(['"`])((?:\\.|(?!\1).)+)\1/g;

function git(args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

const testDir = path.join(root, 'test');
const testFiles = fs.readdirSync(testDir).filter((f) => f.endsWith('.test.js')).sort();
const testNames = [];
for (const file of testFiles) {
  const text = fs.readFileSync(path.join(testDir, file), 'utf8');
  TEST_NAME.lastIndex = 0;
  let m;
  while ((m = TEST_NAME.exec(text))) testNames.push(`${file}::${m[2]}`);
}

const run = spawnSync('npm', ['test'], { cwd: root, encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 });
const text = `${run.stdout || ''}\n${run.stderr || ''}`;
const num = (label) => { const m = text.match(new RegExp(`^[^\\w\\n]*${label} (\\d+)\\s*$`, 'm')); return m ? Number(m[1]) : null; };
if (run.status !== 0 || num('fail') !== 0) { console.error('Baseline verweigert: npm test ist nicht grün.'); process.exit(1); }

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const baseline = {
  createdAt: new Date().toISOString(),
  headAtCreation: git(['rev-parse', 'HEAD']).trim(),
  testCount: num('tests'),
  passCount: num('pass'),
  packageTestScript: pkg.scripts.test,
  testFiles,
  testNames,
  trackedFiles: git(['ls-files']).split(/\r?\n/).filter(Boolean)
};
fs.mkdirSync(path.join(root, 'loop'), { recursive: true });
fs.writeFileSync(path.join(root, 'loop', 'baseline-tests.json'), JSON.stringify(baseline, null, 2) + '\n');
console.log(`Baseline geschrieben: ${baseline.testCount} Tests, ${testNames.length} Testnamen, ${testFiles.length} Testdateien, ${baseline.trackedFiles.length} getrackte Dateien.`);
