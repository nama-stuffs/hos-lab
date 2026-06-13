import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/lib/config.mjs";
import { prepareFixture } from "../src/lib/fixtures.mjs";

test("fixture generation drops in HOS without copying source README", async () => {
    const root = mkdtempSync(join(tmpdir(), "hos-lab-fixture-"));
    try {
        const config = loadConfig({ workspace: root });
        const scenario = { id: "fixture-empty", fixture: "empty" };
        const prepared = await prepareFixture({ scenario, sourcePath: config.source.path, runDir: root });
        assert.equal(existsSync(join(prepared.fixtureDir, ".hos", "tools", "hos.mjs")), true);
        assert.equal(existsSync(join(prepared.fixtureDir, "AGENTS.md")), true);
        assert.equal(existsSync(join(prepared.fixtureDir, "README.md")), false);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("existing AGENTS.md fixture preserves host content before merge", async () => {
    const root = mkdtempSync(join(tmpdir(), "hos-lab-agents-"));
    try {
        const config = loadConfig({ workspace: root });
        const scenario = { id: "fixture-agents", fixture: "existing-agents" };
        const prepared = await prepareFixture({ scenario, sourcePath: config.source.path, runDir: root });
        const agents = readFileSync(join(prepared.fixtureDir, "AGENTS.md"), "utf8");
        assert.match(agents, /House rule: ship small\./);
        assert.doesNotMatch(agents, /## HOS/);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
