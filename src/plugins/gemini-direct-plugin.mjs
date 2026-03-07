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

// Global pacing: ensure at least 2.8s between calls to stay under 25 RPM
let lastCallTime = 0;
const MIN_CALL_INTERVAL_MS = 2800;

async function callGemini(contents, modelId, apiKey, timeoutMs, maxRetries = 8) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Pace requests globally
    const now = Date.now();
    const elapsed = now - lastCallTime;
    if (elapsed < MIN_CALL_INTERVAL_MS) {
      await new Promise(r => setTimeout(r, MIN_CALL_INTERVAL_MS - elapsed));
    }
    lastCallTime = Date.now();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: {
            maxOutputTokens: 2048,
            temperature: 0.7
          }
        }),
        signal: controller.signal
      });

      if (response.status === 429 && attempt < maxRetries) {
        clearTimeout(timer);
        const errText = await response.text();
        // Check if it's a daily quota (hours-long wait) vs per-minute
        const dailyMatch = errText.match(/per_day|per_model_per_day/);
        const retryMatch = errText.match(/"retryDelay":\s*"(\d+)s"/);
        let waitSec;
        if (dailyMatch) {
          // Daily quota exhausted - parse exact delay or default to retryDelay
          waitSec = retryMatch ? Math.min(parseInt(retryMatch[1], 10) + 5, 86400) : 3600;
          process.stderr.write(`    [DAILY-LIMIT] waiting ${Math.round(waitSec/60)}min (attempt ${attempt + 1}/${maxRetries})...\n`);
        } else {
          // Per-minute rate limit
          waitSec = retryMatch ? parseInt(retryMatch[1], 10) + 3 : 35;
          process.stderr.write(`    [rate-limit] waiting ${waitSec}s (attempt ${attempt + 1}/${maxRetries})...\n`);
        }
        await new Promise(r => setTimeout(r, waitSec * 1000));
        continue;
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Gemini API error ${response.status}: ${text}`);
      }

      const data = await response.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error('Gemini API: max retries exceeded for rate limit');
}

export function createGeminiPlugin(options) {
  const {
    modelId,
    apiKey,
    timeoutMs = 60000
  } = options;

  if (!modelId) throw new Error('createGeminiPlugin requires modelId');
  if (!apiKey) throw new Error('createGeminiPlugin requires apiKey');

  return {
    id: `gemini:${modelId}`,

    async describe() {
      return {
        schemaVersion: 'omats.plugin.v1',
        provider: 'gemini',
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
        conversationHistory.push({ role: 'user', parts: [{ text: userMessage }] });
        const text = await callGemini(conversationHistory, modelId, apiKey, timeoutMs);
        conversationHistory.push({ role: 'model', parts: [{ text }] });
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
