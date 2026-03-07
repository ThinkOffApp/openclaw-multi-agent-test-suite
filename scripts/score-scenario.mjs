import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { scoreScenario } from '../src/scoring/score-scenario.mjs';

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

if (!args.input) {
  console.error('Usage: node scripts/score-scenario.mjs --input <run-artifact.json> [--output <score.json>]');
  console.error('');
  console.error('Scores a single run artifact produced by the runner.');
  console.error('Reads the run artifact JSON, evaluates auto-fail gates, structural');
  console.error('checks, noise penalties, and produces an omats.score.v1 result.');
  process.exit(1);
}

const inputPath = path.resolve(REPO_ROOT, args.input);
const runArtifact = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const score = scoreScenario(runArtifact);
const serialized = JSON.stringify(score, null, 2);

if (args.output) {
  const outputPath = path.resolve(REPO_ROOT, args.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized);
  console.error(`Wrote score to ${path.relative(REPO_ROOT, outputPath)}`);
} else {
  console.log(serialized);
}
