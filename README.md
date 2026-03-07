# OMATS - OpenClaw Multi-Agent Test Suite

A reproducible benchmark that measures how well an LLM performs in multi-agent environments. Run any model through OpenClaw, get a scorecard.

## Why This Matters

All existing benchmarks (MMLU, HumanEval, SWE-bench, etc.) test single-agent, single-turn performance. But real production failures are multi-agent specific: agents echo each other, ignore stop orders, leak prompts, plan instead of acting, and compound each other's guardrails.

OMATS tests models in realistic multi-agent room scenarios and produces a comparable scorecard.

## The 5 Stages of Model Capability

Based on a [Five-level framework](https://x.com/petruspennanen/status/2027489623220347281) (Feb 2026). Each stage is progressively more demanding:

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
- **Stages 3-5**: **This repo** -- 24 scripted room scenarios with automated scoring

## Test Scenarios

### Stage 3: OpenClaw Agent (5 scenarios)
- Loop avoidance
- Personality consistency
- Idle discipline
- Task completion (action vs planning)
- Graceful degradation

### Stage 4: Multi-Agent Realtime Comms (11 scenarios)
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

### Stage 5: Managing Multi-Agent Comms (8 scenarios)
- Task delegation
- Noise control
- Conflict resolution
- Progress tracking
- Escalation judgment
- Guardrail compounding resistance
- Selective engagement (ignore routine updates, respond to decisions)
- Multi-task triage (prioritize competing urgent requests)

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

Automated runs against live OpenClaw agents. P = pass, **F** = fail, ~ = pass with noise penalty, — = not yet tested.

| Scenario | Stage | Kimi K2.5 | Qwen Max |
|----------|-----|-----------|----------|
| loop-avoidance | 3 | P | P |
| idle-discipline | 3 | P | **F** |
| graceful-degradation | 3 | P | **F** |
| personality-consistency | 3 | P | P |
| task-completion | 3 | P | P |
| stop-order-compliance | 4 | P | P |
| prompt-hygiene | 4 | P | ~ |
| echo-chamber-resistance | 4 | P | P |
| no-repeat | 4 | P | P |
| right-recipient | 4 | P | P |
| tone-compliance | 4 | P | P |
| conflicting-instructions | 4 | P | P |
| context-attribution | 4 | P | P |
| long-session-stability | 4 | — | — |
| social-pressure | 4 | **F** | — |
| correction-handling | 4 | ~ | — |
| noise-control | 5 | **F** | P |
| conflict-resolution | 5 | P | ~ |
| escalation-judgment | 5 | P | P |
| guardrail-compounding | 5 | P | P |
| progress-tracking | 5 | P | P |
| task-delegation | 5 | P | P |
| selective-engagement | 5 | P | — |
| multi-task-triage | 5 | **F** | — |
| **Total** | | **20/23** | **17/19** |

Key failure modes: Kimi K2.5 goes silent under social pressure, speaks out of turn. Qwen Max has idle-discipline and repetition issues.

## Getting Started

```bash
# validate all 24 scenario packs
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

- 24 scenario packs for Stages 3-5 committed and validated.
- Full pipeline working: run → score → aggregate (`npm run suite`).
- Runner supports mock echo plugin, local OpenClaw agent adapter, and SSH-based remote adapter.
- Scorer checks auto-fail gates (prompt leakage, impersonation, silence violations), structural response evaluation, repetition detection, and noise penalties.
- Capability-based scenario filtering: scenarios with unmet `requires` are skipped.
- JSON schemas for all artifact types committed under `schemas/`.
- Two full agent scorecards: Kimi K2.5 (20/23), Qwen Max (17/19).

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
