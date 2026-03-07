import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { runScenario } from '../src/runner/run-scenario.mjs';
import { scoreScenario } from '../src/scoring/score-scenario.mjs';
import { aggregateRunSummary } from '../src/scoring/aggregate-run-summary.mjs';

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

function discoverScenarios(scenariosDir, stageFilter) {
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

      const metadataFile = path.join(scenarioPath, 'metadata.json');
      if (!fs.existsSync(metadataFile)) continue;

      const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
      scenarios.push({
        relativePath: path.relative(REPO_ROOT, scenarioPath),
        stage: stageNum,
        id: scenarioDir,
        requires: metadata.requires || {}
      });
    }
  }

  return scenarios;
}

function parseStageFilter(value) {
  if (!value) return null;
  return value.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
}

const args = parseArgs(process.argv.slice(2));
const outputDir = args.output ? path.resolve(REPO_ROOT, args.output) : null;
const pluginPath = path.resolve(REPO_ROOT, args.plugin || './src/plugins/mock-echo-plugin.mjs');
const capabilityPath = path.resolve(REPO_ROOT, args.capability || './examples/mock-capability-profile.json');
const stageFilter = parseStageFilter(args.stage);
const runId = args['run-id'] || new Date().toISOString().replace(/[:.]/g, '-');

const pluginModule = await import(pathToFileURL(pluginPath).href);
const plugin = pluginModule.default;
const capabilityProfile = JSON.parse(fs.readFileSync(capabilityPath, 'utf8'));

const scenariosDir = path.join(REPO_ROOT, 'scenarios');
const scenarios = discoverScenarios(scenariosDir, stageFilter);

if (scenarios.length === 0) {
  console.error('No scenarios found.');
  process.exit(1);
}

console.error(`Running ${scenarios.length} scenarios with plugin "${plugin.id}" (run: ${runId})`);

if (outputDir) {
  fs.mkdirSync(path.join(outputDir, 'artifacts'), { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'scores'), { recursive: true });
}

function checkCapability(requires, profile) {
  for (const [key, value] of Object.entries(requires)) {
    if (profile[key] !== value) return key;
  }
  return null;
}

const scoreResults = [];
let passCount = 0;
let failCount = 0;
let skipCount = 0;

for (const scenario of scenarios) {
  const label = `stage${scenario.stage}/${scenario.id}`;

  const missingCap = checkCapability(scenario.requires, capabilityProfile);
  if (missingCap) {
    console.error(`  SKIP ${label} (requires ${missingCap})`);
    skipCount++;
    continue;
  }

  try {
    const artifact = await runScenario({
      repoRoot: REPO_ROOT,
      scenarioPath: scenario.relativePath,
      plugin,
      capabilityProfile,
      runId
    });

    const score = scoreScenario(artifact);
    scoreResults.push(score);

    if (score.status === 'pass') {
      passCount++;
    } else {
      failCount++;
    }

    const statusIcon = score.status === 'pass' ? 'PASS' : 'FAIL';
    const details = [];
    if (score.auto_fail_reasons.length > 0) details.push(`af=${score.auto_fail_reasons.length}`);
    if (score.noise_penalty > 0) details.push(`np=${score.noise_penalty}`);
    const suffix = details.length > 0 ? ` (${details.join(', ')})` : '';
    console.error(`  ${statusIcon}  ${label}${suffix}`);

    if (outputDir) {
      const artifactFile = path.join(outputDir, 'artifacts', `${label.replace('/', '-')}.json`);
      fs.writeFileSync(artifactFile, JSON.stringify(artifact, null, 2));

      const scoreFile = path.join(outputDir, 'scores', `${label.replace('/', '-')}.json`);
      fs.writeFileSync(scoreFile, JSON.stringify(score, null, 2));
    }
  } catch (err) {
    console.error(`  ERR  ${label}: ${err.message}`);
    failCount++;
  }
}

const skippedMsg = skipCount > 0 ? `, ${skipCount} skipped` : '';
console.error(`\nResults: ${passCount} pass, ${failCount} fail${skippedMsg} out of ${scenarios.length} scenarios`);

if (scoreResults.length > 0) {
  const summary = aggregateRunSummary(scoreResults);
  const serialized = JSON.stringify(summary, null, 2);

  if (outputDir) {
    const summaryFile = path.join(outputDir, 'run-summary.json');
    fs.writeFileSync(summaryFile, serialized);
    console.error(`\nFull results written to ${path.relative(REPO_ROOT, outputDir)}/`);
  }

  console.log(serialized);
}
