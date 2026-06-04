// Multi-aspect scoring for a lab run. Turns scenario results + classified
// frictions into a per-aspect 0..1 score and a weighted overall, so a candidate
// can be compared objectively against its committed baseline or another
// candidate (battle). See BENCHMARK.md for the criteria and the progression
// protocol. The score is a regression floor + a coverage signal, never a target
// to maximize on a fixed set.

// Default map from a scenario's classification to a benchmark aspect. A scenario
// may override with an explicit "aspect" field.
const CLASSIFICATION_ASPECT = {
    install: "install",
    adopt: "install",
    merge: "install",
    upgrade: "upgrade",
    benchmark: "retrieval",
    report: "process",
    privacy: "safety",
    spec: "spec",
    parallel: "orchestration",
    "deep-log": "orchestration"
};

// Aspect weights for the overall score. Tunable; documented in BENCHMARK.md.
export const ASPECT_WEIGHTS = {
    install: 1,
    upgrade: 1,
    orchestration: 1,
    spec: 1,
    retrieval: 1,
    process: 1,
    safety: 1,
    autonomy: 1,
    audit: 1,
    tasks: 1,
    efficiency: 1.5,
    coverage: 1,
    quality: 1
};

// Process frictions - the kind that block or slow an agent - drive the efficiency
// aspect, so "frictionless" literally scores higher.
const PROCESS_FRICTION_TYPES = new Set(["blocking", "missing-capability", "inefficiency", "redundant-step"]);

const round = (n) => Math.round(n * 1000) / 1000;

function aspectOf(scenario) {
    return scenario.aspect || CLASSIFICATION_ASPECT[scenario.classification] || "other";
}

function countBy(items, key) {
    const out = {};
    for (const item of items) {
        const value = item[key] || "unknown";
        out[value] = (out[value] || 0) + 1;
    }
    return out;
}

export function score({ results, scenarios, quality = null }) {
    const byId = Object.fromEntries(scenarios.map((s) => [s.id, s]));
    const scored = results.filter((r) => !r.skipped);
    const frictions = results.flatMap((r) => r.friction || []);
    const processFrictions = frictions.filter((f) => PROCESS_FRICTION_TYPES.has(f.type));

    // Per-aspect pass rate.
    const buckets = {};
    for (const result of scored) {
        const aspect = aspectOf(byId[result.id] || {});
        (buckets[aspect] ||= { passed: 0, total: 0 });
        buckets[aspect].total++;
        if (result.ok) {
            buckets[aspect].passed++;
        }
    }

    const aspects = {};
    for (const [id, bucket] of Object.entries(buckets)) {
        aspects[id] = {
            score: round(bucket.total ? bucket.passed / bucket.total : 1),
            passed: bucket.passed,
            total: bucket.total
        };
    }

    // Efficiency: 1.0 when frictionless; each process friction costs, floored at 0.
    const penalty = Math.min(1, processFrictions.length / Math.max(4, scored.length));
    aspects.efficiency = { score: round(1 - penalty), processFrictions: processFrictions.length };

    // Coverage: overall pass rate across non-skipped scenarios.
    const passedAll = scored.filter((r) => r.ok).length;
    aspects.coverage = {
        score: round(scored.length ? passedAll / scored.length : 1),
        passed: passedAll,
        total: scored.length
    };

    // Quality: an optional, agent-graded aspect. The lab does not embed an LLM;
    // an agent grades the run's artifacts against the pinned rubric (BENCHMARK.md)
    // and writes quality/<candidate>.json. Secondary signal - report it with its
    // dimensions, never let it alone gate a verdict.
    if (quality && typeof quality.score === "number") {
        aspects.quality = { score: round(quality.score), agentGraded: true, dimensions: quality.dimensions || {} };
    }

    // Weighted overall.
    let weighted = 0;
    let weight = 0;
    for (const [id, aspect] of Object.entries(aspects)) {
        const w = ASPECT_WEIGHTS[id] ?? 1;
        weighted += aspect.score * w;
        weight += w;
    }

    return {
        overall: round(weight ? weighted / weight : 1),
        aspects,
        scenarios: scored.length,
        frictionsByType: countBy(frictions, "type")
    };
}

// Compare a fresh score to a baseline score: per-aspect delta + an overall
// verdict. Deterministic aspects must not regress (the floor); progression comes
// from added coverage or a moved quality aspect (see BENCHMARK.md).
export function compareScores(baseline, current) {
    const ids = [...new Set([...Object.keys(baseline.aspects || {}), ...Object.keys(current.aspects || {})])].sort();
    const aspects = {};
    let regressed = false;
    let improved = false;

    for (const id of ids) {
        const from = baseline.aspects?.[id]?.score ?? null;
        const to = current.aspects?.[id]?.score ?? null;
        const delta = from === null || to === null ? null : round(to - from);
        const verdict = delta === null ? "new" : delta > 0 ? "better" : delta < 0 ? "worse" : "same";
        if (verdict === "worse") {
            regressed = true;
        }
        if (verdict === "better" || verdict === "new") {
            improved = true;
        }
        aspects[id] = { from, to, delta, verdict };
    }

    const overallDelta = round((current.overall ?? 0) - (baseline.overall ?? 0));
    return {
        overall: { from: baseline.overall ?? null, to: current.overall ?? null, delta: overallDelta },
        aspects,
        regressed,
        improved,
        verdict: regressed ? "regressed" : improved ? "improved" : "same"
    };
}
