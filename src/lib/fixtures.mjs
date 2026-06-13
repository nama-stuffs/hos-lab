import { execFileSync } from "node:child_process";
import {
    cpSync,
    existsSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync
} from "node:fs";
import { cp } from "node:fs/promises";
import { join, relative } from "node:path";

export function hasGit() {
    try {
        execFileSync("git", ["--version"], { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

// Async copy so many fixtures can materialize concurrently: when the runner
// drives scenarios in parallel, a synchronous cpSync here would block the event
// loop and serialize every other scenario's spawns behind this one copy.
async function copyHosDir(sourcePath, targetPath) {
    const sourceHos = join(sourcePath, ".hos");
    await cp(sourceHos, join(targetPath, ".hos"), {
        recursive: true,
        filter: (src) => {
            const rel = relative(sourceHos, src).replaceAll("\\", "/");
            // Copy the whole harness surface; only disposable run artifacts
            // (reports, per-ticket evidence) are left out. task/ now holds shipped
            // playbooks, so it is part of the surface, not scratch. The full
            // surface must be copied verbatim - the upgrade no-op scenario diffs
            // the fixture against the source, so any omission shows up as drift.
            return rel === ""
                || (!rel.startsWith("reports/")
                    && !/\/evidence(\/|$)/.test(rel));
        }
    });
}

async function dropIn(sourcePath, targetPath) {
    await copyHosDir(sourcePath, targetPath);
    if (!existsSync(join(targetPath, "AGENTS.md"))) {
        cpSync(join(sourcePath, "AGENTS.md"), join(targetPath, "AGENTS.md"));
    }
}

function runHos(targetPath, args) {
    const stdout = execFileSync(process.execPath, [join(targetPath, ".hos", "tools", "hos.mjs"), ...args], {
        cwd: targetPath,
        encoding: "utf8"
    }).trim();
    try {
        return JSON.parse(stdout);
    } catch {
        return stdout;
    }
}

function packageJson(scripts = {}) {
    return JSON.stringify({ name: "lab-host", scripts }, null, 2) + "\n";
}

async function setupEmpty(sourcePath, targetPath) {
    await dropIn(sourcePath, targetPath);
    return {};
}

async function setupNode(sourcePath, targetPath) {
    mkdirSync(join(targetPath, "src"), { recursive: true });
    writeFileSync(join(targetPath, "README.md"), "# Host Project\n");
    writeFileSync(join(targetPath, "src", "index.js"), "export const answer = 42;\n");
    writeFileSync(join(targetPath, "package.json"), packageJson({
        dev: "vite",
        build: "tsc",
        lint: "eslint .",
        test: "node --test",
        e2e: "playwright test"
    }));
    await dropIn(sourcePath, targetPath);
    return {};
}

async function setupPython(sourcePath, targetPath) {
    mkdirSync(join(targetPath, "src"), { recursive: true });
    writeFileSync(join(targetPath, "pyproject.toml"), "[project]\nname = \"lab-python\"\n");
    writeFileSync(join(targetPath, "src", "app.py"), "print('hello')\n");
    await dropIn(sourcePath, targetPath);
    return {};
}

async function setupDocs(sourcePath, targetPath) {
    mkdirSync(join(targetPath, "src"), { recursive: true });
    writeFileSync(join(targetPath, "README.md"), "# Keep Me\n");
    writeFileSync(join(targetPath, "DESIGN.md"), "# Existing Design\n");
    writeFileSync(join(targetPath, "CLAUDE.md"), "See AGENTS.md.\n");
    writeFileSync(join(targetPath, ".gitignore"), "dist/\n");
    writeFileSync(join(targetPath, "src", "index.js"), "export const host = true;\n");
    writeFileSync(join(targetPath, "package.json"), packageJson({ test: "node --test" }));
    await dropIn(sourcePath, targetPath);
    return {};
}

async function setupAgents(sourcePath, targetPath) {
    mkdirSync(join(targetPath, "src"), { recursive: true });
    writeFileSync(join(targetPath, "AGENTS.md"), "# Host Agents\n\nHouse rule: ship small.\n");
    writeFileSync(join(targetPath, "package.json"), packageJson({ test: "node --test" }));
    await dropIn(sourcePath, targetPath);
    return {};
}

async function setupUpgrade(sourcePath, targetPath) {
    await dropIn(sourcePath, targetPath);
    runHos(targetPath, ["init", "--name", "Lab Upgrade"]);
    const ticket = runHos(targetPath, ["ticket", "create", "Keep me through upgrade"]);
    const settingsPath = join(targetPath, ".hos", "hos.json");
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    settings.hos = { ...(settings.hos || {}), version: "0.0.1" };
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    // The fixture owns which files it edits, so the scenario asserts the merge
    // capability without hardcoding names a persona rewrite might remove: a local
    // edit the three-way merge must KEEP, and a deleted file it must restore.
    const localFile = "persona/architect.md";
    writeFileSync(join(targetPath, ".hos", localFile), "LOCAL EDIT - keep me\n");
    const addedFile = "persona/ui.md";
    rmSync(join(targetPath, ".hos", addedFile), { force: true });
    return { ticketId: ticket.id, localFile, addedFile };
}

async function setupGit(sourcePath, targetPath) {
    if (!hasGit()) {
        return { skip: "git not available" };
    }
    execFileSync("git", ["init", "-q"], { cwd: targetPath, stdio: "ignore" });
    mkdirSync(join(targetPath, "src"), { recursive: true });
    writeFileSync(join(targetPath, "README.md"), "# Git Host\n");
    writeFileSync(join(targetPath, "AGENTS.md"), "# Git Host Agents\n\nKeep this.\n");
    writeFileSync(join(targetPath, "package.json"), packageJson({ test: "node --test" }));
    await dropIn(sourcePath, targetPath);
    return {};
}

async function setupPrivacy(sourcePath, targetPath) {
    mkdirSync(join(targetPath, "src"), { recursive: true });
    writeFileSync(join(targetPath, "src", "private.js"), "PRIVATE_HOST_CODE_SENTINEL\n");
    await dropIn(sourcePath, targetPath);
    return { sentinel: "PRIVATE_HOST_CODE_SENTINEL" };
}

async function setupAudit(sourcePath, targetPath) {
    await dropIn(sourcePath, targetPath);
    runHos(targetPath, ["init", "--name", "Lab Audit"]);
    const settingsPath = join(targetPath, ".hos", "hos.json");
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    settings.audit = { include: ["src/**/*.js"], exclude: [] };
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    mkdirSync(join(targetPath, "src"), { recursive: true });
    writeFileSync(join(targetPath, "src", "app.js"), "export const a = 1;\n");
    return {};
}

const FIXTURES = {
    empty: setupEmpty,
    "audit-scope": setupAudit,
    "existing-node": setupNode,
    "existing-python": setupPython,
    "docs-preserved": setupDocs,
    "existing-agents": setupAgents,
    "existing-hos-upgrade": setupUpgrade,
    "git-backed": setupGit,
    privacy: setupPrivacy,
    "evidence-reporting": setupEmpty
};

export async function prepareFixture({ scenario, sourcePath, runDir }) {
    const fixtureDir = join(runDir, "fixtures", scenario.id);
    mkdirSync(fixtureDir, { recursive: true });
    const setup = FIXTURES[scenario.fixture];
    if (!setup) {
        throw new Error(`unknown fixture: ${scenario.fixture}`);
    }
    const context = (await setup(sourcePath, fixtureDir)) || {};
    return { fixtureDir, context };
}
