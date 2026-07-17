// Direct Anthropic (Claude) plugin for OMATS. Matches the omats.plugin.v1
// contract used by the other direct plugins (openai/xai/gemini/...). The
// Messages API takes the system prompt as a top-level field rather than a
// system-role message, so the OMATS bootstrap prompt is sent as the first
// USER turn (same as the other plugins) and the scenario's initial
// instructions ride inside it — no behavioural difference from the subject's
// point of view.

const NO_REPLY = '[[NO_REPLY]]';
const READY = '[[OMATS_READY]]';

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

async function callAnthropic(messages, modelId, apiKey, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        // temperature is omitted: newer Claude models (Fable 5+) reject it as
        // deprecated, and the default is fine for a determinism-oriented eval.
        model: modelId,
        max_tokens: 2048,
        messages
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${text}`);
    }

    const data = await response.json();
    // Concatenate text blocks; ignore any non-text blocks the model emits.
    const text = Array.isArray(data.content)
      ? data.content.filter((block) => block.type === 'text').map((block) => block.text).join('')
      : '';
    return text.trim();
  } finally {
    clearTimeout(timer);
  }
}

export function createAnthropicPlugin(options) {
  const {
    modelId,
    apiKey,
    timeoutMs = 60000
  } = options;

  if (!modelId) throw new Error('createAnthropicPlugin requires modelId');
  if (!apiKey) throw new Error('createAnthropicPlugin requires apiKey');

  return {
    id: `anthropic:${modelId}`,

    async describe() {
      return {
        schemaVersion: 'omats.plugin.v1',
        provider: 'anthropic',
        model: modelId,
        supportsTools: false,
        supportsStreaming: false,
        supportsSystemPrompt: true
      };
    },

    async createSession(input) {
      const conversationHistory = [];
      let bootstrapped = false;

      async function chat(userMessage) {
        conversationHistory.push({ role: 'user', content: userMessage });
        const text = await callAnthropic(conversationHistory, modelId, apiKey, timeoutMs);
        // The Messages API rejects an empty assistant turn, and a subsequent
        // user turn cannot follow an empty assistant turn; store a sentinel so
        // the alternating-role invariant holds even when the model stays silent.
        conversationHistory.push({ role: 'assistant', content: text || NO_REPLY });
        return text;
      }

      async function ensureBootstrapped() {
        if (bootstrapped) return;
        const text = await chat(buildBootstrapPrompt(input));
        if (!text || !text.includes(READY)) {
          throw new Error(`Bootstrap failed: expected ${READY}, got ${text || '[empty]'}`);
        }
        bootstrapped = true;
      }

      const pendingTurns = [];

      return {
        async deliver(event) {
          await ensureBootstrapped();
          const text = await chat(formatEvent(event));

          if (!text || text === NO_REPLY) {
            return [];
          }

          pendingTurns.push({
            from: 'agent:subject',
            kind: 'message',
            body: text,
            raw: { model: modelId, text },
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
