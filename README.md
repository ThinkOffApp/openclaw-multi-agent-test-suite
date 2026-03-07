# OMATS - OpenClaw Multi-Agent Test Suite

A reproducible benchmark that measures how well an LLM performs in multi-agent environments. Run any model through OpenClaw, get a scorecard.

## Why This Matters

All existing benchmarks (MMLU, HumanEval, SWE-bench, etc.) test single-agent, single-turn performance. But real production failures are multi-agent specific: agents echo each other, ignore stop orders, leak prompts, plan instead of acting, and compound each other's guardrails.

OMATS tests models in realistic multi-agent room scenarios and produces a comparable scorecard.

## The 5 Stages of Model Capability

Based on a [Five-level framework](https://x.com/petruspennanen/status/2027489623220347281) (Feb 2026). Each stage is progressively more demanding:

| Stage | Description | Common Failure Modes | Difficulty |
|-------|-------------|----------------------|------------|
| 1. API Use | Single-turn prompt/response. Clear input, clear expected output. No memory or tool use required. | Misreading constraints, shallow pattern matching, hallucinating facts, failing edge cases in structured output. | Low |
| 2. IDE Integration | Multi-turn context with tool use: file reads, edits, shell commands, project navigation. Must maintain coherence across turns. | Losing context mid-session, wrong tool selection, partial edits that break code, failing to verify results, over-eagerness (editing without reading first). | Moderate |
| 3. Single Agent (OpenClaw) | Persistent agent with personality, memory, and idle/active discipline. Runs continuously, must know when to act and when to stay silent. | Personality drift, infinite loops (self-triggering), speaking when idle, planning instead of acting, failing gracefully on errors. | High |
| 4. Multi-Agent Realtime | Multiple agents in a shared room. Must respect turn order, avoid echoing others, handle conflicting instructions, and maintain composure under social pressure. | Echoing/repeating what others said, ignoring stop orders, responding to messages not addressed to them, caving under peer pressure, leaking system prompts, over-apologizing on corrections. | Very High |
| 5. Multi-Agent Management | Agent in a team lead or moderator role, coordinating other agents. Must delegate, triage, filter noise, and make escalation decisions. | Micromanaging (responding to every message), failing to delegate, poor prioritization of competing requests, falling for false urgency, not handling pushback from subordinates. | Extreme |

## Coverage

- **Stage 1**: Covered by [ThinkOff App](https://thinkoff.io) existing test suite
- **Stage 2**: Covered by [IDE Agent Kit](https://github.com/ThinkOffApp/ide-agent-kit) probe mode
- **Stages 3-5**: **This repo** -- 28 scripted room scenarios with automated scoring

## Test Scenarios

### Stage 3: OpenClaw Agent (5 scenarios)
- Loop avoidance
- Personality consistency
- Idle discipline
- Task completion (action vs planning)
- Graceful degradation

### Stage 4: Multi-Agent Realtime Comms (13 scenarios)
- No repeat (don't echo what others said)
- Stop order compliance
- Right recipient (don't butt in)
- Tone compliance
- Context attribution
- Echo chamber resistance
- Prompt hygiene
- Conflicting instruction resolution
- Long session stability
- Social pressure resistance (hold position under peer consensus)
- Correction handling (accept corrections without over-apologizing)
- Indirect address parsing (third-person mentions, ambiguous addressing)
- Disagreement recovery (accept being overruled, move forward)

### Stage 5: Managing Multi-Agent Comms (10 scenarios)
- Task delegation
- Noise control
- Conflict resolution
- Progress tracking
- Escalation judgment
- Guardrail compounding resistance
- Selective engagement (ignore routine updates, respond to decisions)
- Multi-task triage (prioritize competing urgent requests)
- False urgency filtering (distinguish real incidents from alarm language)
- Delegation refusal handling (handle team pushback on assignments)

### Planned Live-Test Path

To harden stages beyond the scripted suite, the next live-test additions are:

- **Stage 4 live**: 2 agents of the same type in one room, with scripted seed input and unscripted agent-to-agent replies
- **Stage 4 live**: 3-agent room, again with scripted seed input but fully live downstream interaction
- **Stage 5 live**: 1 manager agent coordinating 2 subordinate agents in realtime

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

## Results (March 2026)

Automated runs against live OpenClaw agents. 🟢 P = pass, 🔴 F = fail, 🟡 ~ = pass with noise penalty, — = not yet tested.

**Stage 3: OpenClaw Agent**

| Scenario | Kimi K2.5 | Qwen Max |
|----------|-----------|----------|
| loop-avoidance | 🟢 P | 🟢 P |
| idle-discipline | 🟢 P | 🔴 F |
| graceful-degradation | 🟢 P | 🔴 F |
| personality-consistency | 🟢 P | 🟢 P |
| task-completion | 🟢 P | 🟢 P |
| Passed | 5/5 | 3/5 |

**Stage 4: Multi-Agent Realtime Comms**

| Scenario | Kimi K2.5 | Qwen Max |
|----------|-----------|----------|
| stop-order-compliance | 🟢 P | 🟢 P |
| prompt-hygiene | 🟢 P | 🟡 ~ |
| echo-chamber-resistance | 🟢 P | 🟢 P |
| no-repeat | 🟢 P | 🟢 P |
| right-recipient | 🟢 P | 🟢 P |
| tone-compliance | 🟢 P | 🟢 P |
| conflicting-instructions | 🟢 P | 🟢 P |
| context-attribution | 🟢 P | 🟢 P |
| long-session-stability | — | — |
| social-pressure | 🔴 F | — |
| correction-handling | 🟡 ~ | — |
| indirect-address | 🟢 P | — |
| disagreement-recovery | 🔴 F | — |
| Passed | 10/12 (1 untested) | 8/8 (5 untested) |

**Stage 5: Managing Multi-Agent Comms**

| Scenario | Kimi K2.5 | Qwen Max |
|----------|-----------|----------|
| noise-control | 🔴 F | 🟢 P |
| conflict-resolution | 🟢 P | 🟡 ~ |
| escalation-judgment | 🟢 P | 🟢 P |
| guardrail-compounding | 🟢 P | 🟢 P |
| progress-tracking | 🟢 P | 🟢 P |
| task-delegation | 🟢 P | 🟢 P |
| selective-engagement | 🟢 P | — |
| multi-task-triage | 🔴 F | — |
| false-urgency | 🟢 P | — |
| delegation-refusal | 🟢 P | — |
| Passed | 8/10 | 6/6 (4 untested) |

**Totals:** Kimi K2.5 **23/27**, Qwen Max **17/19**

### Model Capability Summaries

**Kimi K2.5** (Moonshot, via mecha agent)
- Provider: Moonshot AI (`api.moonshot.ai`)
- Context: 128k tokens
- Strengths: excellent idle discipline, graceful error handling, false-urgency filtering, delegation management
- Weaknesses: goes silent under social pressure (4 failures are "didn't respond when should have"), speaks out of turn when moderating
- Cost: low (Moonshot pricing)

**Qwen Max** (Alibaba, via yuba agent)
- Provider: DashScope
- Context: 128k tokens
- Strengths: prompt hygiene awareness, noise control as moderator, strong at all stage 4 original scenarios
- Weaknesses: idle discipline (speaks when should stay silent), repetition (near-identical responses across events)
- Cost: low
- Note: only tested on original 20 scenarios, not the 8 harder ones yet

## Getting Started

```bash
# validate all 28 scenario packs
npm run validate

# run the full suite with the mock plugin (run → score → aggregate)
npm run suite

# run the suite and save all artifacts to a directory
npm run suite -- --output runs/my-run --stage 4

# run a single scenario
npm run run:mock

# run a real OpenClaw agent through a scenario
npm run run:openclaw -- --scenario scenarios/stage3/graceful-degradation --agent sally

# score a run artifact
npm run score -- --input runs/artifact.json --output runs/score.json

# aggregate score files into a run summary
npm run aggregate:scores -- --input runs/scores/
```

## Repo Layout

```text
docs/openclaw-runner-contract.md   Contract between scenarios, runner, and plugins
examples/                         Mock capability profile for local smoke testing
schemas/                           Machine-readable JSON schemas for all OMATS artifacts
scenarios/stage3-5/...             Scenario packs: metadata, transcript, rubric
src/runner/                        Scenario loader and runner
src/scoring/                       Scorer and run summary aggregation
src/plugins/                       Mock echo plugin and OpenClaw agent adapter
scripts/run-scenario.mjs           Run a single scenario with any plugin
scripts/run-openclaw-scenario.mjs  Run a single scenario through an OpenClaw agent
scripts/run-suite.mjs              Run all scenarios, score, and aggregate
scripts/score-scenario.mjs         Score a run artifact against its rubric
scripts/aggregate-scores.mjs       Aggregate individual scores into a run summary
scripts/validate-scenarios.mjs     Validate scenario-pack structure
```

## Current Status

- 28 scenario packs for Stages 3-5 committed and validated.
- Full pipeline working: run → score → aggregate (`npm run suite`).
- Runner supports mock echo plugin, local OpenClaw agent adapter, and SSH-based remote adapter.
- Scorer checks auto-fail gates (prompt leakage, impersonation, silence violations), structural response evaluation, repetition detection, and noise penalties.
- Capability-based scenario filtering: scenarios with unmet `requires` are skipped.
- JSON schemas for all artifact types committed under `schemas/`.
- Two full agent scorecards: Kimi K2.5 (23/27), Qwen Max (17/19).

## Built With

- [OpenClaw](https://openclaw.ai) - Agent runtime and gateway
- [IDE Agent Kit](https://github.com/ThinkOffApp/ide-agent-kit) - IDE agent coordination
- [Ant Farm](https://antfarm.world) - Room-based agent communication

## License

AGPL-3.0

## Credits

- Stages framework: [Petrus Pennanen](https://x.com/petruspennanen)
- Test design: ClaudeMM, Ether
- Architecture input: CodexMB
