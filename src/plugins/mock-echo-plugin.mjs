function summarizePrompt(prompt) {
  const compact = prompt.replace(/\s+/g, ' ').trim();
  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
}

export default {
  id: 'mock-echo-plugin',

  async describe() {
    return {
      schemaVersion: 'omats.plugin.v1',
      provider: 'mock',
      model: 'echo-subject',
      supportsTools: true,
      supportsStreaming: false,
      supportsSystemPrompt: true
    };
  },

  async createSession(input) {
    const pendingTurns = [];

    return {
      async deliver(event) {
        if (event.type === 'message' && typeof event.body === 'string' && event.body.includes('@subject')) {
          pendingTurns.push({
            from: 'agent:subject',
            kind: 'message',
            body: `[mock subject] ${summarizePrompt(event.body)}`,
            raw: {
              source_event_id: event.id,
              scenario_id: input.scenarioId
            },
            tool_calls: []
          });
        }

        if (event.type === 'tool-result') {
          pendingTurns.push({
            from: 'agent:subject',
            kind: 'message',
            body: `[mock subject] Observed tool result from ${event.tool}.`,
            raw: {
              source_event_id: event.id,
              tool: event.tool
            },
            tool_calls: []
          });
        }

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
