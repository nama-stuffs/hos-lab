import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateAssertions, resolveTokens } from "../src/lib/assertions.mjs";

function tempRoot() {
    return mkdtempSync(join(tmpdir(), "hos-lab-assert-"));
}

test("resolveTokens reads command and fixture values", () => {
    const text = resolveTokens("ticket ${command.1.id} in ${fixture.name}", {
        command: [{}, { id: "T-1" }],
        fixture: { name: "demo" }
    });
    assert.equal(text, "ticket T-1 in demo");
});

test("failed assertions create structured friction", () => {
    const root = tempRoot();
    try {
        writeFileSync(join(root, "keep.txt"), "hello\n");
        const scenario = {
            id: "assert-demo",
            classification: "install",
            candidateHosArea: ".hos/tools/lib/install-files.mjs",
            assertions: [
                { type: "fileContains", path: "keep.txt", text: "missing" },
                { type: "jsonField", command: 0, path: "ok", equals: true }
            ]
        };
        const friction = evaluateAssertions({
            scenario,
            fixtureDir: root,
            commands: [{ status: 0, stdout: "{\"ok\":false}", json: { ok: false } }]
        });
        assert.equal(friction.length, 2);
        assert.equal(friction[0].scenarioId, "assert-demo");
        assert.equal(friction[0].classification, "install");
        assert.equal(friction[0].reproducible, true);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
