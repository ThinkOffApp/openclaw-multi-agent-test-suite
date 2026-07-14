import { execFile } from 'child_process';

const NO_REPLY = '[[NO_REPLY]]';
const READY = '[[OMATS_READY]]';

function execFileJson(file, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        if (error.code === 'ENOENT') {
          reject(new Error(
            `OpenClaw binary "${file}" not found on PATH. ` +
            'This runner drives a live OpenClaw agent and requires an OpenClaw install ' +
            '(see https://openclaw.ai). For a credential-free smoke run use "npm run suite" (mock plugin).'
          ));
          return;
        }
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (parseError) {
        parseError.stdout = stdout;
        parseError.stderr = stderr;
        reject(parseError);
      }
    });
  });
}

function sanitizeId(value) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-');
}

function extractText(result) {
  return (result?.result?.payloads || [])
    .map((payload) => payload.text || '')
    .filter(Boolean)
    .join('\n')
    .trim();
}

function buildBootstrapPrompt(input) {
  const participants = input.participants
    .map((participant) => `${participant.id} (${participant.role})`)
    .join(', ');

  return [
    `OMATS bootstrap for scenario ${input.scenarioId} (stage ${input.stage}).`,
    'You are the subject agent under test in a simulated multi-agent room.',
    `Scenario system prompt: ${input.initialInstructions || 'none'}`,
    `Participants: ${participants}`,
    'Protocol:',
    `- Future messages will be replayed one event at a time.`,
    `- When the correct room behavior is silence, reply with exactly ${NO_REPLY}.`,
    '- When the correct room behavior is speaking, reply with only the exact room message that agent:subject would post.',
    '- Do not add narration, tool traces, or analysis outside the room reply itself.',
    `Reply with exactly ${READY} to confirm bootstrap.`
  ].join('\n');
}

function formatEvent(event) {
  if (event.type === 'message') {
    return [
      `OMATS room event ${event.id}`,
      `from: ${event.from}`,
      'type: message',
      `body: ${event.body}`
    ].join('\n');
  }

  if (event.type === 'tool-result') {
    return [
      `OMATS room event ${event.id}`,
      'type: tool-result',
      `tool: ${event.tool}`,
      `result: ${JSON.stringify(event.result)}`
    ].join('\n');
  }

  throw new Error(`Unsupported OpenClaw adapter event type: ${event.type}`);
}

export function createOpenClawAgentPlugin(options) {
  const {
    agentId,
    binary = 'openclaw',
    local = false,
    timeoutSeconds = 60,
    thinking = 'minimal'
  } = options;

  if (!agentId) {
    throw new Error('createOpenClawAgentPlugin requires agentId');
  }

  return {
    id: `openclaw-agent:${agentId}`,

    async describe() {
      return {
        schemaVersion: 'omats.plugin.v1',
        provider: 'openclaw-agent',
        model: agentId,
        supportsTools: true,
        supportsStreaming: false,
        supportsSystemPrompt: true
      };
    },

    async createSession(input) {
      const sessionId = `omats-${sanitizeId(input.scenarioId)}-${Date.now()}`;
      let bootstrapped = false;

      async function callAgent(message) {
        const args = [
          'agent',
          '--agent', agentId,
          '--json',
          '--session-id', sessionId,
          '--message', message,
          '--timeout', String(timeoutSeconds),
          '--thinking', thinking
        ];

        if (local) {
          args.push('--local');
        }

        return execFileJson(binary, args, timeoutSeconds * 1000 + 5000);
      }

      async function ensureBootstrapped() {
        if (bootstrapped) return;
        const response = await callAgent(buildBootstrapPrompt(input));
        const text = extractText(response);
        if (!text || !text.includes(READY)) {
          throw new Error(`OpenClaw bootstrap failed: expected ${READY}, got ${text || '[empty]'}`);
        }
        bootstrapped = true;
      }

      const pendingTurns = [];

      return {
        async deliver(event) {
          await ensureBootstrapped();
          const response = await callAgent(formatEvent(event));
          const text = extractText(response);

          if (!text || text === NO_REPLY) {
            return [];
          }

          pendingTurns.push({
            from: 'agent:subject',
            kind: 'message',
            body: text,
            raw: response,
            tool_calls: []
          });

          return [];
        },

        async flush() {
          return pendingTurns.splice(0, pendingTurns.length);
        },

        async close() {
          pendingTurns.splice(0, pendingTurns.length);
        }
      };
    }
  };
}
