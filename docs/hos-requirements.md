# HOS Functional Requirements

## Drop-In Install

- Empty no-Git projects report `install` after `.hos/` and `AGENTS.md` are
  copied in.
- `hos init --name <name>` generates `DESIGN.md`, `CLAUDE.md`, and `.gitignore`.
- Source `README.md` is not copied to the target root.
- `hos doctor` passes after init.

## Existing Project Adopt

- Existing projects report `adopt`.
- `hos adopt --name <name>` preserves existing root docs, ignore rules, and host
  source files.
- JavaScript package scripts are detected into `hos.json`.
- Non-JS projects return interview signals instead of crashing.

## Existing Harness Merge

- Existing `AGENTS.md` is not overwritten silently.
- `hos merge agents` returns a decision plan.
- `hos merge agents --apply append` preserves host content and appends one HOS
  section.
- Re-running append is idempotent.

## No-Git Compatibility

- Install, adopt, run, and upgrade scenarios pass without `.git`.
- Git is optional and used only when a scenario explicitly asks for it.

## Upgrade

- `hos upgrade --from <fresh-hos>` dry-runs without writing.
- `--apply` refreshes framework-owned files.
- Tickets, memory, spec, bench, reports, task artifacts, registry, and project
  `hos.json` values are preserved.

## Evidence And Reporting

- Ticket, session, report, retrospective, and metrics flows work after install.
- `hos report` writes a readable report.
- `hos metrics` reports verification and retrospective journey events.

## Benchmark And Contribution

- `hos bench --compare` has no regression.
- `hos contribute` writes a local bundle only.
- Contribution bundles exclude host source, secrets, logs, screenshots, and
  ticket evidence unless explicitly approved.
