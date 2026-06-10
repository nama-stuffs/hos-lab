// Cold-start fidelity: the surface a fixture installs from must be what a real
// user receives (the tracked drop-in set), and a flow that stops for a human
// question must surface as friction without any per-scenario assertion.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { materializeDropIn } from "../src/lib/candidate.mjs";
import { containsQuestion } from "../src/lib/runner.mjs";
import { hasGit } from "../src/lib/fixtures.mjs";

function gitRepoWithRuntimeJunk() {
    const repo = mkdtempSync(join(tmpdir(), "hos-lab-cold-"));
    mkdirSync(join(repo, ".hos", "tools"), { recursive: true });
    writeFileSync(join(repo, ".hos", "tools", "hos.mjs"), "// cli\n");
    writeFileSync(join(repo, "AGENTS.md"), "# AGENTS.md\n");
    const git = (...args) => execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" });
    git("init", "-q");
    git("config", "user.email", "lab@test");
    git("config", "user.name", "lab");
    git("add", ".hos", "AGENTS.md");
    git("commit", "-qm", "init");

    // Local runtime state a clean clone never contains.
    mkdirSync(join(repo, ".hos", ".cache"), { recursive: true });
    writeFileSync(join(repo, ".hos", ".cache", "junk.txt"), "junk\n");
    mkdirSync(join(repo, ".hos", "tickets", "T-1"), { recursive: true });
    writeFileSync(join(repo, ".hos", "tickets", "T-1", "claim.json"), "{}\n");
    // An uncommitted edit to a tracked file ships as the working tree has it.
    writeFileSync(join(repo, ".hos", "tools", "hos.mjs"), "// cli v2\n");
    return repo;
}

test("a git candidate materializes as a clean clone: tracked set, working-tree content", { skip: !hasGit() }, () => {
    const repo = gitRepoWithRuntimeJunk();
    const out = join(repo, "out");
    try {
        const install = materializeDropIn(repo, out);

        assert.equal(install.mode, "git-tracked");
        assert.ok(existsSync(join(out, ".hos", "tools", "hos.mjs")), "tracked file present");
        assert.ok(existsSync(join(out, "AGENTS.md")), "AGENTS.md present");
        assert.ok(!existsSync(join(out, ".hos", ".cache")), "runtime cache never ships");
        assert.ok(!existsSync(join(out, ".hos", "tickets", "T-1")), "dogfood tickets never ship");
        assert.match(readFileSync(join(out, ".hos", "tools", "hos.mjs"), "utf8"), /cli v2/, "uncommitted edits are benchmarked as they would ship");
    } finally {
        rmSync(repo, { recursive: true, force: true });
    }
});

test("a non-git candidate falls back to a plain copy", () => {
    const dir = mkdtempSync(join(tmpdir(), "hos-lab-plain-"));
    const out = join(dir, "out");
    try {
        mkdirSync(join(dir, ".hos", "tools"), { recursive: true });
        writeFileSync(join(dir, ".hos", "tools", "hos.mjs"), "// cli\n");
        writeFileSync(join(dir, "AGENTS.md"), "# AGENTS.md\n");

        const install = materializeDropIn(dir, out);
        assert.equal(install.mode, "copy");
        assert.ok(existsSync(join(out, ".hos", "tools", "hos.mjs")));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("containsQuestion finds interactive asks anywhere in command output", () => {
    assert.equal(containsQuestion({ ok: true, agents: { state: "has-content", action: "ask" } }), true);
    assert.equal(containsQuestion({ questions: [{ id: "q1" }] }), true);
    assert.equal(containsQuestion({ plan: { steps: [{ questions: [] }] } }), false);
    assert.equal(containsQuestion({ ok: true, agents: { state: "already-hos", action: "noop" } }), false);
    assert.equal(containsQuestion(undefined), false);
});
