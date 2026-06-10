# HOS Lab

Black-box **cold-start benchmark** for HOS. It installs a **candidate** (any HOS
variant) into generated fixture projects exactly as a fresh clone would land
(tracked files only - local runtime state never ships), drives the flows
unattended, scores the result across objective aspects, records classified
process friction, and compares it to a committed baseline - or two candidates
head to head. A flow that stops for an undeclared human question is friction
(`manual-steering`), and `run` exits non-zero on any failure, friction, or
baseline regression - so the gate runs hands-off. Scenarios assert capabilities,
not file names, so persona rewrites and refactors do not false-fail, and the
original repo is never mutated.

**Status: beta.** It benchmarks [HOS](https://github.com/nama-stuffs/hos). See
[BENCHMARK.md](BENCHMARK.md) for the criteria, the scoring, and the anti-Goodhart
progression protocol.

## Candidates

Defined in `hos-lab.config.json`. The `default` candidate expects the
[HOS](https://github.com/nama-stuffs/hos) repo cloned next to this one (`../hos`).
A `local` candidate is a path; an `overlay` candidate is a base with file
overrides applied to a copy (test a persona rewrite without touching the source):

```jsonc
"candidates": {
  "default":     { "type": "local",   "path": "../hos" },
  "weak-policy": { "type": "overlay", "base": "default", "overlay": "overlays/weak-policy" }
}
```

## Commands

```bash
node src/cli.mjs run                          # score the default candidate vs its baseline
node src/cli.mjs run --candidate weak-policy  # score a variant
node src/cli.mjs run --candidate-path <dir>   # score any checkout (e.g. a released clone)
node src/cli.mjs run --scenario new-empty-project
node src/cli.mjs run --save-baseline          # run and freeze the result as the baseline
node src/cli.mjs baseline default             # freeze a candidate's baseline
node src/cli.mjs battle default weak-policy   # head-to-head; the dominating candidate wins
node src/cli.mjs report <run-id>
node src/cli.mjs clean
node --test                                   # the lab's own unit tests
```

Committed baselines live in `baselines/`; held-out scenarios in
`scenarios/heldout/`; generated run artifacts under `.runs/`.

## License

MIT. See [LICENSE](LICENSE).

---

Made with 🤍 in Hungary.
