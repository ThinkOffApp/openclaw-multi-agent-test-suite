# OMATS - OpenClaw Multi-Agent Test Suite

A reproducible benchmark that measures how well an LLM performs in multi-agent environments. Run any model through OpenClaw, get a scorecard.

## Why This Matters

All existing benchmarks (MMLU, HumanEval, SWE-bench, etc.) test single-agent, single-turn performance. But real production failures are multi-agent specific: agents echo each other, ignore stop orders, leak prompts, plan instead of acting, and compound each other's guardrails.

OMATS tests models in realistic multi-agent room scenarios and produces a comparable scorecard.

## The 5 Stages of Model Capability

Based on the [Petrus Pennanen framework](https://x.com/petruspennanen/status/2027489623220347281) (Feb 2026). Each stage is progressively more demanding:

| Stage | Name | Description |
|-------|------|-------------|
| 1 | API Use | Pretty easy to sound sensible in a single API call |
| 2 | IDE Integration | More demanding. Multi-turn context, tool use, file operations |
| 3 | OpenClaw Agent | Sensible personality, avoids loops, much more demanding |
| 4 | Multi-Agent Realtime Comms | Avoiding loops, right tone, turn discipline |
| 5 | Managing Multi-Agent Comms | Agent in team management role, most demanding |

## Coverage

- **Stage 1**: Covered by [ThinkOff App](https://thinkoff.io) existing test suite
- **Stage 2**: Covered by [IDE Agent Kit](https://github.com/ThinkOffApp/ide-agent-kit) probe mode
- **Stages 3-5**: **This repo** -- 20 scripted room scenarios with automated scoring

## Test Scenarios

### Stage 3: OpenClaw Agent (5 scenarios)
- Loop avoidance
- Personality consistency
- Idle discipline
- Task completion (action vs planning)
- Graceful degradation

### Stage 4: Multi-Agent Realtime Comms (9 scenarios)
- No repeat (don't echo what others said)
- Stop order compliance
- Right recipient (don't butt in)
- Tone compliance
- Context attribution
- Echo chamber resistance
- Prompt hygiene
- Conflicting instruction resolution
- Long session stability

### Stage 5: Managing Multi-Agent Comms (6 scenarios)
- Task delegation
- Noise control
- Conflict resolution
- Progress tracking
- Escalation judgment
- Guardrail compounding resistance

## Scoring

- Per scenario: **PASS (1) / FAIL (0)** + noise penalty (0 to -2)
- Three dimensions: **Comprehension**, **Discipline**, **Execution**
- Auto-fail gates: prompt leakage, forbidden actions, posting when told to be silent

## Architecture

Each test scenario consists of:
1. A **room transcript** (scripted human + agent messages)
2. A **scoring rubric** (what counts as pass/fail)
3. The model under test as the **only live participant**

The test runner creates simulated OpenClaw rooms, plays the scripted messages, captures the model's responses, and scores them against the rubric.

## Early Results (Informal)

From running a 9-agent fleet daily on one Mac mini:

| Model | Stage 3 | Stage 4 | Stage 5 |
|-------|---------|---------|---------|
| Claude Opus 4.6 | Pass | Pass | Pass (but expensive) |
| GPT-5.2 | Pass | Partial (prompt leaks) | Untested |
| Qwen Max | Partial (loops) | Fail (echo, ignores stops) | - |
| Kimi K2.5 | Untested | Untested | - |

## Getting Started

```bash
# Coming soon
npm install -g openclaw-multi-agent-test-suite
omats run --model <provider/model-name>
```

## Built With

- [OpenClaw](https://openclaw.ai) - Agent runtime and gateway
- [IDE Agent Kit](https://github.com/ThinkOffApp/ide-agent-kit) - IDE agent coordination
- [Ant Farm](https://antfarm.world) - Room-based agent communication

## License

MIT

## Credits

- Stages framework: [Petrus Pennanen](https://x.com/petruspennanen)
- Test design: ClaudeMM, Ether
- Architecture input: CodexMB
