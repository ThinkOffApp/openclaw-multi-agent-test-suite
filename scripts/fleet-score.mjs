#!/usr/bin/env node
// Phase-2 fleet scorer: run one OpenClaw agent through every OMATS scenario
// (stages 3-5) via the family gateway, score each run, and aggregate into a
// per-agent run summary. Designed to run in the background (2h+ for the fleet).
//
//   node scripts/fleet-score.mjs --agent ether --model "GPT-5.5" --vendor OpenAI
//
// Writes:
//   runs/fleet/<agent>/scores/<scenario>-score.json   (per-scenario scores)
//   runs/fleet/<agent>/summary.json                    (aggregated run summary)
//   runs/fleet/<agent>/leaderboard-row.json            (name/vendor/score/s3/s4/s5)
//
// Resumable: skips scenarios that already have a score file. Errors on a single
// scenario are logged and skipped (recorded as an error, not a capability fail),
// so one flaky gateway call doesn't abort the whole run.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : def;
}
const agent = arg('agent');
const modelName = arg('model', agent);
const vendor = arg('vendor', '');
const sshHost = arg('ssh-host', 'family@localhost');
const timeout = arg('timeout', '120');
if (!agent) { console.error('need --agent'); process.exit(1); }

const outDir = path.join(ROOT, 'runs', 'fleet', agent);
const scoresDir = path.join(outDir, 'scores');
fs.mkdirSync(scoresDir, { recursive: true });

// Discover scenarios in stages 3-5 (dirs with metadata.json).
const scenarios = [];
for (const stage of ['stage3', 'stage4', 'stage5']) {
  const dir = path.join(ROOT, 'scenarios', stage);
  if (!fs.existsSync(dir)) continue;
  for (const name of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'metadata.json'))) {
      scenarios.push({ stage, name, rel: path.join('scenarios', stage, name) });
    }
  }
}
console.log(`[fleet-score] ${agent} (${modelName}): ${scenarios.length} scenarios`);

const errorsDir = path.join(outDir, 'errors');
fs.mkdirSync(errorsDir, { recursive: true });

function scoreOnce(sc) {
  const scoreFile = path.join(scoresDir, `${sc.stage}-${sc.name}-score.json`);
  const artifact = path.join('/tmp', `omats-${agent}-${sc.stage}-${sc.name}.json`);
  execFileSync('node', ['scripts/run-ssh-scenario.mjs',
    '--scenario', sc.rel, '--agent', agent, '--ssh-host', sshHost,
    '--timeout', timeout, '--output', artifact],
    { cwd: ROOT, stdio: 'ignore', timeout: (Number(timeout) + 30) * 1000 });
  execFileSync('node', ['scripts/score-scenario.mjs', '--input', artifact, '--output', scoreFile],
    { cwd: ROOT, stdio: 'ignore' });
}

let done = 0, errors = 0, skipped = 0;
for (const sc of scenarios) {
  const scoreFile = path.join(scoresDir, `${sc.stage}-${sc.name}-score.json`);
  const errFile = path.join(errorsDir, `${sc.stage}-${sc.name}.json`);
  if (fs.existsSync(scoreFile)) { skipped++; continue; }
  if (fs.existsSync(errFile)) { errors++; continue; }
  // Gateway calls are flaky; retry once before recording a scenario as errored.
  // Errored scenarios go to errors/ (NOT scores/) so a transient gateway failure
  // is excluded from the aggregate rather than scored 0 and tanking the model.
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { scoreOnce(sc); lastErr = null; break; }
    catch (e) { lastErr = e; }
  }
  if (!lastErr) {
    done++;
    console.log(`[fleet-score] ${agent}  ${sc.stage}/${sc.name}  scored (${done}/${scenarios.length})`);
  } else {
    errors++;
    fs.writeFileSync(errFile, JSON.stringify({
      scenario_id: `${sc.stage}-${sc.name}`, agent, error: String(lastErr.message || lastErr).slice(0, 200)
    }, null, 2));
    console.log(`[fleet-score] ${agent}  ${sc.stage}/${sc.name}  ERROR (excluded): ${String(lastErr.message || lastErr).slice(0, 70)}`);
  }
}

// Aggregate the non-error scores into a run summary.
try {
  const summaryFile = path.join(outDir, 'summary.json');
  execFileSync('node', ['scripts/aggregate-scores.mjs', '--input', path.relative(ROOT, scoresDir), '--output', path.relative(ROOT, summaryFile)],
    { cwd: ROOT, stdio: 'ignore' });
  const s = JSON.parse(fs.readFileSync(summaryFile, 'utf8'));
  const st = s.stage_totals || {};
  const row = {
    name: modelName, vendor,
    score: Number((s.graded_total || 0).toFixed(2)),
    s3: Number(((st['3'] || {}).graded_total || 0).toFixed(2)),
    s4: Number(((st['4'] || {}).graded_total || 0).toFixed(2)),
    s5: Number(((st['5'] || {}).graded_total || 0).toFixed(2)),
    scored: s.scenario_count, errors
  };
  fs.writeFileSync(path.join(outDir, 'leaderboard-row.json'), JSON.stringify(row, null, 2));
  console.log(`[fleet-score] ${agent} DONE: score ${row.score} (S3 ${row.s3} S4 ${row.s4} S5 ${row.s5}) · ${done} scored, ${errors} errors, ${skipped} skipped`);
} catch (e) {
  console.log(`[fleet-score] ${agent} aggregate failed: ${e.message}`);
}
