import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toPosix } from "./config.mjs";

function scenarioLine(result) {
    const status = result.skipped ? "skipped" : result.ok ? "pass" : "fail";
    return `| ${result.id} | ${status} | ${result.commands.length} | ${result.friction.length} |`;
}

function renderMarkdown(summary, friction) {
    const lines = [
        `# HOS Lab Run ${summary.runId}`,
        "",
        `Origin: \`${summary.source.origin || summary.source.path}\` (unchanged: **${summary.originUnchanged === false ? "no" : "yes"}**)`,
        `Install surface: \`${summary.source.path}\` - ${summary.source.install?.mode === "git-tracked" ? `clean-clone equivalent, ${summary.source.install.files} tracked files` : "plain copy"} (unchanged: **${summary.sourceUnchanged ? "yes" : "no"}**)`,
        "",
        "## Summary",
        "",
        `- Passed: ${summary.counts.passed}`,
        `- Failed: ${summary.counts.failed}`,
        `- Skipped: ${summary.counts.skipped}`,
        `- Friction: ${summary.counts.friction}`,
        "",
        "## Scenarios",
        "",
        "| Scenario | Result | Commands | Friction |",
        "| --- | --- | ---: | ---: |",
        ...summary.scenarios.map(scenarioLine),
        ""
    ];

    if (friction.length) {
        lines.push("## Friction", "");
        for (const item of friction) {
            lines.push(
                `### ${item.scenarioId} - ${item.phase}`,
                "",
                `- Expected: ${item.expected}`,
                `- Actual: ${item.actual}`,
                `- Classification: ${item.classification}`,
                `- Candidate HOS area: ${item.candidateHosArea || "-"}`,
                ""
            );
        }
    } else {
        lines.push("## Friction", "", "No friction recorded.", "");
    }

    return lines.join("\n");
}

export function writeRunReport({ runDir, summary, friction }) {
    mkdirSync(runDir, { recursive: true });
    const summaryPath = join(runDir, "summary.json");
    const frictionPath = join(runDir, "friction.json");
    const reportPath = join(runDir, "report.md");

    writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n");
    writeFileSync(frictionPath, JSON.stringify(friction, null, 2) + "\n");
    writeFileSync(reportPath, renderMarkdown(summary, friction));

    return {
        summary: toPosix(summaryPath),
        friction: toPosix(frictionPath),
        report: toPosix(reportPath)
    };
}

export function readRunReport(workspace, runId) {
    const runDir = join(workspace, runId);
    const report = join(runDir, "report.md");
    const summary = join(runDir, "summary.json");
    if (!existsSync(report) || !existsSync(summary)) {
        throw new Error(`no such run report: ${runId}`);
    }
    return {
        runId,
        report: toPosix(report),
        summary: JSON.parse(readFileSync(summary, "utf8")),
        markdown: readFileSync(report, "utf8")
    };
}
