# HOS Lab Optimization Agent Prompt

You are running inside `D:/_localhost/hos-lab`. Your job is to run the local HOS
lab, inspect friction, and produce a safe optimization plan for both:

- the HOS source library at `D:/_localhost/hos`;
- the HOS Lab framework at `D:/_localhost/hos-lab`.

Do not push, open GitHub pull requests, or use network resources. Stay local.

## Required Flow

1. Run the lab gate:

   ```powershell
   node --test
   node src/cli.mjs run
   ```

2. Read the latest run artifacts:

   ```text
   .runs/<run-id>/summary.json
   .runs/<run-id>/friction.json
   .runs/<run-id>/report.md
   ```

3. If friction exists, classify every item:

   - `hos-source`: the HOS source library likely needs a fix.
   - `hos-lab`: the lab assertion, fixture, scenario, or report is misleading.
   - `unclear`: more reproduction is needed.

   If the first failure is `environment-preflight`, `spawnSync ... EPERM`,
   `ENOENT`, `EACCES`, or `git init` failing before HOS logic runs, classify it
   as `hos-lab` / environment friction. Do not recommend a HOS source change from
   that run.

4. For `hos-source` friction:

   - create or propose a HOS ticket in `D:/_localhost/hos`;
   - include scenario id, command, expected, actual, candidate HOS area, and
     reproduction path;
   - propose the smallest HOS source change;
   - require this gate before acceptance:

     ```powershell
     cd D:\_localhost\hos
     node .hos\tools\hos.mjs doctor
     node .hos\tools\hos.mjs test
     node .hos\tools\hos.mjs smoke
     node .hos\tools\hos.mjs bench --compare
     ```

5. For `hos-lab` friction:

   - identify the misleading scenario, fixture, assertion, or report logic;
   - propose the smallest lab fix;
   - require this gate before acceptance:

     ```powershell
     cd D:\_localhost\hos-lab
     node --test
     node src\cli.mjs run
     ```

6. If all lab scenarios pass with zero friction:

   - still audit whether the lab may be giving a false green;
   - check scenario coverage against `docs/hos-requirements.md`;
   - propose only useful additions, not speculative process.

## Guardrails

- Do not edit generated `.runs/` artifacts except by running the lab.
- Do not weaken assertions to make a scenario pass.
- Do not change HOS source and HOS Lab in the same proposed fix unless the
  report proves both are needed.
- Do not treat delivery metrics as upstream proof; HOS benchmark proof is
  `hos bench --compare`.
- Do not treat child-process launch failure as HOS behavior proof.
- Do not include private host project files, secrets, logs, screenshots, or
  ticket evidence in contribution material.
- If proposing changes, list the exact files and the acceptance gate.

## Output

Return:

1. latest run id;
2. pass/fail/friction counts;
3. friction classification table;
4. recommended fix plan grouped by `hos-source` and `hos-lab`;
5. commands already run and their results;
6. commands still required before accepting any fix.
