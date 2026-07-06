#!/usr/bin/env node
// Generate the public OMATS leaderboard page (docs/index.html) by embedding
// the current dataset (docs/leaderboard-data.json) into the page template.
//
// The page is self-contained (data inlined) so it renders on GitHub Pages and
// from file://, with no runtime fetch. To add a newly scored model:
//   1. score + aggregate its runs (scripts/aggregate-scores.mjs) into a run-summary
//   2. add its row to docs/leaderboard-data.json (name, vendor, score, s3, s4, s5)
//   3. re-run: node scripts/generate-leaderboard.mjs
//
// Idempotent: replaces the <script id="lbdata"> payload in place, so running it
// repeatedly produces a stable page.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.resolve(__dirname, '..', 'docs');
const dataPath = path.join(DOCS, 'leaderboard-data.json');
const pagePath = path.join(DOCS, 'index.html');

const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

// Basic validation so a malformed dataset fails loudly instead of shipping a blank page.
if (!Array.isArray(data.models) || data.models.length === 0) {
  console.error('[generate-leaderboard] leaderboard-data.json has no models');
  process.exit(1);
}
for (const m of data.models) {
  for (const k of ['name', 'score', 's3', 's4', 's5']) {
    if (m[k] === undefined) {
      console.error(`[generate-leaderboard] model "${m.name || '?'}" missing field: ${k}`);
      process.exit(1);
    }
  }
}

const json = JSON.stringify(data, null, 2);
let html = fs.readFileSync(pagePath, 'utf8');

const re = /(<script id="lbdata"[^>]*>)([\s\S]*?)(<\/script>)/;
if (!re.test(html)) {
  console.error('[generate-leaderboard] could not find <script id="lbdata"> block in docs/index.html');
  process.exit(1);
}
html = html.replace(re, (_m, open, _body, close) => `${open}\n${json}\n${close}`);
fs.writeFileSync(pagePath, html);

console.log(`[generate-leaderboard] embedded ${data.models.length} models into docs/index.html`);
