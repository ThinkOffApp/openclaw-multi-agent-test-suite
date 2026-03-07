import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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

function collectJsonFiles(targetPath) {
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) return [targetPath];

  return fs.readdirSync(targetPath)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => path.join(targetPath, entry))
    .sort();
}

const args = parseArgs(process.argv.slice(2));
if (!args.input) {
  console.error('Usage: node scripts/aggregate-scores.mjs --input ./runs/scores [--output ./runs/run-summary.json]');
  process.exit(1);
}

const inputPath = path.resolve(REPO_ROOT, args.input);
const scoreResults = collectJsonFiles(inputPath).map((filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8')));
const summary = aggregateRunSummary(scoreResults);
const serialized = JSON.stringify(summary, null, 2);

if (args.output) {
  const outputPath = path.resolve(REPO_ROOT, args.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized);
  console.error(`Wrote run summary to ${path.relative(REPO_ROOT, outputPath)}`);
} else {
  console.log(serialized);
}
