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

test("expected values resolve command tokens, pinning one command's output to another's", () => {
    const root = tempRoot();
    try {
        const scenario = {
            id: "token-equals-demo",
            assertions: [
                { type: "jsonField", command: 1, path: "ticket", equals: "${command.0.id}" },
                { type: "jsonArrayObjectIncludes", command: 1, path: "similar", field: "id", equals: "${command.0.id}" },
                { type: "jsonField", command: 1, path: "session", equals: "${command.0.id}" }
            ]
        };
        const friction = evaluateAssertions({
            scenario,
            fixtureDir: root,
            commands: [
                { status: 0, stdout: "", json: { id: "T-9" } },
                { status: 0, stdout: "", json: { ticket: "T-9", session: "S-1", similar: [{ id: "T-9" }] } }
            ]
        });

        assert.equal(friction.length, 1, "only the mismatched field fails");
        assert.equal(friction[0].expected, "equals \"T-9\"", "friction reports the resolved expectation");
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("commandStderrContains reads command stderr", () => {
    const root = tempRoot();
    try {
        const scenario = {
            id: "stderr-demo",
            assertions: [
                { type: "commandStderrContains", command: 0, text: "workflow gate failed" },
                { type: "commandStderrContains", command: 1, text: "workflow gate failed" }
            ]
        };
        const friction = evaluateAssertions({
            scenario,
            fixtureDir: root,
            commands: [
                { status: 1, stdout: "", stderr: "workflow gate failed: missing plan" },
                { status: 0, stdout: "", stderr: "different error" }
            ]
        });

        assert.equal(friction.length, 1);
        assert.equal(friction[0].command, "command[1]");
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
