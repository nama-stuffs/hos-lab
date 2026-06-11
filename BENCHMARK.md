# HOS Lab Benchmark

The lab judges a **candidate** - any HOS variant - on two things at once:

1. **A score** across objective aspects, compared to a committed baseline, so a
   change can be told "better / same / worse" automatically.
2. **A process-friction analysis**, so the same run that scores a candidate also
   surfaces *why* it loses points and what to fix. Frictionless work is faster and
   cheaper, so removing friction literally raises the score.

This is a benchmark, not a regression test bolted to one implementation. Scenarios
assert **capabilities**, not file names, so a persona rewrite or refactor does not
false-fail. Nothing here hardcodes the original repo.

## Candidates (testing variations)

A candidate is defined in `hos-lab.config.json`:

```jsonc
"candidates": {
  "default":       { "type": "local",   "path": "../hos" },
  "lean-personas": { "type": "overlay", "base": "default", "overlay": "overlays/lean-personas" }
}
```

An `overlay` candidate is the base copied into the run workspace with the overlay
files applied on top. **The original repo is never mutated**, so you can benchmark
a persona rewrite, a protocol tweak, or a tooling change side by side. Run a
candidate with `run --candidate <name>`; benchmark any checkout without a config
entry with `run --candidate-path <dir>`; compare two with `battle <A> <B>`.

## Cold-start fidelity

The lab measures the experience of a **fresh, unattended install** - the moment a
real user drops HOS into a project and an agent drives it cold. Two rules make
every run faithful to that moment:

1. **Clean-clone materialization.** A git-backed candidate is installed from its
   *tracked* `.hos/` + `AGENTS.md` set, exactly what a clone delivers. Local
   runtime state (caches, inboxes, dogfood tickets, reports) never reaches a
   fixture, and a file missing from git fails here the same way it fails users.
   Content comes from the working tree, so uncommitted edits are benchmarked as
   they would ship.
2. **The no-steering invariant.** After every successful command, the runner
   scans the output for an interactive question (`action: "ask"` or a non-empty
   `questions` list). An undeclared question is `manual-steering` friction - a
   cold start stopped for a human. Scenarios that test the asking capability
   itself opt in per command with `expectsQuestion: true`.

The headline scenario is `cold-start-journey`: adopt into a real project, then
the full intake -> plan -> compose -> prove -> fresh-session verify -> close ->
retrospective -> report chain, question-free, with the report content asserted
at the end. The chain exercises HOS's contract v2: every lifecycle actor is
composed or dispatched on the record, the verify event names the planned
verifier, and verification runs outside every work session - the held-out
`verify-needs-fresh-context` scenario closes the gate on a candidate that
accepts a self-declared, same-session verifier. `run` exits non-zero on any
failure, friction, or baseline regression, so CI or a loop needs no human to
read the result.

## Aspects and weights

Each aspect scores 0..1; the overall is their weighted mean. Weights are tunable
here and in `src/lib/scoring.mjs`.

| Aspect | Weight | Measures | Deterministic |
| --- | --- | --- | --- |
| `install` | 1 | install / adopt / merge / preserve fidelity | yes |
| `upgrade` | 1 | framework re-sync + project-state preservation | yes |
| `orchestration` | 1 | claim mutex, deep log, dispatch, stale reclaim | yes |
| `spec` | 1 | acceptance-criteria format, collection, lint | yes |
| `retrieval` | 1 | policy recall / application / precision (`hos bench`) | yes |
| `memory` | 1 | typed long-term memory: kinds and persona-namespaced compose | yes |
| `process` | 1 | lifecycle: verify + retro events, execute/verify split | yes |
| `safety` | 1 | contribution privacy and scope | yes |
| `autonomy` | 1 | change-level gate: granted vs required, escalation | yes |
| `audit` | 1 | production-file audit ledger: unaudited / drift / record | yes |
| `tasks` | 1 | keyword-activated task playbooks: list and match routing | yes |
| `efficiency` | 1.5 | absence of process friction (faster, fewer credits) | yes |
| `coverage` | 1 | overall scenario pass rate | yes |

A scenario maps to an aspect by its `classification` (or an explicit `aspect`).
An aspect's score is the pass rate of its scenarios. `efficiency` falls as
process frictions accrue, so it is the dimension a friction fix moves.

## Friction taxonomy

Every failure is recorded with a `type`, so the analysis is actionable:

| Type | Meaning | Feeds |
| --- | --- | --- |
| `blocking` | a command that should pass exits non-zero - an agent would be stuck | efficiency |
| `missing-capability` | the harness lacks a command the flow needs | efficiency |
| `inefficiency` / `redundant-step` | a flow takes more work than it should | efficiency |
| `manual-steering` | the flow stopped for an undeclared human question | efficiency |
| `assertion` | a capability is present but its outcome is wrong | the aspect |
| `environment` / `harness` | the lab or host, not the candidate | neither |

Each friction carries a `candidateHosArea` and an `expect`, so the fix has an
address. The improvement loop is: run -> read frictions -> apply the fix in the
candidate -> re-run -> the efficiency aspect (and the overall) rises.

## Baseline and comparison

`baseline <candidate>` freezes the current score to `baselines/<candidate>.json`
(committed in the lab). Every `run` then reports `vsBaseline`: per-aspect delta and
an overall verdict. The baseline is a **regression floor**, not a target.

## Progression protocol (anti-Goodhart)

A fixed score on a fixed set cannot be "tuned up" honestly - and it should not be.
Progression has exactly two legitimate engines:

1. **Add a scenario that captures a real, observed failure or gap.** This raises
   coverage - the honest way the score grows.
2. **Move a quality aspect** (retrieval precision, efficiency) that is expensive
   to game.

A change that moves no quality aspect and adds no coverage is `same`, not
progress. Deterministic aspects must never regress (the floor).

**Held-out set.** `scenarios/heldout/` is the sealed gate you do *not* iterate
against. Overfitting to the visible scenarios shows up as a held-out regression.

**Battle verdict (automatic repository progression).** `battle A B` runs both on
the same set. B replaces A only if it **dominates**: no aspect worse, at least one
better, and held-out not worse. Otherwise B is rejected (`mixed`, `tie`, or A
wins). This rule is automatable.

## Qualitative aspects (agent-graded)

Some quality is not mechanically checkable. The lab stays zero-dependency and does
**not** embed an LLM; each run emits `quality-input.json` (frictions plus the
files to review), and an agent - the same host that reads frictions - grades the
candidate against this pinned rubric, each dimension 0..1:

- **coherence** - personas, protocols, and audits agree; no contradictions.
- **clarity** - each document states action and validation, with no wording that
  changes no behavior (`.hos/doc/audit/doc.md`).
- **ac-discipline** - spec capabilities read as atomic, minimal, non-redundant
  acceptance criteria.

The agent writes `quality/<candidate>.json`, folded into the next run as the
`quality` aspect:

```jsonc
{ "score": 0.94,
  "dimensions": { "coherence": 0.95, "clarity": 0.95, "ac-discipline": 0.92 },
  "notes": "one line", "gradedBy": "agent", "model": "<model>" }
```

For a `battle`, the agent grades both candidates and compares. This is a
**secondary** signal: report it with its dimensions and keep the deterministic
aspects as the hard gate.

## Completion bar

The lab is healthy when scenarios assert capabilities (not implementation
details), the default candidate has a committed baseline, every run reports a
score and a friction analysis vs that baseline, the held-out set passes, and
`battle` can declare a dominating candidate.
