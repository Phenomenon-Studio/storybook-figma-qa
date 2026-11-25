---
title: figma-qa init
description: Install the kit into a React + Vite project, wire Storybook and Vitest, install the agent skills, and walk through the first-run checklist.
---

Run it once to set a project up, and again after every kit upgrade. It is the only command that prompts, and it prompts only in a terminal.

## Synopsis

```sh
pnpm dlx @phenomenon-studio/storybook-figma-qa init [--yes] [--dry-run] [--next]
pnpm exec figma-qa init        # once the kit is installed, e.g. after an upgrade
```

| Flag | Effect |
| --- | --- |
| `--yes`, `-y` | No prompt, no secret written, no image pull: the checklist prints and init exits 0. Implied when there is no terminal (CI, agents). |
| `--dry-run` | Prints the plan; writes and runs nothing. |
| `--next` | With no Storybook yet, bootstraps the Storybook 11 beta instead of 10. |

## What it does

`pnpm dlx @phenomenon-studio/storybook-figma-qa init [--yes] [--dry-run] [--next]` installs the kit into a React + Vite project. Each step detects before it acts, so a re-run on a set-up project changes nothing; `--dry-run` prints the plan and writes or runs nothing.

1. **Storybook**: none → `npx storybook@^10 init` for React + Vite (`--next`: `storybook@next`, the 11 beta). Before 10.6 → exit 2 pointing at `storybook upgrade`; no React + Vite (or another framework in `.storybook/main`) → exit 2 naming what it found.
2. **Packages**: project `.npmrc` gets only `@phenomenon-studio:registry=https://npm.pkg.github.com` (the token stays in the user's `~/.npmrc`), and `.gitignore` gets `/figma-qa/.results/` (each run's report and screenshots) unless git already ignores it, then the kit and, when missing, `storybook add @storybook/addon-vitest`.
3. **Config** (magicast, literal shapes only): the kit in `.storybook/main` `addons`, `figmaQa()` in CSF Next `definePreview({ addons })` (a classic preview is left to the preset), `figmaQa()` in Vitest `test.projects`. Any other shape prints the exact snippet and exits 2 after the other steps.
4. **Project**: `"figma-report": "figma-qa report"` script, a `<!-- figma-qa:start -->` rules block in `AGENTS.md` (and `CLAUDE.md` when it doesn't import `@AGENTS.md`; only text between the markers is rewritten), then the installed kit's `figma-qa migrate` (a no-op unless an upgrade changed the refs format; see [Upgrading](../upgrading.md)), then the kit's skills (`figma-qa`: run the report and triage failing cells; `figma-qa-scaffold`: finish a scaffolded story; `figma-qa-variables`: name unnamed Figma variables) via the pinned `skills` CLI into `.agents/skills` and `.claude/skills` (skipped when the copies match the installed kit). The CLI only adds, so first init removes what a newer kit dropped: a skill whose `skills-lock.json` entry points at the kit's `skills` but which the kit no longer ships (`skills remove <name> -y`), and files in a kit skill's copies that the kit no longer has. Skills from any other source are left alone.

5. **First-run wizard**: `doctor`'s human checks, in order: registry → Figma token → file access → Docker / image → variable names → Figma MCP. In a terminal it asks only for what it can act on:
   - `FIGMA_TOKEN`, when missing or rejected (input hidden; empty skips). Validated with `GET /v1/me`, then `/meta` on each Figma file (a token Figma rejects, or whose owner can't open a file, is asked for again) the Figma stories link (committed refs and URLs in Figma story files). It is written to `.env.local` only when `git check-ignore` says that file is ignored; otherwise init writes nothing and prints the line to add yourself. `FIGMA_TOKEN` in the environment wins over `.env.local`; every command reads both.
   - Pull the pinned browser image (`Y/n`), when Docker runs and the image isn't pulled. Without Docker: an info line, reports use host Chromium.
   - Registry auth and the Figma MCP are never asked: a fix line and an info line.

   `--yes` (`-y`) or no terminal (CI, agents): no prompt, no secret written, no pull; the checklist prints and init exits 0. `--dry-run` runs no check (`plan  first-run wizard: …`). A complete setup prints only `ok` and `info` lines and asks nothing. The checklist ends with the PR workflow caller.

It never touches stories, components, tokens, the manager theme, other Vitest projects, git history or CI files. `test/init-cli.test.ts` runs it on copies of both fixtures with the kit stripped.

## Response example

A dry run in `fixtures/sb11`:

```text
figma-qa init --dry-run: the plan; nothing is written or run
ok    storybook: 11.0.0-beta.3 with @storybook/react-vite
write .npmrc: @phenomenon-studio:registry=https://npm.pkg.github.com
ok    package: @phenomenon-studio/storybook-figma-qa
ok    .storybook/main.ts: kit in addons
ok    vitest.config.ts: figmaQa() in test.projects
write AGENTS.md: figma-qa rules block
ok    figma-qa/__refs__: refs format 1, up to date
run   npx -y skills@1.9.0 add ./node_modules/@phenomenon-studio/storybook-figma-qa/skills --copy -y -a claude-code codex
plan  first-run wizard: doctor's human checks, then the checklist
todo  PR workflow: add .github/workflows/figma-qa.yml at the repo root, and a FIGMA_TOKEN repository secret:

name: Figma QA
on: pull_request
…
jobs:
    figma-qa:
        uses: Phenomenon-Studio/storybook-figma-qa/.github/workflows/figma-qa.yml@v0
        secrets:
            FIGMA_TOKEN: ${{ secrets.FIGMA_TOKEN }}
        with:
            working-directory: fixtures/sb11

figma-qa init: dry run, nothing written
```

Each line is one step:

- **`ok`**: the step is already in place, and init leaves it alone.
- **`write`**: init creates or changes the file.
- **`edit`**: you make this change by hand. Init exits 2 after printing the snippet.
- **`run`**: init runs the command.
- **`plan`**: init would act, but can't yet (it waits on a step before it).
- **`todo`**: yours to add when you want it; init never writes it and still exits 0. In the checklist it is a missing human item (see doctor); after it, the PR workflow: the caller job follows, pinned to the kit's major, with `working-directory` when the project isn't the git root. Once any `.github/workflows/*.y{a,}ml` at the repo root calls the kit workflow, the line reads `ok    PR workflow: <file>`.

A run in a terminal ends with the wizard (`fixtures/sb11` copy, against the test Figma stub and fake Docker; the token was typed at the hidden prompt):

```text
ok    skills: .agents/skills, .claude/skills

Figma token: create one (scope: File content, read-only) in Figma → Settings → Security.
Seat: the token's owner needs a Dev or Full seat on the plan that owns the UI kit file (View/Collab seats get 429s).
FIGMA_TOKEN (hidden; empty to skip):
ok    figma token: Fixture Dev
write .env.local: FIGMA_TOKEN

Pull the pinned browser image mcr.microsoft.com/playwright:v1.65.1-noble? [Y/n] y
run   docker pull mcr.microsoft.com/playwright:v1.65.1-noble
…

figma-qa init: checklist
todo  registry: no GitHub Packages token in /Users/you/.npmrc; installs of the kit fail without one
      fix: gh auth refresh -s read:packages
      fix: echo "//npm.pkg.github.com/:_authToken=$(gh auth token)" >> ~/.npmrc
      fix: no gh: a classic personal access token with read:packages in that line (//npm.pkg.github.com/:_authToken=<token>)
ok    figma token: Fixture Dev (FIGMA_TOKEN from .env.local)
ok    file access: FIXTUREKIT "Fixture UI kit", version 1
ok    browser: Docker runs; pinned image mcr.microsoft.com/playwright:v1.65.1-noble pulled
ok    variables: every bound variable is named in figma-qa/__refs__/variables.json
info  figma mcp: agents name variables and read annotations through the Figma MCP server's use_figma; add it to your agent
todo  PR workflow: add .github/workflows/figma-qa.yml at the repo root, and a FIGMA_TOKEN repository secret:

name: Figma QA
…

figma-qa init: done
```

- **`Figma token:` … `FIGMA_TOKEN (hidden; empty to skip):`**: the token prompt, shown only when the token is missing or rejected. A rejected token prints `todo  figma token: Figma rejected it; paste another` and asks again. When `.env.local` isn't gitignored it prints `todo  .env.local: not gitignored, so the token is not written. Ignore it, then add this line:` and the `FIGMA_TOKEN=…` line, and writes nothing.
- **`Pull the pinned browser image …? [Y/n]`**: only when Docker runs and the image is missing; Enter means yes.
- **`figma-qa init: checklist`**: doctor's human checks after the prompts, read as in [`figma-qa doctor`](./doctor.md), then the PR workflow line. Under `--yes` or without a terminal only this part prints. A `FIGMA_TOKEN` from the environment that Figma rejects is never asked for (a token saved to `.env.local` would not be read): `block figma token: Figma rejected FIGMA_TOKEN from env`, with the fix.

After an upgrade that dropped a skill (`figma-qa-old`) and a file of the `figma-qa` skill (`fixtures/sb11` copy; the skills CLI's own progress output shortened):

```text
ok    figma-qa/__refs__: refs format 1, up to date
run   npx -y skills@1.9.0 remove figma-qa-old -y
…
write .agents/skills/figma-qa/OLD.md: removed, the kit no longer ships it
write .claude/skills/figma-qa/OLD.md: removed, the kit no longer ships it
run   npx -y skills@1.9.0 add ./node_modules/@phenomenon-studio/storybook-figma-qa/skills --copy -y -a claude-code codex
…
```

- **`run   … remove <names> -y`**: the dropped skills, from both agent dirs and `skills-lock.json`.
- **`write <file>: removed, the kit no longer ships it`**: a stale file in a kit skill's copy, deleted; the `add` after it refreshes the rest.

A re-run on a set-up project writes nothing: its steps print `ok`, and the checklist shows only what is still missing. If a config has a shape init won't edit, init prints `figma-qa init: one file needs this edit by hand, then re-run init:` and the exact snippet on stderr, then exits 2.

## Exit codes

- **0**: every step is `ok`, `write` or `run`; `todo` lines are yours to finish and never fail init.
- **2**: Storybook older than 10.6 or not React + Vite, a config shape init won't edit (`edit` lines), or `figma-qa migrate` failed.

## Related

- [`figma-qa doctor`](./doctor.md) runs the same checklist on its own.
- [Upgrading](../upgrading.md): init is also the upgrade step.
- [Agent skills](../skills.md): what init installs for your agent.
