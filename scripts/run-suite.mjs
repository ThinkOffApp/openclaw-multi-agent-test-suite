import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { runScenario } from '../src/runner/run-scenario.mjs';
import { listScenarioVariants } from '../src/runner/load-scenario.mjs';
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

function normalizeDimensionValue(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return 0;

  switch (value.toLowerCase()) {
    case 'pass':
      return 1;
    case 'partial':
      return 0.5;
    case 'fail':
      return 0;
    default:
      return 0;
  }
}

function dimensionLabel(score) {
  if (score >= 0.85) return 'pass';
  if (score >= 0.4) return 'partial';
  return 'fail';
}

function scoreBand(score) {
  if (score >= 0.95) return 'perfect';
  if (score >= 0.75) return 'minor-issue';
  if (score >= 0.35) return 'recovered';
  if (score > 0) return 'significant-issues';
  return 'total-failure';
}

function roundScore(value) {
  return Number(value.toFixed(4));
}

function sanitizeFileToken(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function defaultMinPassRate(runCount) {
  return runCount >= 3 ? 2 / 3 : 1;
}

function checkCapability(requires, profile) {
  for (const [key, value] of Object.entries(requires)) {
    if (profile[key] !== value) return key;
  }
  return null;
}

function aggregateScenarioRuns({
  runId,
  scenario,
  runScores,
  passThreshold,
  minPassRate
}) {
  const scenarioCount = runScores.length;
  const passRuns = runScores.filter((score) => score.final_score >= passThreshold).length;
  const passRate = scenarioCount === 0 ? 0 : passRuns / scenarioCount;
  const first = runScores[0];

  const avgBase = runScores.reduce((sum, score) => sum + (score.base_score || 0), 0) / scenarioCount;
  const avgNoise = runScores.reduce((sum, score) => sum + (score.noise_penalty || 0), 0) / scenarioCount;
  const avgFinal = runScores.reduce((sum, score) => sum + (score.final_score || 0), 0) / scenarioCount;

  const dimensionAccumulator = {
    comprehension: 0,
    discipline: 0,
    execution: 0
  };

  for (const score of runScores) {
    for (const key of Object.keys(dimensionAccumulator)) {
      const numeric = score.dimension_scores?.[key] ?? normalizeDimensionValue(score.dimensions?.[key]);
      dimensionAccumulator[key] += numeric;
    }
  }

  const dimensionScores = Object.fromEntries(
    Object.entries(dimensionAccumulator).map(([key, total]) => [key, roundScore(total / scenarioCount)])
  );

  const dimensions = Object.fromEntries(
    Object.entries(dimensionScores).map(([key, value]) => [key, dimensionLabel(value)])
  );

  const autoFailReasons = runScores.flatMap((score, index) =>
    (score.auto_fail_reasons || []).map((reason) =>
      `[run ${index + 1}/${scenarioCount} ${score.transcript_variant || 'default'}] ${reason}`
    )
  );

  const notes = [
    `Runs meeting threshold ${passThreshold}: ${passRuns}/${scenarioCount}`,
    `Pass-rate requirement: ${roundScore(minPassRate)}`
  ];

  return {
    schema_version: 'omats.score.v1',
    run_id: runId,
    scenario_id: first.scenario_id,
    stage: scenario.stage,
    model_id: first.model_id,
    status: passRate >= minPassRate ? 'pass' : 'fail',
    base_score: roundScore(avgBase),
    noise_penalty: roundScore(avgNoise),
    final_score: roundScore(avgFinal),
    pass_threshold: passThreshold,
    pass_rate: roundScore(passRate),
    min_pass_rate: roundScore(minPassRate),
    run_count: scenarioCount,
    transcript_variants_used: [...new Set(runScores.map((score) => score.transcript_variant || 'default'))],
    dimensions,
    dimension_scores: dimensionScores,
    auto_fail_reasons: autoFailReasons,
    score_band: scoreBand(avgFinal),
    runs: runScores.map((score, index) => ({
      run_index: index + 1,
      transcript_variant: score.transcript_variant || 'default',
      status: score.status,
      final_score: score.final_score
    })),
    notes
  };
}

const args = parseArgs(process.argv.slice(2));
const outputDir = args.output ? path.resolve(REPO_ROOT, args.output) : null;
const pluginPath = path.resolve(REPO_ROOT, args.plugin || './src/plugins/mock-echo-plugin.mjs');
const capabilityPath = path.resolve(REPO_ROOT, args.capability || './examples/mock-capability-profile.json');
const stageFilter = parseStageFilter(args.stage);
const runId = args['run-id'] || new Date().toISOString().replace(/[:.]/g, '-');
const runsPerScenario = Math.max(1, Number(args.runs || 1));
const passThreshold = Number(args['pass-threshold'] || 0.85);
const minPassRate = Number(args['min-pass-rate'] || defaultMinPassRate(runsPerScenario));

const pluginModule = await import(pathToFileURL(pluginPath).href);
const plugin = pluginModule.default;
const capabilityProfile = JSON.parse(fs.readFileSync(capabilityPath, 'utf8'));

const scenariosDir = path.join(REPO_ROOT, 'scenarios');
const scenarios = discoverScenarios(scenariosDir, stageFilter);

if (scenarios.length === 0) {
  console.error('No scenarios found.');
  process.exit(1);
}

console.error(
  `Running ${scenarios.length} scenarios with plugin "${plugin.id}" ` +
  `(run: ${runId}, runs/scenario: ${runsPerScenario}, pass-threshold: ${passThreshold}, min-pass-rate: ${roundScore(minPassRate)})`
);

if (outputDir) {
  fs.mkdirSync(path.join(outputDir, 'artifacts'), { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'scores', 'runs'), { recursive: true });
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

  const variants = listScenarioVariants(REPO_ROOT, scenario.relativePath);
  const runScores = [];
  let scenarioErrored = false;

  for (let runIndex = 0; runIndex < runsPerScenario; runIndex += 1) {
    const variant = variants[runIndex % variants.length];
    const childRunId = `${runId}-s${String(scoreResults.length + skipCount + 1).padStart(3, '0')}-r${String(runIndex + 1).padStart(2, '0')}`;
    const fileStem = sanitizeFileToken(`${label}-${variant.id}-run-${String(runIndex + 1).padStart(2, '0')}`);

    try {
      const artifact = await runScenario({
        repoRoot: REPO_ROOT,
        scenarioPath: scenario.relativePath,
        plugin,
        capabilityProfile,
        runId: childRunId,
        transcriptPath: variant.transcriptPath,
        variantId: variant.id
      });

      const score = {
        ...scoreScenario(artifact),
        transcript_variant: artifact.transcript_variant || variant.id,
        parent_run_id: runId
      };
      runScores.push(score);

      if (outputDir) {
        const artifactFile = path.join(outputDir, 'artifacts', `${fileStem}.json`);
        fs.writeFileSync(artifactFile, JSON.stringify(artifact, null, 2));

        const scoreFile = path.join(outputDir, 'scores', 'runs', `${fileStem}.json`);
        fs.writeFileSync(scoreFile, JSON.stringify(score, null, 2));
      }
    } catch (err) {
      scenarioErrored = true;
      console.error(`  ERR  ${label} [${variant.id}] run ${runIndex + 1}/${runsPerScenario}: ${err.message}`);
      break;
    }
  }

  if (scenarioErrored || runScores.length === 0) {
    failCount++;
    continue;
  }

  const scenarioScore = aggregateScenarioRuns({
    runId,
    scenario,
    runScores,
    passThreshold,
    minPassRate
  });
  scoreResults.push(scenarioScore);

  if (scenarioScore.status === 'pass') {
    passCount++;
  } else {
    failCount++;
  }

  const statusIcon = scenarioScore.status === 'pass' ? 'PASS' : 'FAIL';
  console.error(
    `  ${statusIcon}  ${label} (runs=${runScores.length}, pass-rate=${scenarioScore.pass_rate}, avg=${scenarioScore.final_score})`
  );

  if (outputDir) {
    const scenarioScoreFile = path.join(
      outputDir,
      'scores',
      `${sanitizeFileToken(label)}.json`
    );
    fs.writeFileSync(scenarioScoreFile, JSON.stringify(scenarioScore, null, 2));
  }
}

const skippedMsg = skipCount > 0 ? `, ${skipCount} skipped` : '';
console.error(`\nResults: ${passCount} pass, ${failCount} fail${skippedMsg} across ${scenarios.length} scenarios`);

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
