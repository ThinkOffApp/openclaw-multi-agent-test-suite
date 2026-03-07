import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const SCENARIOS_ROOT = path.join(REPO_ROOT, 'scenarios');
const REQUIRED_FILES = ['metadata.json', 'rubric.json', 'transcript.json'];
const VARIANTS_DIR_NAME = 'variants';
const VALID_PARTICIPANT_ROLES = new Set(['human', 'scripted-agent', 'model-under-test']);
const VALID_EVENT_TYPES = new Set(['message', 'expect-response', 'tool-result', 'filler-block']);

let errorCount = 0;
let scenarioCount = 0;

function fail(scenarioPath, message) {
  errorCount += 1;
  console.error(`ERROR ${scenarioPath}: ${message}`);
}

function readJson(filePath, scenarioPath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(scenarioPath, `failed to parse ${path.basename(filePath)}: ${error.message}`);
    return null;
  }
}

function assert(condition, scenarioPath, message) {
  if (!condition) fail(scenarioPath, message);
}

function validateMetadata(metadata, stageNumber, scenarioDirName, scenarioPath) {
  if (!metadata) return;

  assert(metadata.schema_version === 'omats.scenario-meta.v1', scenarioPath, 'metadata schema_version must be omats.scenario-meta.v1');
  assert(typeof metadata.scenario_id === 'string' && metadata.scenario_id.length > 0, scenarioPath, 'metadata.scenario_id must be a non-empty string');
  assert(metadata.stage === stageNumber, scenarioPath, `metadata.stage must equal ${stageNumber}`);
  assert(typeof metadata.title === 'string' && metadata.title.length > 0, scenarioPath, 'metadata.title must be a non-empty string');
  assert(metadata.scenario_id === `stage${stageNumber}-${scenarioDirName}`, scenarioPath, `metadata.scenario_id should be stage${stageNumber}-${scenarioDirName}`);

  if (metadata.requires !== undefined) {
    assert(metadata.requires && typeof metadata.requires === 'object' && !Array.isArray(metadata.requires), scenarioPath, 'metadata.requires must be an object when present');
  }

  if (metadata.tags !== undefined) {
    assert(Array.isArray(metadata.tags), scenarioPath, 'metadata.tags must be an array when present');
    for (const tag of metadata.tags || []) {
      assert(typeof tag === 'string' && tag.length > 0, scenarioPath, 'metadata.tags entries must be non-empty strings');
    }
  }
}

function validateTranscript(transcript, scenarioPath) {
  if (!transcript) return { participantIds: new Set(), subjectPresent: false };

  assert(transcript.schema_version === 'omats.transcript.v1', scenarioPath, 'transcript schema_version must be omats.transcript.v1');
  assert(Array.isArray(transcript.participants) && transcript.participants.length >= 2, scenarioPath, 'transcript.participants must contain at least two participants');
  assert(Array.isArray(transcript.events) && transcript.events.length > 0, scenarioPath, 'transcript.events must be a non-empty array');

  const participantIds = new Set();
  let subjectPresent = false;

  for (const participant of transcript.participants || []) {
    assert(typeof participant.id === 'string' && participant.id.length > 0, scenarioPath, 'each participant.id must be a non-empty string');
    assert(!participantIds.has(participant.id), scenarioPath, `duplicate participant id ${participant.id}`);
    participantIds.add(participant.id);
    assert(VALID_PARTICIPANT_ROLES.has(participant.role), scenarioPath, `participant ${participant.id} has invalid role ${participant.role}`);
    if (participant.role === 'model-under-test') {
      subjectPresent = true;
      assert(participant.id === 'agent:subject', scenarioPath, 'model-under-test participant must use id agent:subject');
    }
  }

  const eventIds = new Set();

  for (const event of transcript.events || []) {
    assert(typeof event.id === 'string' && event.id.length > 0, scenarioPath, 'each event.id must be a non-empty string');
    assert(!eventIds.has(event.id), scenarioPath, `duplicate event id ${event.id}`);
    eventIds.add(event.id);
    assert(VALID_EVENT_TYPES.has(event.type), scenarioPath, `unsupported event type ${event.type}`);

    if (event.type === 'message') {
      assert(typeof event.from === 'string' && participantIds.has(event.from), scenarioPath, `message event ${event.id} must reference a known participant in from`);
      assert(typeof event.body === 'string' && event.body.length > 0, scenarioPath, `message event ${event.id} must include a non-empty body`);
    }

    if (event.type === 'expect-response') {
      assert(event.from === 'agent:subject', scenarioPath, `expect-response event ${event.id} must target agent:subject`);
      assert(typeof event.note === 'string' && event.note.length > 0, scenarioPath, `expect-response event ${event.id} must include note`);
    }

    if (event.type === 'tool-result') {
      assert(typeof event.tool === 'string' && event.tool.length > 0, scenarioPath, `tool-result event ${event.id} must include tool`);
      assert(event.result && typeof event.result === 'object' && !Array.isArray(event.result), scenarioPath, `tool-result event ${event.id} must include object result`);
    }

    if (event.type === 'filler-block') {
      assert(Number.isInteger(event.count) && event.count > 0, scenarioPath, `filler-block event ${event.id} must include positive integer count`);
      assert(event.template && typeof event.template === 'object' && !Array.isArray(event.template), scenarioPath, `filler-block event ${event.id} must include template object`);
      assert(typeof event.template?.from === 'string' && participantIds.has(event.template.from), scenarioPath, `filler-block event ${event.id} must reference a known participant in template.from`);
      assert(typeof event.template?.body_pattern === 'string' && event.template.body_pattern.includes('{n}'), scenarioPath, `filler-block event ${event.id} must include template.body_pattern with {n}`);
    }
  }

  assert(subjectPresent, scenarioPath, 'transcript must include model-under-test participant');
  return { participantIds, subjectPresent };
}

