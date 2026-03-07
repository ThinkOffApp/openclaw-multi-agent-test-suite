import fs from 'fs';
import path from 'path';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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
  const metadata = readJson(path.join(scenarioDir, 'metadata.json'));
  const rubric = readJson(path.join(scenarioDir, 'rubric.json'));
  const transcript = readJson(path.join(scenarioDir, 'transcript.json'));

  return {
    scenarioDir,
    metadata,
    rubric,
    transcript,
    expandedEvents: expandTranscriptEvents(transcript.events || [])
  };
}
