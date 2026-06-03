// Resolves a candidate - a HOS variant under test - to a concrete source
// directory the lab can install from. A candidate NEVER mutates the original
// repository: an overlay is applied to a fresh copy in the run workspace, so
// persona rewrites and protocol tweaks can be benchmarked safely side by side.
//
// Config shapes (hos-lab.config.json):
//   "candidates": {
//     "default":       { "type": "local",   "path": "../hos" },
//     "lean-personas": { "type": "overlay", "base": "default", "overlay": "overlays/lean-personas" }
//   }
// `sources` is still accepted as a fallback alias for `candidates`.

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

export function candidateDefs(config) {
    return config.candidates || config.sources || {};
}

function hasCli(path) {
    return existsSync(join(path, ".hos", "tools", "hos.mjs"));
}

// Resolve a candidate by name to { name, path, materialized, base }. `workspace`
// is where overlay candidates are materialized (a per-run directory).
export function resolveCandidate(name, config, workspace) {
    const defs = candidateDefs(config);
    const def = defs[name];
    if (!def) {
        throw new Error(`unknown candidate: ${name} (have: ${Object.keys(defs).join(", ") || "none"})`);
    }

    if (def.type === "local") {
        const path = resolve(config.labRoot, def.path);
        if (!hasCli(path)) {
            throw new Error(`candidate "${name}" has no HOS CLI at ${path}`);
        }
        return { name, path, materialized: false };
    }

    if (def.type === "overlay") {
        if (!def.base) {
            throw new Error(`overlay candidate "${name}" needs a base`);
        }
        const base = resolveCandidate(def.base, config, workspace);
        const dir = join(workspace, "candidates", name);
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(dir, { recursive: true });

        // Copy the base harness surface (.hos + AGENTS.md) into the candidate dir.
        // The original repo is read-only here; only this copy is altered.
        cpSync(join(base.path, ".hos"), join(dir, ".hos"), { recursive: true });
        if (existsSync(join(base.path, "AGENTS.md"))) {
            cpSync(join(base.path, "AGENTS.md"), join(dir, "AGENTS.md"));
        }

        // Apply the overlay (a tree mirroring the candidate root) over the copy.
        const overlayDir = resolve(config.labRoot, def.overlay || "");
        if (def.overlay && existsSync(overlayDir)) {
            cpSync(overlayDir, dir, { recursive: true });
        }
        if (!hasCli(dir)) {
            throw new Error(`overlay candidate "${name}" produced no HOS CLI (base "${base.name}" broken?)`);
        }
        return { name, path: dir, materialized: true, base: base.name };
    }

    throw new Error(`unsupported candidate type: ${def.type} (for "${name}")`);
}