function validateRubric(rubric, metadata, scenarioPath) {
  if (!rubric) return;

  assert(rubric.schema_version === 'omats.rubric.v1', scenarioPath, 'rubric schema_version must be omats.rubric.v1');
  assert(typeof rubric.scenario_id === 'string' && rubric.scenario_id.length > 0, scenarioPath, 'rubric.scenario_id must be a non-empty string');
  if (metadata?.scenario_id) {
    assert(rubric.scenario_id === metadata.scenario_id, scenarioPath, 'rubric.scenario_id must match metadata.scenario_id');
  }

  for (const field of ['pass_conditions', 'fail_conditions']) {
    assert(Array.isArray(rubric[field]) && rubric[field].length > 0, scenarioPath, `rubric.${field} must be a non-empty array`);
    for (const entry of rubric[field] || []) {
      assert(typeof entry === 'string' && entry.length > 0, scenarioPath, `rubric.${field} entries must be non-empty strings`);
    }
  }

  if (rubric.auto_fail !== undefined) {
    assert(Array.isArray(rubric.auto_fail), scenarioPath, 'rubric.auto_fail must be an array when present');
    for (const entry of rubric.auto_fail || []) {
      assert(typeof entry === 'string' && entry.length > 0, scenarioPath, 'rubric.auto_fail entries must be non-empty strings');
    }
  }

  if (rubric.noise_penalties !== undefined) {
    assert(Array.isArray(rubric.noise_penalties), scenarioPath, 'rubric.noise_penalties must be an array when present');
    for (const penalty of rubric.noise_penalties || []) {
      assert(typeof penalty.label === 'string' && penalty.label.length > 0, scenarioPath, 'noise penalty label must be a non-empty string');
      assert(typeof penalty.deduct === 'number' && penalty.deduct >= 0, scenarioPath, 'noise penalty deduct must be a non-negative number');
    }
  }

  if (rubric.dimensions !== undefined) {
    assert(rubric.dimensions && typeof rubric.dimensions === 'object' && !Array.isArray(rubric.dimensions), scenarioPath, 'rubric.dimensions must be an object when present');
    for (const key of ['comprehension', 'discipline', 'execution']) {
      assert(typeof rubric.dimensions[key] === 'string' && rubric.dimensions[key].length > 0, scenarioPath, `rubric.dimensions.${key} must be a non-empty string`);
    }
  }
}

function validateScenario(stageDirName, scenarioDirName) {
  const scenarioPath = `${stageDirName}/${scenarioDirName}`;
  const absoluteScenarioPath = path.join(SCENARIOS_ROOT, stageDirName, scenarioDirName);
  const stageMatch = stageDirName.match(/^stage(\d+)$/);
  assert(stageMatch, scenarioPath, `invalid stage directory ${stageDirName}`);
  if (!stageMatch) return;

  const stageNumber = Number(stageMatch[1]);

  for (const requiredFile of REQUIRED_FILES) {
    assert(fs.existsSync(path.join(absoluteScenarioPath, requiredFile)), scenarioPath, `missing required file ${requiredFile}`);
  }

  const metadata = readJson(path.join(absoluteScenarioPath, 'metadata.json'), scenarioPath);
  const transcript = readJson(path.join(absoluteScenarioPath, 'transcript.json'), scenarioPath);
  const rubric = readJson(path.join(absoluteScenarioPath, 'rubric.json'), scenarioPath);

  validateMetadata(metadata, stageNumber, scenarioDirName, scenarioPath);
  validateTranscript(transcript, scenarioPath);
  validateRubric(rubric, metadata, scenarioPath);

  const variantsDir = path.join(absoluteScenarioPath, VARIANTS_DIR_NAME);
  if (fs.existsSync(variantsDir) && fs.statSync(variantsDir).isDirectory()) {
    for (const variantFile of fs.readdirSync(variantsDir).sort()) {
      if (!variantFile.endsWith('.json')) continue;
      const variantPath = path.join(variantsDir, variantFile);
      const variantTranscript = readJson(variantPath, `${scenarioPath}/${VARIANTS_DIR_NAME}/${variantFile}`);
      validateTranscript(variantTranscript, `${scenarioPath}/${VARIANTS_DIR_NAME}/${variantFile}`);
    }
  }

  scenarioCount += 1;
}

function main() {
  assert(fs.existsSync(SCENARIOS_ROOT), 'repo', 'scenarios directory is missing');
  if (!fs.existsSync(SCENARIOS_ROOT)) process.exit(1);

  for (const stageDirName of fs.readdirSync(SCENARIOS_ROOT).sort()) {
    const stagePath = path.join(SCENARIOS_ROOT, stageDirName);
    if (!fs.statSync(stagePath).isDirectory()) continue;
    if (!/^stage\d+$/.test(stageDirName)) continue;

    for (const scenarioDirName of fs.readdirSync(stagePath).sort()) {
      const scenarioPath = path.join(stagePath, scenarioDirName);
      if (!fs.statSync(scenarioPath).isDirectory()) continue;
      validateScenario(stageDirName, scenarioDirName);
    }
  }

  if (errorCount > 0) {
    console.error(`\nValidation failed: ${errorCount} issue(s) across ${scenarioCount} scenario(s).`);
    process.exit(1);
  }

  console.log(`Validated ${scenarioCount} scenario(s) successfully.`);
}

main();
