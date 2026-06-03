import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readRunReport, writeRunReport } from "../src/lib/report.mjs";

test("report writer creates summary, friction, and markdown report", () => {
    const root = mkdtempSync(join(tmpdir(), "hos-lab-report-"));
    try {
        const summary = {
            runId: "R1",
            source: { path: "D:/_localhost/hos" },
            sourceUnchanged: true,
            counts: { passed: 1, failed: 0, skipped: 0, friction: 0 },
            scenarios: [{ id: "demo", ok: true, skipped: false, commands: [], friction: [] }]
        };
        const artifacts = writeRunReport({ runDir: join(root, "R1"), summary, friction: [] });
        assert.match(artifacts.report, /report\.md$/);

        const loaded = readRunReport(root, "R1");
        assert.equal(loaded.summary.runId, "R1");
        assert.match(loaded.markdown, /No friction recorded/);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
