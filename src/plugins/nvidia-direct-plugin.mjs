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

async function callNvidia(messages, modelId, apiKey, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: modelId,
        messages,
        max_tokens: 2048,
        temperature: 0.7
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`NVIDIA API error ${response.status}: ${text}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
  } finally {
    clearTimeout(timer);
  }
}

export function createNvidiaPlugin(options) {
  const {
    modelId,
    apiKey = process.env.NVIDIA_API_KEY,
    timeoutMs = 60000
  } = options;

  if (!modelId) {
    throw new Error('createNvidiaPlugin requires modelId');
  }
  if (!apiKey) {
    throw new Error('createNvidiaPlugin requires apiKey (pass apiKey or set NVIDIA_API_KEY)');
  }

  return {
    id: `nvidia:${modelId}`,

    async describe() {
      return {
        schemaVersion: 'omats.plugin.v1',
        provider: 'nvidia',
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
        const text = await callNvidia(conversationHistory, modelId, apiKey, timeoutMs);
        conversationHistory.push({ role: 'assistant', content: text });
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
