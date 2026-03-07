import fs from 'fs';
import path from 'path';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveTranscriptFile(scenarioDir, transcriptPath) {
  if (!transcriptPath) {
    return path.join(scenarioDir, 'transcript.json');
  }

  return path.isAbsolute(transcriptPath)
    ? transcriptPath
    : path.resolve(scenarioDir, transcriptPath);
}

function deriveVariantId(transcriptFile, scenarioDir) {
  const defaultTranscript = path.join(scenarioDir, 'transcript.json');
  if (transcriptFile === defaultTranscript) return 'default';

  const relative = path.relative(scenarioDir, transcriptFile);
  return relative.replace(/\\/g, '/').replace(/\.json$/i, '');
}

export function expandTranscriptEvents(events) {
  const expanded = [];

  for (const event of events) {
    if (event.type !== 'filler-block') {
      expanded.push(event);
      continue;
    }

    for (let index = 1; index <= event.count; index += 1) {
      expanded.push({
        id: `${event.id}.fill-${String(index).padStart(3, '0')}`,
        type: 'message',
        from: event.template.from,
        body: event.template.body_pattern.replaceAll('{n}', String(index)),
        synthetic: true,
        source_event_id: event.id,
        note: event.note || null
      });
    }
  }

  return expanded;
}

export function loadScenarioPack(repoRoot, scenarioRelativePath) {
  const scenarioDir = path.resolve(repoRoot, scenarioRelativePath);
  const transcriptFile = resolveTranscriptFile(scenarioDir);
  const transcript = readJson(transcriptFile);
  const metadata = readJson(path.join(scenarioDir, 'metadata.json'));
  const rubric = readJson(path.join(scenarioDir, 'rubric.json'));

  return {
    scenarioDir,
    metadata,
    rubric,
    transcript,
    transcriptFile,
    transcriptVariantId: deriveVariantId(transcriptFile, scenarioDir),
    expandedEvents: expandTranscriptEvents(transcript.events || [])
  };
}

export function listScenarioVariants(repoRoot, scenarioRelativePath) {
  const scenarioDir = path.resolve(repoRoot, scenarioRelativePath);
  const variants = [
    {
      id: 'default',
      transcriptPath: path.join(scenarioDir, 'transcript.json')
    }
  ];

  const variantsDir = path.join(scenarioDir, 'variants');
  if (!fs.existsSync(variantsDir) || !fs.statSync(variantsDir).isDirectory()) {
    return variants;
  }

  const variantFiles = fs.readdirSync(variantsDir)
    .filter((entry) => entry.endsWith('.json'))
    .sort();

  for (const fileName of variantFiles) {
    variants.push({
      id: `variants/${fileName.replace(/\.json$/i, '')}`,
      transcriptPath: path.join(variantsDir, fileName)
    });
  }

  return variants;
}

export function loadScenarioPackWithOptions(repoRoot, scenarioRelativePath, options = {}) {
  const scenarioDir = path.resolve(repoRoot, scenarioRelativePath);
  const transcriptFile = resolveTranscriptFile(scenarioDir, options.transcriptPath);
  const metadata = readJson(path.join(scenarioDir, 'metadata.json'));
  const rubric = readJson(path.join(scenarioDir, 'rubric.json'));
  const transcript = readJson(transcriptFile);

  return {
    scenarioDir,
    metadata,
    rubric,
    transcript,
    transcriptFile,
    transcriptVariantId: options.variantId || deriveVariantId(transcriptFile, scenarioDir),
    expandedEvents: expandTranscriptEvents(transcript.events || [])
  };
}
