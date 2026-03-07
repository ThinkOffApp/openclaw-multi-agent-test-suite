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
  let totalGradedScore = 0;

  for (const score of scoreResults) {
    const stageKey = String(score.stage);
    if (!stageTotals[stageKey]) {
      stageTotals[stageKey] = { pass: 0, marginal: 0, fail: 0, graded_total: 0, count: 0 };
    }

    const st = stageTotals[stageKey];
    st[score.status] = (st[score.status] || 0) + 1;
    st.graded_total += score.graded_score ?? (score.status === 'pass' ? 1 : 0);
    st.count += 1;

    totalGradedScore += score.graded_score ?? (score.status === 'pass' ? 1 : 0);

    for (const key of Object.keys(dimensionAccumulator)) {
      dimensionAccumulator[key] += normalizeDimensionValue(score.dimensions?.[key]);
    }

    autoFailCount += Array.isArray(score.auto_fail_reasons) ? score.auto_fail_reasons.length : 0;
  }

  const scenarioCount = scoreResults.length;
  const dimensionTotals = Object.fromEntries(
    Object.entries(dimensionAccumulator).map(([key, value]) => [key, Number((value / scenarioCount).toFixed(4))])
  );

  // Compute per-stage averages
  for (const st of Object.values(stageTotals)) {
    st.graded_average = st.count > 0 ? Number((st.graded_total / st.count).toFixed(4)) : 0;
  }

  return {
    schema_version: 'omats.run-summary.v2',
    run_id: runId,
    model_id: modelId,
    scenario_count: scenarioCount,
    graded_total: Number(totalGradedScore.toFixed(2)),
    graded_average: Number((totalGradedScore / scenarioCount).toFixed(4)),
    stage_totals: stageTotals,
    dimension_totals: dimensionTotals,
    auto_fail_count: autoFailCount
  };
}
