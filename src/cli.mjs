#!/usr/bin/env node

import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./lib/config.mjs";
import { runLab } from "./lib/runner.mjs";
import { readRunReport } from "./lib/report.mjs";
import { readBaseline, writeBaseline } from "./lib/baseline.mjs";
import { compareScores } from "./lib/scoring.mjs";

const [, , command, ...rest] = process.argv;

function flags(args) {
    const out = { _: [] };
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith("--")) {
            out[args[i].slice(2)] = args[i + 1]?.startsWith("--") || args[i + 1] === undefined ? true : args[++i];
        } else {
            out._.push(args[i]);
        }
    }
    return out;
}

const print = (value) => process.stdout.write(JSON.stringify(value, null, 2) + "\n");

function fail(message) {
    process.stderr.write(`hos-lab: ${message}\n`);
    process.exit(1);
}

function candidateName(f) {
    return f.candidate || f.source || "default";
}

async function run(args) {
    const f = flags(args);
    const name = candidateName(f);
    const result = await runLab({ candidate: f.candidate, source: f.source || "default", scenario: f.scenario || "", matrix: f.matrix || "" });

    const out = {
        ok: result.ok,
        runId: result.runId,
        candidate: name,
        counts: result.summary.counts,
        score: result.summary.score,
        artifacts: result.artifacts
    };

    // Compare to the committed baseline so a change is judged against the last
    // known-good result, not just pass/fail.
    const baseline = readBaseline(name);
    if (baseline && result.summary.score) {
        out.vsBaseline = compareScores(baseline.score, result.summary.score);
    }
    if (f["save-baseline"] && result.summary.score) {
        out.baselineWritten = writeBaseline(name, result.summary.score);
    }

    print(out);
    process.exit(result.ok ? 0 : 1);
}

async function baseline(args) {
    const f = flags(args);
    const name = candidateName(f);
    const result = await runLab({ candidate: f.candidate, source: f.source || "default" });
    if (!result.summary.score) {
        fail("no score produced; cannot freeze a baseline");
    }
    const path = writeBaseline(name, result.summary.score);
    print({ ok: result.ok, candidate: name, overall: result.summary.score.overall, baseline: path });
    process.exit(result.ok ? 0 : 1);
}

// Head-to-head: run two candidates on the same set and report per-aspect + overall
// winner. B wins only if it dominates (no aspect worse, at least one better).
async function battle(args) {
    const f = flags(args);
    const [a, b] = f._;
    if (!a || !b) {
        fail("battle needs <candidateA> <candidateB>");
    }
    const ra = await runLab({ candidate: a, scenario: f.scenario || "" });
    const rb = await runLab({ candidate: b, scenario: f.scenario || "" });
    const cmp = compareScores(ra.summary.score, rb.summary.score);
    const winner = cmp.improved && !cmp.regressed ? b
        : cmp.regressed && !cmp.improved ? a
            : cmp.improved && cmp.regressed ? "mixed" : "tie";

    print({
        battle: { a, b },
        a: { ok: ra.ok, overall: ra.summary.score.overall },
        b: { ok: rb.ok, overall: rb.summary.score.overall },
        comparison: cmp,
        winner
    });
    process.exit(0);
}

function report(args) {
    const f = flags(args);
    const runId = f._[0];
    if (!runId) {
        fail("report needs <run-id>");
    }
    const config = loadConfig({ source: f.source || "default" });
    const result = readRunReport(config.workspace, runId);
    print({ runId, report: result.report, summary: result.summary });
}

function clean(args) {
    const f = flags(args);
    const config = loadConfig({ source: f.source || "default" });
    const workspace = resolve(config.workspace);
    if (!workspace.endsWith(".runs")) {
        fail(`refusing to clean non-lab workspace: ${workspace}`);
    }
    rmSync(workspace, { recursive: true, force: true });
    print({ ok: true, cleaned: workspace.replaceAll("\\", "/") });
}

async function main() {
    if (command === "run" || !command) {
        await run(rest);
        return;
    }
    if (command === "baseline") {
        await baseline(rest);
        return;
    }
    if (command === "battle") {
        await battle(rest);
        return;
    }
    if (command === "report") {
        report(rest);
        return;
    }
    if (command === "clean") {
        clean(rest);
        return;
    }
    fail(`unknown command: ${command}`);
}

main().catch((error) => fail(error.message));
