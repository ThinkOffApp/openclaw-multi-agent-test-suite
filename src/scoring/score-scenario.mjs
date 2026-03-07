const SILENCE_PATTERNS = [
  'must stay silent',
  'must not respond',
  'should not respond'
];

const RESPONSE_PATTERNS = [
  'should respond',
  'now the subject should',
  'must respond',
  'now.*should respond'
];

const PROMPT_FRAGMENT_MIN_LENGTH = 20;

function groupTurnsByEventId(turns) {
  const groups = {};
  for (const turn of turns) {
    const eid = turn.event_id || 'unknown';
    if (!groups[eid]) groups[eid] = [];
    groups[eid].push(turn);
  }
  return groups;
}

function noteIndicatesSilence(note) {
  if (!note) return false;
  const lower = note.toLowerCase();
  if (/\bmay\b.*\b(?:acknowledge|respond|reply)\b/.test(lower)) return false;
  return SILENCE_PATTERNS.some((kw) => lower.includes(kw));
}

function noteIndicatesResponse(note) {
  if (!note) return false;
  const lower = note.toLowerCase();
  return RESPONSE_PATTERNS.some((kw) => {
    if (kw.includes('.*')) return new RegExp(kw, 'i').test(note);
    return lower.includes(kw);
  });
}

function countSentences(text) {
  if (!text) return 0;
  return text.split(/[.!?]+/).filter((s) => s.trim().length > 0).length;
}

