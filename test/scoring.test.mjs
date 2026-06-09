import { test } from "node:test";
import assert from "node:assert/strict";
import { score, compareScores } from "../src/lib/scoring.mjs";

const scn = (id, classification) => ({ id, classification });
const result = (id, ok, friction = []) => ({ id, ok, skipped: false, friction });

test("score computes per-aspect pass rate and a weighted overall", () => {
    const scenarios = [scn("a", "install"), scn("b", "install"), scn("c", "upgrade")];
    const s = score({
        results: [result("a", true), result("b", false, [{ type: "assertion" }]), result("c", true)],
        scenarios
    });
    assert.equal(s.aspects.install.score, 0.5, "1 of 2 install scenarios pass");
    assert.equal(s.aspects.upgrade.score, 1);
    assert.equal(s.aspects.coverage.score, 0.667, "2 of 3 overall");
    assert.ok(s.overall > 0 && s.overall < 1);
});

test("process frictions lower efficiency; assertion frictions do not", () => {
    const scenarios = [scn("a", "install")];
    assert.equal(score({ results: [result("a", true)], scenarios }).aspects.efficiency.score, 1);
    assert.ok(score({ results: [result("a", false, [{ type: "blocking" }])], scenarios }).aspects.efficiency.score < 1);
    assert.equal(score({ results: [result("a", false, [{ type: "assertion" }])], scenarios }).aspects.efficiency.score, 1);
});

test("orchestration classification maps to the orchestration aspect", () => {
    const scenarios = [scn("a", "orchestration")];
    const s = score({ results: [result("a", true)], scenarios });
    assert.equal(s.aspects.orchestration.score, 1);
    assert.equal(s.aspects.other, undefined);
});

test("compareScores flags a per-aspect regression as worse overall", () => {
    const base = { overall: 1, aspects: { install: { score: 1 }, retrieval: { score: 1 } } };
    const current = { overall: 0.9, aspects: { install: { score: 1 }, retrieval: { score: 0.5 } } };
    const cmp = compareScores(base, current);
    assert.equal(cmp.aspects.retrieval.verdict, "worse");
    assert.equal(cmp.regressed, true);
    assert.equal(cmp.verdict, "regressed");
});

test("compareScores reports improvement when an aspect rises and none falls", () => {
    const cmp = compareScores(
        { overall: 0.8, aspects: { retrieval: { score: 0.8 } } },
        { overall: 0.9, aspects: { retrieval: { score: 0.9 } } }
    );
    assert.equal(cmp.regressed, false);
    assert.equal(cmp.verdict, "improved");
});
