// Committed lab-results: the best-known score for a candidate, stored in the lab
// repo so each run can report how a change scored against it. The baseline is a
// regression floor, not a target - see BENCHMARK.md.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LAB_ROOT } from "./config.mjs";

const BASELINES_DIR = join(LAB_ROOT, "baselines");

export function baselinePath(candidate) {
    return join(BASELINES_DIR, `${candidate}.json`);
}

export function readBaseline(candidate) {
    const path = baselinePath(candidate);
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

export function writeBaseline(candidate, score) {
    mkdirSync(BASELINES_DIR, { recursive: true });
    const path = baselinePath(candidate);
    writeFileSync(path, JSON.stringify({ candidate, savedAt: new Date().toISOString(), score }, null, 2) + "\n");
    return path.replaceAll("\\", "/");
}
