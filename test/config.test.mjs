import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { loadConfig, loadScenarios } from "../src/lib/config.mjs";

test("config loads the default local HOS source", () => {
    const config = loadConfig();
    assert.equal(config.sourceName, "default");
    assert.match(config.source.path.replaceAll("\\", "/"), /D:\/_localhost\/hos$/);
    assert.equal(existsSync(`${config.source.path}/.hos/tools/hos.mjs`), true);
});

test("scenario loader selects one scenario or the generated matrix", () => {
    assert.equal(loadScenarios({ scenario: "new-empty-project" }).length, 1);
    assert.ok(loadScenarios().length >= 8);
});
