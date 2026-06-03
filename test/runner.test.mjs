import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/lib/config.mjs";
import { runLab, runScenario } from "../src/lib/runner.mjs";

function workspace(name) {
    return mkdtempSync(join(tmpdir(), `hos-lab-${name}-`));
}

test("runner executes one scenario and writes lab artifacts", { timeout: 60000 }, async () => {
    const root = workspace("single");
    try {
        const result = await runLab({ workspace: root, scenario: "new-empty-project" });
        assert.equal(result.ok, true);
        assert.equal(result.summary.counts.total, 1);
        assert.equal(existsSync(result.artifacts.summary), true);
        assert.equal(existsSync(result.artifacts.friction), true);
        assert.equal(existsSync(result.artifacts.report), true);
        assert.equal(result.summary.sourceUnchanged, true);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("runner executes the full generated matrix", { timeout: 180000 }, async () => {
    const root = workspace("matrix");
    try {
        const result = await runLab({ workspace: root });
        assert.equal(result.ok, true);
        assert.ok(result.summary.counts.total >= 8);
        assert.equal(result.summary.counts.failed, 0);
        assert.equal(result.summary.sourceUnchanged, true);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("runner converts fixture setup failures into structured friction", async () => {
    const root = workspace("fixture-failure");
    try {
        const config = loadConfig({ workspace: root });
        const result = await runScenario({
            scenario: { id: "bad-fixture", fixture: "missing", classification: "lab" },
            config,
            runDir: root
        });

        assert.equal(result.ok, false);
        assert.equal(result.friction.length, 1);
        assert.equal(result.friction[0].phase, "fixture");
        assert.equal(result.friction[0].scenarioId, "bad-fixture");
        assert.equal(result.friction[0].classification, "hos-lab");
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("runner preflights child-process spawning and avoids cascade friction", { timeout: 60000 }, async () => {
    const root = workspace("spawn-failure");
    const previous = process.env.HOS_LAB_NODE;
    process.env.HOS_LAB_NODE = join(root, "missing-node.exe");
    try {
        const result = await runLab({ workspace: root, scenario: "new-empty-project" });
        assert.equal(result.ok, false);
        assert.equal(result.summary.counts.total, 1);
        assert.equal(result.summary.scenarios[0].id, "environment-preflight");
        assert.equal(result.friction.length, 1);
        assert.equal(result.friction[0].classification, "hos-lab");
        assert.equal(result.friction[0].candidateHosArea, "src/lib/runner.mjs");
        assert.match(result.friction[0].actual, /ENOENT|not found|no such file/i);
        assert.equal(existsSync(result.artifacts.summary), true);
        assert.equal(existsSync(result.artifacts.friction), true);
        assert.equal(existsSync(result.artifacts.report), true);
    } finally {
        if (previous === undefined) {
            delete process.env.HOS_LAB_NODE;
        } else {
            process.env.HOS_LAB_NODE = previous;
        }
        rmSync(root, { recursive: true, force: true });
    }
});
