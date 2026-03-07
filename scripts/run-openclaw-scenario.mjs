import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runScenario } from '../src/runner/run-scenario.mjs';
import { createOpenClawAgentPlugin } from '../src/plugins/openclaw-agent-plugin.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (part === '--local') {
      args.local = true;
      continue;
    }
    if (!part.startsWith('--')) continue;
    args[part.slice(2)] = argv[index + 1];
    index += 1;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.scenario || !args.agent) {
  console.error('Usage: node scripts/run-openclaw-scenario.mjs --scenario scenarios/stage3/graceful-degradation --agent geminimb_trader [--local] [--timeout 60] [--thinking minimal] [--output runs/out.json]');
  process.exit(1);
}

const plugin = createOpenClawAgentPlugin({
  agentId: args.agent,
  local: args.local === true,
  timeoutSeconds: Number(args.timeout || 60),
  thinking: args.thinking || 'minimal'
});

const capabilityProfile = {
  schema_version: 'omats.capability.v1',
  model_id: `openclaw-agent/${args.agent}`,
  provider: 'openclaw-agent',
  supports_tools: true,
  supports_streaming: false,
  supports_system_prompt: true,
  supports_json_mode: false,
  max_context_tokens: 128000,
  notes: [
    args.local === true ? 'transport=embedded-local' : 'transport=gateway-session'
  ]
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
