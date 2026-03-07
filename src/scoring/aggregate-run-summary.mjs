function normalizeDimensionValue(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return 0;

  switch (value.toLowerCase()) {
    case 'pass':
      return 1;
    case 'partial':
      return 0.5;
    case 'fail':
      return 0;
    default:
      return 0;
  }
}

export function aggregateRunSummary(scoreResults) {
  if (!Array.isArray(scoreResults) || scoreResults.length === 0) {
    throw new Error('aggregateRunSummary requires at least one score result');
  }

  const runId = scoreResults[0].run_id;
  const modelId = scoreResults[0].model_id;
  const stageTotals = {};
  const dimensionAccumulator = {
    comprehension: 0,
    discipline: 0,
    execution: 0
  };

  let autoFailCount = 0;
  let totalFinalScore = 0;
  let totalPassRate = 0;

  for (const score of scoreResults) {
    const stageKey = String(score.stage);
    if (!stageTotals[stageKey]) {
      stageTotals[stageKey] = { pass: 0, fail: 0 };
    }

    stageTotals[stageKey][score.status] = (stageTotals[stageKey][score.status] || 0) + 1;

    for (const key of Object.keys(dimensionAccumulator)) {
      const dimensionValue = score.dimension_scores?.[key] ?? normalizeDimensionValue(score.dimensions?.[key]);
      dimensionAccumulator[key] += dimensionValue;
    }

    autoFailCount += Array.isArray(score.auto_fail_reasons) ? score.auto_fail_reasons.length : 0;
    totalFinalScore += score.final_score || 0;
    totalPassRate += score.pass_rate ?? (score.status === 'pass' ? 1 : 0);
  }

  const scenarioCount = scoreResults.length;
  const dimensionTotals = Object.fromEntries(
    Object.entries(dimensionAccumulator).map(([key, value]) => [key, Number((value / scenarioCount).toFixed(4))])
  );

  return {
    schema_version: 'omats.run-summary.v1',
    run_id: runId,
    model_id: modelId,
    scenario_count: scenarioCount,
    average_final_score: Number((totalFinalScore / scenarioCount).toFixed(4)),
    average_pass_rate: Number((totalPassRate / scenarioCount).toFixed(4)),
    stage_totals: stageTotals,
    dimension_totals: dimensionTotals,
    auto_fail_count: autoFailCount
  };
}