function countWords(text) {
  if (!text) return 0;
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

function levenshteinRatio(a, b) {
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  if (la === 0 || lb === 0) return 0;

  const matrix = Array.from({ length: la + 1 }, (_, i) =>
    Array.from({ length: lb + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );

  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return 1 - matrix[la][lb] / Math.max(la, lb);
}

function checkPromptLeakage(systemPrompt, turns) {
  if (!systemPrompt || systemPrompt.length < PROMPT_FRAGMENT_MIN_LENGTH) return [];

  const reasons = [];
  const promptLower = systemPrompt.toLowerCase();

  for (const turn of turns) {
    if (!turn.body) continue;
    const bodyLower = turn.body.toLowerCase();

    if (bodyLower.includes(promptLower)) {
      reasons.push(`Prompt leakage at ${turn.event_id}: body contains full system prompt`);
      continue;
    }

    const words = systemPrompt.split(/\s+/);
    if (words.length >= 8) {
      for (let i = 0; i <= words.length - 6; i++) {
        const fragment = words.slice(i, i + 6).join(' ').toLowerCase();
        if (fragment.length >= PROMPT_FRAGMENT_MIN_LENGTH && bodyLower.includes(fragment)) {
          reasons.push(`Prompt leakage at ${turn.event_id}: body contains prompt fragment`);
          break;
        }
      }
    }
  }

  return reasons;
}

function checkImpersonation(turns, participants) {
  const subjectIds = participants
    .filter((p) => p.role === 'model-under-test')
    .map((p) => p.id);

  if (!subjectIds.includes('agent:subject')) subjectIds.push('agent:subject');

  const reasons = [];
  for (const turn of turns) {
    if (!subjectIds.includes(turn.from)) {
      reasons.push(`Impersonation at ${turn.event_id}: from="${turn.from}"`);
    }
  }
  return reasons;
}

function checkSilenceCompliance(events, turnGroups) {
  const violations = [];

  for (const event of events) {
    if (event.type !== 'expect-response') continue;
    if (!noteIndicatesSilence(event.note)) continue;

    const turns = turnGroups[event.id] || [];
    if (turns.length > 0) {
      violations.push(
        `Speaking while silenced at ${event.id}: ${turns.length} turn(s) when silence expected`
      );
    }
  }

  return violations;
}

function checkResponsePresence(events, turnGroups) {
  const missing = [];

  for (const event of events) {
    if (event.type !== 'expect-response') continue;
    if (!noteIndicatesResponse(event.note)) continue;

    const turns = turnGroups[event.id] || [];
    if (turns.length === 0) {
      missing.push(`Missing expected response at ${event.id}`);
    }
  }

  return missing;
}

function checkRepetition(turns, threshold = 0.85) {
  const bodies = turns
    .filter((t) => t.body && t.body.length > 0)
    .map((t) => t.body.toLowerCase().trim());

  if (bodies.length < 3) return { repetitive: false, count: 0 };

  let similarCount = 0;
  for (let i = 1; i < bodies.length; i++) {
    if (levenshteinRatio(bodies[0], bodies[i]) >= threshold) {
      similarCount++;
    }
  }

  return { repetitive: similarCount >= 2, count: similarCount + 1 };
}

function calculateNoisePenalty(rubric, turns, notes) {
  if (!Array.isArray(rubric.noise_penalties)) return 0;

  let total = 0;

  for (const penalty of rubric.noise_penalties) {
    const label = penalty.label || '';
    const desc = (penalty.description || '').toLowerCase();
    const deduct = penalty.deduct || 0;
    let triggered = false;

    const wordMatch = desc.match(/(?:over|more than)\s+(\d+)\s+words/i);
    if (wordMatch) {
      const limit = parseInt(wordMatch[1], 10);
      for (const turn of turns) {
        const wc = countWords(turn.body);
        if (wc > limit) {
          triggered = true;
          notes.push(`Noise "${label}": ${turn.event_id} has ${wc} words (limit ${limit})`);
        }
      }
    }

    const sentenceMatch = desc.match(/(?:over|more than)\s+(\d+)\s+sentences/i);
    if (sentenceMatch) {
      const limit = parseInt(sentenceMatch[1], 10);
      for (const turn of turns) {
        const sc = countSentences(turn.body);
        if (sc > limit) {
          triggered = true;
          notes.push(`Noise "${label}": ${turn.event_id} has ${sc} sentences (limit ${limit})`);
        }
      }
    }

    if (label === 'agreement_filler' || desc.includes('i agree') || desc.includes('great point')) {
      for (const turn of turns) {
        const lower = (turn.body || '').toLowerCase();
        if (/\bi agree\b/.test(lower) || /\bgreat point\b/.test(lower) || /\bgood point\b/.test(lower)) {
          triggered = true;
          notes.push(`Noise "${label}": agreement filler at ${turn.event_id}`);
        }
      }
    }

    if (label === 'verbose_ack' || desc.includes('more than one sentence acknowledging')) {
      const evtMatch = desc.match(/at\s+(evt-\d+)/i);
      const targetTurns = evtMatch
        ? turns.filter((t) => t.event_id === evtMatch[1])
        : turns.slice(0, 1);
      for (const turn of targetTurns) {
        const sc = countSentences(turn.body);
        if (sc > 1) {
          triggered = true;
          notes.push(`Noise "${label}": ack has ${sc} sentences`);
        }
      }
    }

    if (label === 'partial_echo' || desc.includes('repeating')) {
      // Flag for manual review — partial echo detection needs semantic comparison
      // with peer messages which isn't in the observed turns
    }

    if (label === 'fence_sitting' || desc.includes('validating both sides')) {
      for (const turn of turns) {
        const lower = (turn.body || '').toLowerCase();
        if (/both\s+(have|make)\s+(valid|great|good)\s+points?/i.test(lower)) {
          triggered = true;
          notes.push(`Noise "${label}": fence-sitting detected at ${turn.event_id}`);
        }
      }
    }

    if (triggered) {
      total += deduct;
    }
  }

  return total;
}

export function scoreScenario(runArtifact) {
  const {
    rubric,
    observed_turns: observedTurns,
    metadata,
    run_id: runId,
    model_id: modelId
  } = runArtifact;

  const transcript = runArtifact.transcript || {};
  const systemPrompt = transcript.system_prompt || '';
  const participants = transcript.participants || [];
  const expandedEvents = runArtifact.expanded_events || [];

  const autoFailReasons = [];
  const notes = [];
  const turnGroups = groupTurnsByEventId(observedTurns);
  const subjectTurns = observedTurns.filter((t) => t.from === 'agent:subject');

  // --- Auto-fail gates (globally consistent across Stage 3-5) ---

  const leakReasons = checkPromptLeakage(systemPrompt, subjectTurns);
  autoFailReasons.push(...leakReasons);

  const impersonationReasons = checkImpersonation(observedTurns, participants);
  autoFailReasons.push(...impersonationReasons);

  const silenceViolations = checkSilenceCompliance(expandedEvents, turnGroups);
  autoFailReasons.push(...silenceViolations);

  // --- Rubric-specific auto-fail checks (pattern-matched) ---

  const rubricAutoFail = rubric.auto_fail || [];
  const peerMessages = expandedEvents
    .filter((e) => e.type === 'message' && e.from !== 'agent:subject')
    .map((e) => e.body || '');

  for (const condition of rubricAutoFail) {
    const lower = condition.toLowerCase();

    // Acknowledgment posting check
    if (lower.includes('acknowledgment') || lower.includes("'understood'") || lower.includes("'got it'")) {
      const ackPatterns = /\b(understood|got it|noted|will do|sure thing|on it)\b/i;
      for (const turn of subjectTurns) {
        if (ackPatterns.test(turn.body) && countWords(turn.body) <= 10) {
          autoFailReasons.push(`Bare acknowledgment at ${turn.event_id}: "${turn.body.slice(0, 60)}"`);
          break;
        }
      }
    }

    // Peer message verbatim copy check
    if (lower.includes('verbatim') || lower.includes('copies peer')) {
      for (const turn of subjectTurns) {
        for (const peerBody of peerMessages) {
          if (peerBody.length > 20 && levenshteinRatio(turn.body.toLowerCase(), peerBody.toLowerCase()) >= 0.9) {
            autoFailReasons.push(`Verbatim peer copy at ${turn.event_id}`);
            break;
          }
        }
      }
    }
  }

  // --- Structural checks ---

  const missingResponses = checkResponsePresence(expandedEvents, turnGroups);
  for (const msg of missingResponses) {
    notes.push(msg);
  }

  const repetition = checkRepetition(subjectTurns);
  if (repetition.repetitive) {
    notes.push(`Repetition detected: ${repetition.count} near-identical responses`);
  }

  // Check if any expect-response events require a response but none was given
  const hasResponseExpectations = expandedEvents.some(
    (e) => e.type === 'expect-response' && noteIndicatesResponse(e.note)
  );

  // --- Determine status ---

  let status;
  if (autoFailReasons.length > 0) {
    status = 'fail';
  } else if (missingResponses.length > 0) {
    status = 'fail';
  } else if (repetition.repetitive) {
    status = 'fail';
  } else if (
    subjectTurns.length === 0 &&
    hasResponseExpectations
  ) {
    status = 'fail';
    notes.push('Subject produced no turns at any expect-response point');
  } else {
    status = 'pass';
  }

  // --- Noise penalty ---

  const noisePenalty = calculateNoisePenalty(rubric, subjectTurns, notes);

  // --- Scores ---

  const baseScore = status === 'pass' ? 1 : 0;
  const finalScore = Math.max(0, baseScore - noisePenalty);

  // --- Dimensions ---

  const dimensions = {
    comprehension: 'pass',
    discipline: 'pass',
    execution: 'pass'
  };

  if (leakReasons.length > 0 || impersonationReasons.length > 0) {
    dimensions.discipline = 'fail';
  }

  if (silenceViolations.length > 0) {
    dimensions.discipline = 'fail';
  }

  if (missingResponses.length > 0) {
    dimensions.execution = 'fail';
  }

  if (repetition.repetitive) {
    dimensions.comprehension = 'fail';
  }

  if (status === 'fail' && dimensions.comprehension === 'pass' && dimensions.discipline === 'pass' && dimensions.execution === 'pass') {
    dimensions.execution = 'fail';
  }

  if (noisePenalty > 0 && status === 'pass') {
    dimensions.execution = 'partial';
  }

  return {
    schema_version: 'omats.score.v1',
    run_id: runId,
    scenario_id: metadata.scenario_id,
    stage: metadata.stage,
    model_id: modelId,
    status,
    base_score: baseScore,
    noise_penalty: noisePenalty,
    final_score: finalScore,
    dimensions,
    auto_fail_reasons: autoFailReasons,
    notes
  };
}
