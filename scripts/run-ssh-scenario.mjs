import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runScenario } from '../src/runner/run-scenario.mjs';
import { createOpenClawSshPlugin } from '../src/plugins/openclaw-ssh-plugin.mjs';

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
if (!args.scenario || !args.agent) {
  console.error('Usage: node scripts/run-ssh-scenario.mjs --scenario scenarios/stage3/loop-avoidance --agent yuba [--ssh-host family@localhost] [--timeout 60] [--output runs/out.json]');
  process.exit(1);
}

const plugin = createOpenClawSshPlugin({
  agentId: args.agent,
  sshHost: args['ssh-host'] || 'family@localhost',
  openclawHome: args['openclaw-home'] || '/Users/family/openclaw',
  timeoutSeconds: Number(args.timeout || 60),
  thinking: args.thinking || 'minimal'
});

const capabilityProfile = {
  schema_version: 'omats.capability.v1',
  model_id: `openclaw-ssh/${args.agent}`,
  provider: 'openclaw-ssh',
  supports_tools: true,
  supports_streaming: false,
  supports_system_prompt: true,
  supports_json_mode: false,
  max_context_tokens: 128000,
  notes: [`transport=ssh via ${args['ssh-host'] || 'family@localhost'}`]
};

const artifact = await runScenario({
  repoRoot: REPO_ROOT,
  scenarioPath: args.scenario,
  plugin,
  capabilityProfile,
  runId: args['run-id'] || new Date().toISOString().replace(/[:.]/g, '-')
});

const serialized = JSON.stringify(artifact, null, 2);
if (args.output) {
  const outputPath = path.resolve(REPO_ROOT, args.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized);
  console.error(`Wrote run artifact to ${path.relative(REPO_ROOT, outputPath)}`);
} else {
  console.log(serialized);
}
