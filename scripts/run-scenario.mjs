import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { runScenario } from '../src/runner/run-scenario.mjs';

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
const scenarioPath = args.scenario;
if (!scenarioPath) {
  console.error('Usage: node scripts/run-scenario.mjs --scenario scenarios/stage4/stop-order-compliance [--variant variants/paraphrase-a.json] [--plugin ./src/plugins/mock-echo-plugin.mjs] [--capability ./examples/mock-capability-profile.json] [--output ./runs/out.json]');
  process.exit(1);
}

const pluginPath = path.resolve(REPO_ROOT, args.plugin || './src/plugins/mock-echo-plugin.mjs');
const capabilityPath = path.resolve(REPO_ROOT, args.capability || './examples/mock-capability-profile.json');
const outputPath = args.output ? path.resolve(REPO_ROOT, args.output) : null;

const pluginModule = await import(pathToFileURL(pluginPath).href);
const plugin = pluginModule.default;
const capabilityProfile = JSON.parse(fs.readFileSync(capabilityPath, 'utf8'));
const runId = args['run-id'] || new Date().toISOString().replace(/[:.]/g, '-');

const artifact = await runScenario({
  repoRoot: REPO_ROOT,
  scenarioPath,
  plugin,
  capabilityProfile,
  runId,
  transcriptPath: args.variant,
  variantId: args.variant ? args.variant.replace(/\\/g, '/').replace(/\.json$/i, '') : undefined
});

const serialized = JSON.stringify(artifact, null, 2);

if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized);
  console.error(`Wrote run artifact to ${path.relative(REPO_ROOT, outputPath)}`);
} else {
  console.log(serialized);
}
