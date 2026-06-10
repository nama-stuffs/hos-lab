// Resolves a candidate - a HOS variant under test - to a concrete source
// directory the lab can install from. A candidate NEVER mutates the original
// repository: every candidate is materialized into the run workspace as the
// drop-in surface a real user receives, so persona rewrites and protocol tweaks
// can be benchmarked safely side by side.
//
// Cold-start fidelity: for a git-backed candidate the materialized surface is
// the TRACKED `.hos/` + `AGENTS.md` set (clean-clone equivalence). Local runtime
// state - caches, inboxes, baselines, dogfood tickets, reports - never reaches a
// real install, so it never reaches a fixture either; and a file that exists
// locally but was never committed fails here exactly as it would fail users.
// Content is read from the working tree, so uncommitted edits are benchmarked
// as they would ship. Non-git candidates (overlay output, plain dirs) fall back
// to a plain copy.
//
// Config shapes (hos-lab.config.json):
//   "candidates": {
//     "default":       { "type": "local",   "path": "../hos" },
//     "lean-personas": { "type": "overlay", "base": "default", "overlay": "overlays/lean-personas" }
//   }
// `sources` is still accepted as a fallback alias for `candidates`.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export function candidateDefs(config) {
    return config.candidates || config.sources || {};
}

function hasCli(path) {
    return existsSync(join(path, ".hos", "tools", "hos.mjs"));
}

// The tracked drop-in file list, or null when the path is not a git work tree
// (or git is unavailable).
function trackedDropIn(path) {
    try {
        const stdout = execFileSync("git", ["-C", path, "ls-files", ".hos", "AGENTS.md"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"]
        });
        const files = stdout.split("\n").map((line) => line.trim()).filter(Boolean);
        return files.length ? files : null;
    } catch {
        return null;
    }
}

// Materialize the drop-in surface of `sourcePath` into `dir`. Returns how the
// surface was derived: "git-tracked" (clean-clone equivalent) or "copy".
export function materializeDropIn(sourcePath, dir) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });

    const tracked = trackedDropIn(sourcePath);
    if (tracked) {
        let copied = 0;
        for (const file of tracked) {
            const from = join(sourcePath, file);
            // A tracked file deleted from the working tree is about to be
            // removed; the surface under test is the tree as it would ship.
            if (!existsSync(from)) {
                continue;
            }
            const to = join(dir, file);
            mkdirSync(dirname(to), { recursive: true });
            cpSync(from, to);
            copied++;
        }
        return { mode: "git-tracked", files: copied };
    }

    cpSync(join(sourcePath, ".hos"), join(dir, ".hos"), { recursive: true });
    if (existsSync(join(sourcePath, "AGENTS.md"))) {
        cpSync(join(sourcePath, "AGENTS.md"), join(dir, "AGENTS.md"));
    }
    return { mode: "copy", files: null };
}

// Resolve a candidate by name to { name, path, origin, materialized, install }.
// `path` is the clean install surface fixtures copy from; `origin` is the
// original repository, which the lab only ever reads. `workspace` is the
// per-run directory candidates are materialized into.
export function resolveCandidate(name, config, workspace) {
    const defs = candidateDefs(config);
    const def = defs[name];
    if (!def) {
        throw new Error(`unknown candidate: ${name} (have: ${Object.keys(defs).join(", ") || "none"})`);
    }

    if (def.type === "local") {
        const origin = resolve(config.labRoot, def.path);
        if (!hasCli(origin)) {
            throw new Error(`candidate "${name}" has no HOS CLI at ${origin}`);
        }
        const dir = join(workspace, "candidates", name);
        const install = materializeDropIn(origin, dir);
        if (!hasCli(dir)) {
            throw new Error(`candidate "${name}" materialized without a HOS CLI - is .hos/ tracked in ${origin}?`);
        }
        return { name, path: dir, origin, materialized: true, install };
    }

    if (def.type === "overlay") {
        if (!def.base) {
            throw new Error(`overlay candidate "${name}" needs a base`);
        }
        const base = resolveCandidate(def.base, config, workspace);
        const dir = join(workspace, "candidates", name);
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(dir, { recursive: true });

        // The base is already a clean install surface; the overlay (a tree
        // mirroring the candidate root) is applied over a copy of it.
        cpSync(join(base.path, ".hos"), join(dir, ".hos"), { recursive: true });
        if (existsSync(join(base.path, "AGENTS.md"))) {
            cpSync(join(base.path, "AGENTS.md"), join(dir, "AGENTS.md"));
        }
        const overlayDir = resolve(config.labRoot, def.overlay || "");
        if (def.overlay && existsSync(overlayDir)) {
            cpSync(overlayDir, dir, { recursive: true });
        }
        if (!hasCli(dir)) {
            throw new Error(`overlay candidate "${name}" produced no HOS CLI (base "${base.name}" broken?)`);
        }
        return { name, path: dir, origin: base.origin, materialized: true, base: base.name, install: { ...base.install, overlay: def.overlay || "" } };
    }

    throw new Error(`unsupported candidate type: ${def.type} (for "${name}")`);
}
