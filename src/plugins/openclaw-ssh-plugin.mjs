import { execFile } from 'child_process';

const NO_REPLY = '[[NO_REPLY]]';
const READY = '[[OMATS_READY]]';

function execSsh(host, command, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile('ssh', [host, command], { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
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

  throw new Error(`Unsupported event type: ${event.type}`);
}

function shellEscape(str) {
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

export function createOpenClawSshPlugin(options) {
  const {
    agentId,
    sshHost = 'family@localhost',
    openclawHome = '/Users/family/openclaw',
    timeoutSeconds = 60,
    thinking = 'minimal'
  } = options;

  if (!agentId) {
    throw new Error('createOpenClawSshPlugin requires agentId');
  }

  return {
    id: `openclaw-ssh:${agentId}`,

    async describe() {
      return {
        schemaVersion: 'omats.plugin.v1',
        provider: 'openclaw-ssh',
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
        const escapedMessage = shellEscape(message);
        const cmd = [
          `export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
          `export OPENCLAW_HOME=${shellEscape(openclawHome)}`,
          `openclaw agent --agent ${shellEscape(agentId)} --json --session-id ${shellEscape(sessionId)} --message ${escapedMessage} --timeout ${timeoutSeconds} --thinking ${thinking} 2>/dev/null`
        ].join(' && ');

        return execSsh(sshHost, cmd, timeoutSeconds * 1000 + 15000);
      }

      async function ensureBootstrapped() {
        if (bootstrapped) return;
        const response = await callAgent(buildBootstrapPrompt(input));
        const text = extractText(response);
        if (!text || !text.includes(READY)) {
          throw new Error(`Bootstrap failed: expected ${READY}, got ${text || '[empty]'}`);
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
