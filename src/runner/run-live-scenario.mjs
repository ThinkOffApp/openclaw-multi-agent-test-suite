import fs from 'fs';
import path from 'path';

function normalizeObservedTurn(turn, scenarioId, roundNum) {
  return {
    schema_version: 'omats.turn.v1',
    scenario_id: scenarioId,
    event_id: `round-${String(roundNum).padStart(3, '0')}`,
    from: turn.from || 'unknown',
    kind: turn.kind || 'message',
    body: typeof turn.body === 'string' ? turn.body : '',
    raw: turn.raw && typeof turn.raw === 'object' ? turn.raw : {},
    tool_calls: Array.isArray(turn.tool_calls) ? turn.tool_calls : []
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Run a live multi-agent scenario where multiple real agents
 * interact with each other. A seed message kicks off the conversation,
 * and each agent's responses are delivered to all other agents.
 *
 * @param {Object} options
 * @param {string} options.repoRoot - repo root path
 * @param {string} options.scenarioPath - path to live scenario dir
 * @param {Object[]} options.agents - array of {id, plugin, capabilityProfile}
 * @param {number} [options.maxRounds=10] - max conversation rounds
 * @param {string} options.runId - run identifier
 */
export async function runLiveScenario({
  repoRoot,
  scenarioPath,
  agents,
  maxRounds = 10,
  runId
}) {
  const scenarioDir = path.resolve(repoRoot, scenarioPath);
  const metadata = readJson(path.join(scenarioDir, 'metadata.json'));
  const config = readJson(path.join(scenarioDir, 'config.json'));

  const seedMessage = config.seed_message;
  const systemPrompts = config.system_prompts || {};
  const participants = agents.map((a) => ({
    id: a.id,
    role: 'model-under-test'
  }));

  if (config.human) {
    participants.unshift({ id: config.human.id || 'human:owner', role: 'human' });
  }

  // Bootstrap all agent sessions
  const sessions = {};
  for (const agent of agents) {
    const session = await agent.plugin.createSession({
      scenarioId: metadata.scenario_id,
      stage: metadata.stage,
      capabilityProfile: agent.capabilityProfile,
      participants,
      initialInstructions: systemPrompts[agent.id] || config.default_system_prompt || ''
    });
    sessions[agent.id] = { session, plugin: agent.plugin, id: agent.id };
  }

  const observedTurns = [];
  const conversationLog = [];
  let round = 0;

  // Deliver seed message to all agents
  const seedEvent = {
    id: 'seed',
    type: 'message',
    from: config.human?.id || 'human:owner',
    body: seedMessage
  };

  conversationLog.push({
    round: 0,
    from: seedEvent.from,
    body: seedEvent.body,
    type: 'seed'
  });

  for (const agent of agents) {
    await sessions[agent.id].session.deliver(seedEvent);
  }

  // Conversation loop
  for (round = 1; round <= maxRounds; round++) {
    const roundResponses = [];

    // Flush all agents to get their responses
    for (const agent of agents) {
      const flushed = await sessions[agent.id].session.flush();
      if (flushed && flushed.length > 0) {
        for (const turn of flushed) {
          const normalized = normalizeObservedTurn(turn, metadata.scenario_id, round);
          observedTurns.push(normalized);
          roundResponses.push({
            from: agent.id,
            body: turn.body,
            raw: turn.raw
          });
          conversationLog.push({
            round,
            from: agent.id,
            body: turn.body,
            type: 'response'
          });
        }
      }
    }

    // If no agent responded this round, conversation is over
    if (roundResponses.length === 0) {
      conversationLog.push({ round, type: 'silence', note: 'No agent responded' });
      break;
    }

    // Deliver each response to all OTHER agents
    for (const response of roundResponses) {
      const event = {
        id: `live-r${round}`,
        type: 'message',
        from: response.from,
        body: response.body
      };

      for (const agent of agents) {
        if (agent.id !== response.from) {
          await sessions[agent.id].session.deliver(event);
        }
      }
    }
  }

  // Close all sessions
  for (const agent of agents) {
    await sessions[agent.id].session.close();
  }

  return {
    schema_version: 'omats.live-run.v1',
    run_id: runId,
    scenario_id: metadata.scenario_id,
    stage: metadata.stage,
    mode: 'live-multi-agent',
    agents: agents.map((a) => ({
      id: a.id,
      model_id: a.capabilityProfile.model_id
    })),
    config: {
      max_rounds: maxRounds,
      seed_message: seedMessage,
      actual_rounds: round
    },
    metadata,
    conversation_log: conversationLog,
    observed_turns: observedTurns
  };
}
