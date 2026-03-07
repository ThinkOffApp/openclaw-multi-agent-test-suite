import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runScenario } from '../src/runner/run-scenario.mjs';
import { scoreScenario } from '../src/scoring/score-scenario.mjs';
import { createDashScopePlugin } from '../src/plugins/dashscope-direct-plugin.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (!part.startsWith('--')) continue;
    args[part.slice(2)] = argv[index + 1];
    index += 1;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

const modelId = args.model;
if (!modelId) {
  console.error('Usage: node scripts/run-qwen-comparison.mjs --model qwen3-4b [--stage 3,4,5] [--output runs/qwen-4b]');
  console.error('\nAvailable Qwen models on DashScope:');
  console.error('  qwen-max, qwen-plus, qwen3.5-27b, qwen3-8b, qwen3-4b');
  process.exit(1);
}

const stageFilter = args.stage
  ? args.stage.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
  : null;
const outputDir = args.output ? path.resolve(REPO_ROOT, args.output) : null;
const runId = args['run-id'] || `${modelId}-${new Date().toISOString().replace(/[:.]/g, '-')}`;

const plugin = createDashScopePlugin({ modelId });

const capabilityProfile = {
  schema_version: 'omats.capability.v1',
  model_id: `dashscope/${modelId}`,
  provider: 'dashscope',
  supports_tools: false,
  supports_streaming: false,
  supports_system_prompt: true,
  supports_json_mode: false,
  max_context_tokens: 32000,
  notes: [`DashScope direct API, model: ${modelId}`]
};

// Discover scenarios
const scenariosDir = path.join(REPO_ROOT, 'scenarios');
const scenarios = [];

for (const stageDir of fs.readdirSync(scenariosDir).sort()) {
  if (!stageDir.startsWith('stage')) continue;
  const stageNum = parseInt(stageDir.replace('stage', ''), 10);
  if (stageFilter && !stageFilter.includes(stageNum)) continue;

  const stagePath = path.join(scenariosDir, stageDir);
  if (!fs.statSync(stagePath).isDirectory()) continue;

  for (const scenarioDir of fs.readdirSync(stagePath).sort()) {
    const scenarioPath = path.join(stagePath, scenarioDir);
    if (!fs.statSync(scenarioPath).isDirectory()) continue;
    if (!fs.existsSync(path.join(scenarioPath, 'metadata.json'))) continue;

    scenarios.push({
      relativePath: path.relative(REPO_ROOT, scenarioPath),
      stage: stageNum,
      id: scenarioDir
    });
  }
}

if (scenarios.length === 0) {
  console.error('No scenarios found.');
  process.exit(1);
}

console.error(`Running ${scenarios.length} scenarios with ${modelId} (run: ${runId})`);

if (outputDir) {
  fs.mkdirSync(path.join(outputDir, 'artifacts'), { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'scores'), { recursive: true });
}

let passCount = 0;
let failCount = 0;
const results = [];

for (const scenario of scenarios) {
  const label = `stage${scenario.stage}/${scenario.id}`;

  try {
    const artifact = await runScenario({
      repoRoot: REPO_ROOT,
      scenarioPath: scenario.relativePath,
      plugin,
      capabilityProfile,
      runId
    });

    const score = scoreScenario(artifact);
    const statusIcon = score.status === 'pass' ? 'PASS' : 'FAIL';

    if (score.status === 'pass') passCount++;
    else failCount++;

    const np = score.noise_penalty > 0 ? ` (np=${score.noise_penalty})` : '';
    console.error(`  ${statusIcon}  ${label}${np}`);

    results.push({
      scenario: label,
      status: score.status,
      score: score.final_score,
      noise_penalty: score.noise_penalty,
      auto_fail: score.auto_fail_reasons
    });

    if (outputDir) {
      const safe = label.replace('/', '-');
      fs.writeFileSync(path.join(outputDir, 'artifacts', `${safe}.json`), JSON.stringify(artifact, null, 2));
      fs.writeFileSync(path.join(outputDir, 'scores', `${safe}.json`), JSON.stringify(score, null, 2));
    }
  } catch (err) {
    console.error(`  ERR  ${label}: ${err.message}`);
    failCount++;
    results.push({ scenario: label, status: 'error', error: err.message });
  }
}

console.error(`\n${modelId}: ${passCount} pass, ${failCount} fail out of ${scenarios.length}`);

const summary = { model: modelId, run_id: runId, pass: passCount, fail: failCount, total: scenarios.length, results };
const serialized = JSON.stringify(summary, null, 2);

if (outputDir) {
  fs.writeFileSync(path.join(outputDir, 'summary.json'), serialized);
  console.error(`Results written to ${path.relative(REPO_ROOT, outputDir)}/`);
}

console.log(serialized);
