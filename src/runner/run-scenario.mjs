import { loadScenarioPack } from './load-scenario.mjs';

function normalizeObservedTurn(turn, scenarioId, eventId) {
  return {
    schema_version: 'omats.turn.v1',
    scenario_id: scenarioId,
    event_id: turn.event_id || eventId,
    from: turn.from || 'agent:subject',
    kind: turn.kind || 'message',
    body: typeof turn.body === 'string' ? turn.body : '',
    raw: turn.raw && typeof turn.raw === 'object' ? turn.raw : {},
    tool_calls: Array.isArray(turn.tool_calls) ? turn.tool_calls : []
  };
}

export async function runScenario({
  repoRoot,
  scenarioPath,
  plugin,
  capabilityProfile,
  runId
}) {
  const pack = loadScenarioPack(repoRoot, scenarioPath);
  const descriptor = await plugin.describe();
  const session = await plugin.createSession({
    scenarioId: pack.metadata.scenario_id,
    stage: pack.metadata.stage,
    capabilityProfile,
    participants: pack.transcript.participants,
    initialInstructions: pack.transcript.system_prompt || ''
  });

  const observedTurns = [];
  const replayLog = [];

  for (const event of pack.expandedEvents) {
    replayLog.push({
      event_id: event.id,
      type: event.type,
      source_event_id: event.source_event_id || null,
      synthetic: event.synthetic === true
    });

    if (event.type === 'expect-response') {
      const flushed = await session.flush();
      observedTurns.push(...(flushed || []).map((turn) => normalizeObservedTurn(turn, pack.metadata.scenario_id, event.id)));
      continue;
    }

    const delivered = await session.deliver(event);
    observedTurns.push(...(delivered || []).map((turn) => normalizeObservedTurn(turn, pack.metadata.scenario_id, event.id)));
  }

  const trailingTurns = await session.flush();
  observedTurns.push(...(trailingTurns || []).map((turn) => normalizeObservedTurn(turn, pack.metadata.scenario_id, 'flush-final')));
  await session.close();

  return {
    schema_version: 'omats.run-artifact.v1',
    run_id: runId,
    scenario_id: pack.metadata.scenario_id,
    stage: pack.metadata.stage,
    model_id: capabilityProfile.model_id,
    plugin: {
      id: plugin.id,
      descriptor
    },
    capability_profile: capabilityProfile,
    metadata: pack.metadata,
    rubric: pack.rubric,
    replay_log: replayLog,
    observed_turns: observedTurns
  };
}
