import { execFileSync } from "node:child_process";
import {
    cpSync,
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync
} from "node:fs";
import { join, relative } from "node:path";

export function hasGit() {
    try {
        execFileSync("git", ["--version"], { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

function copyHosDir(sourcePath, targetPath) {
    const sourceHos = join(sourcePath, ".hos");
    cpSync(sourceHos, join(targetPath, ".hos"), {
        recursive: true,
        filter: (src) => {
            const rel = relative(sourceHos, src).replaceAll("\\", "/");
            return rel === ""
                || (!rel.startsWith("reports/")
                    && (!rel.startsWith("task/") || rel === "task/README.md")
                    && !/\/evidence(\/|$)/.test(rel));
        }
    });
}

function dropIn(sourcePath, targetPath) {
    copyHosDir(sourcePath, targetPath);
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

function setupEmpty(sourcePath, targetPath) {
    dropIn(sourcePath, targetPath);
    return {};
}

function setupNode(sourcePath, targetPath) {
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
    dropIn(sourcePath, targetPath);
    return {};
}

function setupPython(sourcePath, targetPath) {
    mkdirSync(join(targetPath, "src"), { recursive: true });
    writeFileSync(join(targetPath, "pyproject.toml"), "[project]\nname = \"lab-python\"\n");
    writeFileSync(join(targetPath, "src", "app.py"), "print('hello')\n");
    dropIn(sourcePath, targetPath);
    return {};
}

function setupDocs(sourcePath, targetPath) {
    mkdirSync(join(targetPath, "src"), { recursive: true });
    writeFileSync(join(targetPath, "README.md"), "# Keep Me\n");
    writeFileSync(join(targetPath, "DESIGN.md"), "# Existing Design\n");
    writeFileSync(join(targetPath, "CLAUDE.md"), "See AGENTS.md.\n");
    writeFileSync(join(targetPath, ".gitignore"), "dist/\n");
    writeFileSync(join(targetPath, "src", "index.js"), "export const host = true;\n");
    writeFileSync(join(targetPath, "package.json"), packageJson({ test: "node --test" }));
    dropIn(sourcePath, targetPath);
    return {};
}

function setupAgents(sourcePath, targetPath) {
    mkdirSync(join(targetPath, "src"), { recursive: true });
    writeFileSync(join(targetPath, "AGENTS.md"), "# Host Agents\n\nHouse rule: ship small.\n");
    writeFileSync(join(targetPath, "package.json"), packageJson({ test: "node --test" }));
    dropIn(sourcePath, targetPath);
    return {};
}

function setupUpgrade(sourcePath, targetPath) {
    dropIn(sourcePath, targetPath);
    runHos(targetPath, ["init", "--name", "Lab Upgrade"]);
    const ticket = runHos(targetPath, ["ticket", "create", "Keep me through upgrade"]);
    const settingsPath = join(targetPath, ".hos", "hos.json");
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    settings.hos = { ...(settings.hos || {}), version: "0.0.1" };
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    // The fixture owns which framework file is made stale, so the scenario asserts
    // the capability (a stale framework file is restored) without hardcoding a
    // name that a persona rewrite might remove.
    const staleFile = "persona/architect.md";
    writeFileSync(join(targetPath, ".hos", staleFile), "STALE\n");
    return { ticketId: ticket.id, staleFile };
}

function setupGit(sourcePath, targetPath) {
    if (!hasGit()) {
        return { skip: "git not available" };
    }
    execFileSync("git", ["init", "-q"], { cwd: targetPath, stdio: "ignore" });
    mkdirSync(join(targetPath, "src"), { recursive: true });
    writeFileSync(join(targetPath, "README.md"), "# Git Host\n");
    writeFileSync(join(targetPath, "AGENTS.md"), "# Git Host Agents\n\nKeep this.\n");
    writeFileSync(join(targetPath, "package.json"), packageJson({ test: "node --test" }));
    dropIn(sourcePath, targetPath);
    return {};
}

function setupPrivacy(sourcePath, targetPath) {
    mkdirSync(join(targetPath, "src"), { recursive: true });
    writeFileSync(join(targetPath, "src", "private.js"), "PRIVATE_HOST_CODE_SENTINEL\n");
    dropIn(sourcePath, targetPath);
    return { sentinel: "PRIVATE_HOST_CODE_SENTINEL" };
}

const FIXTURES = {
    empty: setupEmpty,
    "existing-node": setupNode,
    "existing-python": setupPython,
    "docs-preserved": setupDocs,
    "existing-agents": setupAgents,
    "existing-hos-upgrade": setupUpgrade,
    "git-backed": setupGit,
    privacy: setupPrivacy,
    "evidence-reporting": setupEmpty
};

export function prepareFixture({ scenario, sourcePath, runDir }) {
    const fixtureDir = join(runDir, "fixtures", scenario.id);
    mkdirSync(fixtureDir, { recursive: true });
    const setup = FIXTURES[scenario.fixture];
    if (!setup) {
        throw new Error(`unknown fixture: ${scenario.fixture}`);
    }
    const context = setup(sourcePath, fixtureDir) || {};
    return { fixtureDir, context };
}
