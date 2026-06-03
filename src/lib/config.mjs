import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LAB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CONFIG_PATH = join(LAB_ROOT, "hos-lab.config.json");
export const SCENARIOS_DIR = join(LAB_ROOT, "scenarios");

export function toPosix(path) {
    return String(path).replaceAll("\\", "/");
}

function readJson(path) {
    return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

function absolutePath(value) {
    return resolve(LAB_ROOT, String(value || ""));
}

export function loadConfig(overrides = {}) {
    if (!existsSync(CONFIG_PATH)) {
        throw new Error(`missing config: ${CONFIG_PATH}`);
    }
    const config = readJson(CONFIG_PATH);
    const candidates = config.candidates || config.sources || {};
    const candidateName = overrides.candidate || overrides.source || "default";
    const candidateDef = candidates[candidateName];
    if (!candidateDef) {
        throw new Error(`unknown candidate: ${candidateName} (have: ${Object.keys(candidates).join(", ") || "none"})`);
    }

    const workspace = absolutePath(overrides.workspace || config.workspace || ".runs");
    const resolved = {
        ...config,
        labRoot: LAB_ROOT,
        candidates,
        candidateName,
        candidateDef,
        // Overlay candidates resolve to a materialized path at run time; local
        // candidates expose their path here for convenience and back-compat.
        sourceName: candidateName,
        source: candidateDef.type === "local"
            ? { ...candidateDef, path: absolutePath(candidateDef.path) }
            : { type: candidateDef.type },
        workspace,
        matrix: overrides.matrix || config.matrix || "generated"
    };
    return resolved;
}

export function scenarioFiles() {
    return readdirSync(SCENARIOS_DIR)
        .filter((file) => file.endsWith(".json"))
        .map((file) => join(SCENARIOS_DIR, file))
        .sort();
}

// Held-out scenarios live in scenarios/heldout/ and are NOT iterated against;
// they are the sealed gate that catches overfitting to the visible set. They are
// tagged so the progression protocol can treat their regression as a hard signal
// (see BENCHMARK.md).
function heldoutFiles() {
    const dir = join(SCENARIOS_DIR, "heldout");
    return existsSync(dir)
        ? readdirSync(dir).filter((file) => file.endsWith(".json")).map((file) => join(dir, file)).sort()
        : [];
}

export function loadScenarios({ scenario = "" } = {}) {
    const visible = scenarioFiles().map((path) => ({ ...readJson(path), heldout: false }));
    const heldout = heldoutFiles().map((path) => ({ ...readJson(path), heldout: true }));
    const scenarios = [...visible, ...heldout];
    const selected = scenario ? scenarios.filter((item) => item.id === scenario) : scenarios;
    if (scenario && !selected.length) {
        throw new Error(`unknown scenario: ${scenario}`);
    }
    return selected;
}
