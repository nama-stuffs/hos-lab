import { execFile, execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { evaluateAssertions, resolveTokens } from "./assertions.mjs";
import { resolveCandidate } from "./candidate.mjs";
import { loadConfig, loadScenarios, toPosix } from "./config.mjs";
import { prepareFixture } from "./fixtures.mjs";
import { writeRunReport } from "./report.mjs";
import { score } from "./scoring.mjs";

function nowId() {
    return new Date().toISOString().replace(/\D/g, "").slice(0, 14);
}

function parseJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

function sourceVersion(sourcePath) {
    try {
        const stdout = execFileSync(process.execPath, [join(sourcePath, ".hos", "tools", "hos.mjs"), "version"], {
            cwd: sourcePath,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"]
        });
        return parseJson(stdout.trim())?.version || null;
    } catch {
        return null;
    }
}

const execFileAsync = promisify(execFile);

function nodeCommand() {
    return process.env.HOS_LAB_NODE || process.execPath;
}

// How many scenarios to drive at once. Each scenario runs its own commands
// sequentially, so the cap is also the peak number of concurrent child
// processes; default to the machine's parallelism, overridable for tuning.
function scenarioConcurrency() {
    const raw = Number(process.env.HOS_LAB_CONCURRENCY);
    if (Number.isInteger(raw) && raw > 0) {
        return raw;
    }
    return Math.max(2, availableParallelism());
}

function isSpawnFailure(text = "") {
    return /spawn(?:Sync)? .* (EPERM|ENOENT|EACCES)|\bEPERM\b|\bENOENT\b|\bEACCES\b/i.test(String(text));
}

function environmentFriction({ phase, actual, command = "" }) {
    return {
        scenarioId: "environment-preflight",
        phase,
        command,
        expected: "local child processes can be launched",
        actual,
        type: "environment",
        classification: "hos-lab",
        candidateHosArea: "src/lib/runner.mjs",
        reproducible: true
    };
}

// Classify a failed command into a friction type that scoring can read. A command
// the harness does not understand is a missing capability; an unexpected non-zero
// exit is a blocking friction (an agent following this flow would be stuck).
function commandFrictionType(result) {
    if (result.environmentFailure) {
        return "environment";
    }
    return /unknown .*command|usage:|needs --|no such|not a function/i.test(result.stderr)
        ? "missing-capability"
        : "blocking";
}

function preflight() {
    const result = spawnSync(nodeCommand(), ["--version"], {
        encoding: "utf8"
    });
    const actual = result.error?.message || result.stderr || "";
    if ((result.status ?? 1) !== 0 || actual) {
        return environmentFriction({
            phase: "environment",
            command: "node --version",
            actual: actual || `exit ${result.status ?? 1}`
        });
    }
    return null;
}

function commandArgs(command) {
    return Array.isArray(command) ? command : command.args || [];
}

function commandAllowFailure(command) {
    return !Array.isArray(command) && Boolean(command.allowFailure);
}

function commandExpectsQuestion(command) {
    return !Array.isArray(command) && Boolean(command.expectsQuestion);
}

// True when a command's JSON output contains an interactive question (an
// `action: "ask"` or a non-empty `questions` list) anywhere in the tree. An
// agent at that point needs a human decision - in an unattended cold start that
// is manual steering, so it is friction unless the scenario declares it with
// `expectsQuestion: true` on the command.
export function containsQuestion(value) {
    if (!value || typeof value !== "object") {
        return false;
    }
    if (value.action === "ask") {
        return true;
    }
    if (Array.isArray(value.questions) && value.questions.length) {
        return true;
    }
    return Object.values(value).some(containsQuestion);
}

function steeringFriction(scenario, command, result) {
    return {
        scenarioId: scenario.id,
        phase: "invariant",
        command: result.command,
        expected: "the flow proceeds without a human decision (or the command declares expectsQuestion)",
        actual: "output contains an interactive question",
        type: "manual-steering",
        classification: scenario.classification || "process",
        candidateHosArea: scenario.candidateHosArea || "",
        reproducible: true
    };
}

function commandPhase(command) {
    return Array.isArray(command) ? "" : command.phase || "";
}

async function runHosCommand({ fixtureDir, args, context }) {
    const resolved = args.map((arg) => resolveTokens(arg, context));
    const full = [join(fixtureDir, ".hos", "tools", "hos.mjs"), ...resolved];
    // Async spawn (not spawnSync): a synchronous wait here would block the event
    // loop and serialize every scenario the pool is trying to run in parallel.
    let stdout = "";
    let stderr = "";
    let status = 0;
    try {
        const out = await execFileAsync(nodeCommand(), full, {
            cwd: fixtureDir,
            encoding: "utf8",
            maxBuffer: 32 * 1024 * 1024
        });
        stdout = out.stdout || "";
        stderr = out.stderr || "";
    } catch (error) {
        // execFile rejects on non-zero exit (and on spawn failure); the streams
        // and exit code ride on the error object.
        stdout = error.stdout || "";
        stderr = error.stderr || error.message || "";
        status = typeof error.code === "number" ? error.code : 1;
    }
    stdout = stdout.trim();
    stderr = stderr.trim();

    return {
        args: resolved,
        command: `node .hos/tools/hos.mjs ${resolved.join(" ")}`.trim(),
        status,
        stdout,
        stderr,
        json: parseJson(stdout),
        environmentFailure: isSpawnFailure(stderr)
    };
}

function commandFailure(scenario, command, result) {
    if (result.environmentFailure) {
        return {
            scenarioId: scenario.id,
            phase: "environment",
            command: result.command,
            expected: "local child processes can be launched",
            actual: `exit ${result.status}${result.stderr ? `: ${result.stderr}` : ""}`,
            type: "environment",
            classification: "hos-lab",
            candidateHosArea: "src/lib/runner.mjs",
            reproducible: true
        };
    }
    return {
        scenarioId: scenario.id,
        phase: commandPhase(command) || scenario.phase || "command",
        command: result.command,
        expected: "exit 0",
        actual: `exit ${result.status}${result.stderr ? `: ${result.stderr}` : ""}`,
        type: commandFrictionType(result),
        classification: scenario.classification || "command",
        candidateHosArea: scenario.candidateHosArea || "",
        reproducible: true
    };
}

function scenarioFailure(scenario, phase, error) {
    const area = phase === "fixture" ? "src/lib/fixtures.mjs" : "src/lib/runner.mjs";
    return {
        scenarioId: scenario.id,
        phase,
        command: "",
        expected: "scenario completes and writes lab artifacts",
        actual: error.message,
        type: "harness",
        classification: "hos-lab",
        candidateHosArea: area,
        reproducible: true
    };
}

export async function runScenario({ scenario, config, runDir }) {
    if (scenario.requiresGit) {
        const git = spawnSync("git", ["--version"], { stdio: "ignore" });
        if ((git.status ?? 1) !== 0) {
            return {
                id: scenario.id,
                ok: true,
                skipped: true,
                skipReason: "git not available",
                commands: [],
                friction: []
            };
        }
    }

    let prepared;
    try {
        prepared = await prepareFixture({
            scenario,
            sourcePath: config.source.path,
            runDir
        });
    } catch (error) {
        const failure = scenarioFailure(scenario, "fixture", error);
        return {
            id: scenario.id,
            ok: false,
            skipped: false,
            fixtureDir: "",
            commands: [],
            friction: [failure]
        };
    }
    if (prepared.context.skip) {
        return {
            id: scenario.id,
            ok: true,
            skipped: true,
            skipReason: prepared.context.skip,
            commands: [],
            friction: []
        };
    }

    const commands = [];
    const friction = [];
    const context = {
        fixture: prepared.context,
        source: { path: config.source.path },
        command: []
    };

    for (const command of scenario.commands || []) {
        const result = await runHosCommand({
            fixtureDir: prepared.fixtureDir,
            args: commandArgs(command),
            context
        });
        commands.push(result);
        context.command = commands.map((item) => item.json ?? item.stdout);
        if (result.status !== 0 && !commandAllowFailure(command)) {
            friction.push(commandFailure(scenario, command, result));
            break;
        }
        // Always-on invariant, independent of per-scenario assertions: a flow
        // that stops for a human question is not a cold start.
        if (result.status === 0 && !commandExpectsQuestion(command) && containsQuestion(result.json)) {
            friction.push(steeringFriction(scenario, command, result));
        }
    }

    if (!friction.some((item) => item.phase === "environment")) {
        try {
            friction.push(...evaluateAssertions({
                scenario,
                fixtureDir: prepared.fixtureDir,
                commands,
                context: {
                    fixture: prepared.context,
                    source: { path: config.source.path }
                }
            }));
        } catch (error) {
            friction.push(scenarioFailure(scenario, "assert", error));
        }
    }

    try {
        writeFileSync(join(prepared.fixtureDir, "commands.json"), JSON.stringify(commands, null, 2) + "\n");
    } catch (error) {
        friction.push(scenarioFailure(scenario, "record", error));
    }

    return {
        id: scenario.id,
        ok: friction.length === 0,
        skipped: false,
        fixtureDir: toPosix(prepared.fixtureDir),
        commands,
        friction
    };
}

export async function runLab(overrides = {}) {
    const config = loadConfig(overrides);
    const scenarios = loadScenarios({ scenario: overrides.scenario || "" });
    const runId = `${nowId()}-${config.candidateName}`;
    const runDir = join(config.workspace, runId);
    mkdirSync(runDir, { recursive: true });

    // Resolve the candidate: every candidate is materialized into this run's
    // workspace as the clean drop-in surface a real install receives; the
    // original repository is only ever read.
    const candidate = resolveCandidate(config.candidateName, config, runDir);
    config.source = {
        ...config.source,
        path: candidate.path,
        origin: candidate.origin || candidate.path,
        name: candidate.name,
        materialized: candidate.materialized,
        install: candidate.install || null
    };

    const originBefore = sourceVersion(config.source.origin);
    const before = sourceVersion(config.source.path);
    const results = [];
    const preflightFriction = preflight();
    if (preflightFriction) {
        results.push({
            id: "environment-preflight",
            ok: false,
            skipped: false,
            fixtureDir: "",
            commands: [],
            friction: [preflightFriction]
        });
    } else {
        // Drive scenarios with a bounded worker pool. Scenarios are independent
        // (each gets its own fixture dir; the candidate source is read-only), so
        // they parallelize freely. Results are written by index to keep the
        // report order identical to a serial run.
        const ordered = new Array(scenarios.length);
        let cursor = 0;
        const worker = async () => {
            for (;;) {
                const index = cursor++;
                if (index >= scenarios.length) {
                    return;
                }
                const scenario = scenarios[index];
                try {
                    ordered[index] = await runScenario({ scenario, config, runDir });
                } catch (error) {
                    ordered[index] = {
                        id: scenario.id,
                        ok: false,
                        skipped: false,
                        fixtureDir: "",
                        commands: [],
                        friction: [scenarioFailure(scenario, "runner", error)]
                    };
                }
            }
        };
        const workers = Math.min(scenarioConcurrency(), scenarios.length);
        await Promise.all(Array.from({ length: workers }, worker));
        results.push(...ordered);
    }
    const after = sourceVersion(config.source.path);
    const originAfter = sourceVersion(config.source.origin);

    const friction = results.flatMap((result) => result.friction);
    if (before && after && before !== after) {
        friction.push({
            scenarioId: "source-library",
            phase: "post-run",
            command: "node .hos/tools/hos.mjs version",
            expected: before,
            actual: after,
            classification: "source-mutation",
            candidateHosArea: config.source.path,
            reproducible: true
        });
    }
    if (originBefore && originAfter && originBefore !== originAfter) {
        friction.push({
            scenarioId: "source-library",
            phase: "post-run",
            command: "node .hos/tools/hos.mjs version",
            expected: originBefore,
            actual: originAfter,
            classification: "source-mutation",
            candidateHosArea: config.source.origin,
            reproducible: true
        });
    }

    const counts = {
        total: results.length,
        passed: results.filter((result) => result.ok && !result.skipped).length,
        failed: results.filter((result) => !result.ok).length,
        skipped: results.filter((result) => result.skipped).length,
        friction: friction.length
    };

    // Optional agent-graded quality: if an agent has graded this candidate against
    // the rubric (BENCHMARK.md) and written quality/<candidate>.json, fold it in.
    const qualityPath = join(config.labRoot, "quality", `${config.candidateName}.json`);
    const quality = existsSync(qualityPath) ? parseJson(readFileSync(qualityPath, "utf8")) : null;

    const summary = {
        runId,
        source: {
            name: config.sourceName,
            path: toPosix(config.source.path),
            origin: toPosix(config.source.origin),
            install: config.source.install
        },
        workspace: toPosix(config.workspace),
        sourceVersionBefore: before,
        sourceVersionAfter: after,
        sourceUnchanged: !before || !after || before === after,
        originUnchanged: !originBefore || !originAfter || originBefore === originAfter,
        counts,
        score: score({ results, scenarios, quality }),
        scenarios: results.map((result) => ({
            id: result.id,
            ok: result.ok,
            skipped: result.skipped,
            skipReason: result.skipReason || "",
            fixtureDir: result.fixtureDir || "",
            commands: result.commands.map((command) => ({
                command: command.command,
                status: command.status
            })),
            friction: result.friction
        }))
    };
    // Gradeable artifact: what an agent needs to score the quality aspect against
    // the rubric (BENCHMARK.md). The lab emits it; the agent writes the grade to
    // quality/<candidate>.json, picked up on the next run.
    writeFileSync(join(runDir, "quality-input.json"), JSON.stringify({
        candidate: config.candidateName,
        deterministicOverall: summary.score?.overall ?? null,
        graded: Boolean(quality),
        rubric: "BENCHMARK.md > Qualitative aspects (coherence, clarity, AC discipline)",
        review: { candidatePath: toPosix(config.source.path), personas: ".hos/persona", protocols: ".hos/doc/protocol" },
        frictions: friction
    }, null, 2) + "\n");

    const artifacts = writeRunReport({ runDir, summary, friction });

    return {
        ok: counts.failed === 0 && friction.length === 0,
        runId,
        runDir: toPosix(runDir),
        artifacts,
        summary,
        friction
    };
}
