import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runLiveScenario } from '../src/runner/run-live-scenario.mjs';
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
if (!args.scenario || !args.agents) {
  console.error('Usage: node scripts/run-live-scenario.mjs --scenario scenarios/live/two-agent-discussion --agents mecha,kim [--max-rounds 10] [--ssh-host family@localhost] [--output runs/out.json]');
  process.exit(1);
}

const agentIds = args.agents.split(',');
const sshHost = args['ssh-host'] || 'family@localhost';
const openclawHome = args['openclaw-home'] || '/Users/family/openclaw';
const timeoutSeconds = Number(args.timeout || 120);
const maxRounds = Number(args['max-rounds'] || 10);

const agents = agentIds.map((agentId) => ({
  id: `agent:${agentId}`,
  plugin: createOpenClawSshPlugin({
    agentId,
    sshHost,
    openclawHome,
    timeoutSeconds,
    thinking: args.thinking || 'minimal'
  }),
  capabilityProfile: {
    schema_version: 'omats.capability.v1',
    model_id: `openclaw-ssh/${agentId}`,
    provider: 'openclaw-ssh',
    supports_tools: true,
    supports_streaming: false,
    supports_system_prompt: true,
    supports_json_mode: false,
    max_context_tokens: 128000,
    notes: [`transport=ssh via ${sshHost}`]
  }
}));

const artifact = await runLiveScenario({
  repoRoot: REPO_ROOT,
  scenarioPath: args.scenario,
  agents,
  maxRounds,
  runId: args['run-id'] || new Date().toISOString().replace(/[:.]/g, '-')
});

const serialized = JSON.stringify(artifact, null, 2);
if (args.output) {
  const outputPath = path.resolve(REPO_ROOT, args.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized);
  console.error(`Wrote live run artifact to ${path.relative(REPO_ROOT, outputPath)}`);
} else {
  console.log(serialized);
}
