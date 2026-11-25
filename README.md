# storybook-figma-qa

Monorepo for `@phenomenon-studio/storybook-figma-qa`, the Figma QA kit: checks Storybook stories against the Figma UI kit.

| Path | Role |
| --- | --- |
| `packages/storybook-figma-qa` | The published package: Storybook addon (`./preset`, `./manager`, `./preview`), `./vitest` plugin, `./config` (`defineConfig` for an optional `figma-qa.config.ts`), `figma-qa` CLI, agent `skills/`. |
| `packages/storybook-figma-qa/{.storybook,stories}` | The kit's own Storybook (SB 10, dev only): the "Figma diff" panel and HTML report fed fixed results, tested with play functions and axe by the `ui` Vitest project. |
| `fixtures/sb10` | React + Vite project on Storybook 10.6, wired to the kit by hand. |
| `fixtures/sb11` | Same on Storybook 11 beta. |
| `fixtures/*/figma-qa/__refs__` | Committed Figma refs for the fixtures' synthetic `Swatch` and `Glyph` sets, plus `variables.json` naming the two colour variables Swatch binds (`Brand` maps to a kit token, `Tone/Neutral` doesn't) and the `format.json` refs format stamp. Fixtures have no `figma-qa.config.ts`: the config tests write one per run. |
| `packages/storybook-figma-qa/test/figma-api` | Recorded Figma REST responses for that set, served by the test stub (`FIGMA_API_URL`). `pnpm build && node scripts/fixture-refs.mjs` rewrites them and the refs synced from them. |

Fixtures get an injected copy of the kit (`injectWorkspacePackages`), so its peers resolve against each fixture's Storybook / Vitest like a real install.

```sh
pnpm install && pnpm build && pnpm install --offline   # second install links the figma-qa bin
pnpm typecheck
pnpm exec playwright install chromium                   # fixture reports run stories in Chromium
pnpm test                                               # figma-qa CLI in both fixtures + results UI stories
(cd fixtures/sb11 && pnpm figma-report Swatch.figma)    # one report by hand (pinned image if Docker runs); HTML in figma-qa/.results/report
pnpm --dir fixtures/sb11 build-storybook && pnpm smoke:panel fixtures/sb11/storybook-static
pnpm smoke:panel --dev fixtures/sb11                    # report, then `storybook dev`: panel shows the run's verdict
```

## Install

The kit is on GitHub Packages, which needs a token even to install. It stays in your user `~/.npmrc`; the project's `.npmrc` gets only the scope line (init writes it):

```sh
gh auth refresh -s read:packages
echo "//npm.pkg.github.com/:_authToken=$(gh auth token)" >> ~/.npmrc
echo "@phenomenon-studio:registry=https://npm.pkg.github.com" >> .npmrc   # once, so dlx finds the package
pnpm dlx @phenomenon-studio/storybook-figma-qa init
```

Without `gh`: a [classic personal access token](https://github.com/settings/tokens) with `read:packages` in that `~/.npmrc` line instead of `$(gh auth token)`.

## `figma-qa init`

`pnpm dlx @phenomenon-studio/storybook-figma-qa init [--yes] [--dry-run] [--next]` installs the kit into a React + Vite project. Each step detects before it acts, so a re-run on a set-up project changes nothing; `--dry-run` prints the plan and writes or runs nothing.

1. **Storybook**: none → `npx storybook@^10 init` for React + Vite (`--next`: `storybook@next`, the 11 beta). Before 10.6 → exit 2 pointing at `storybook upgrade`; no React + Vite (or another framework in `.storybook/main`) → exit 2 naming what it found.
2. **Packages**: project `.npmrc` gets only `@phenomenon-studio:registry=https://npm.pkg.github.com` (the token stays in the user's `~/.npmrc`), and `.gitignore` gets `/figma-qa/.results/` (each run's report and screenshots) unless git already ignores it, then the kit and, when missing, `storybook add @storybook/addon-vitest`.
3. **Config** (magicast, literal shapes only): the kit in `.storybook/main` `addons`, `figmaQa()` in CSF Next `definePreview({ addons })` (a classic preview is left to the preset), `figmaQa()` in Vitest `test.projects`. Any other shape prints the exact snippet and exits 2 after the other steps.
4. **Project**: `"figma-report": "figma-qa report"` script, a `<!-- figma-qa:start -->` rules block in `AGENTS.md` (and `CLAUDE.md` when it doesn't import `@AGENTS.md`; only text between the markers is rewritten), then the installed kit's `figma-qa migrate` (a no-op unless an upgrade changed the refs format; see [Upgrading](#upgrading)), then the kit's skills (`figma-qa`: run the report and triage failing cells; `figma-qa-scaffold`: finish a scaffolded story; `figma-qa-variables`: name unnamed Figma variables) via the pinned `skills` CLI into `.agents/skills` and `.claude/skills` (skipped when the copies match the installed kit). The CLI only adds, so first init removes what a newer kit dropped: a skill whose `skills-lock.json` entry points at the kit's `skills` but which the kit no longer ships (`skills remove <name> -y`), and files in a kit skill's copies that the kit no longer has. Skills from any other source are left alone.

5. **First-run wizard**: `doctor`'s human checks, in order: registry → Figma token → file access → Docker / image → variable names → Figma MCP. In a terminal it asks only for what it can act on:
   - `FIGMA_TOKEN`, when missing or rejected (input hidden; empty skips). Validated with `GET /v1/me`, then `/meta` on each Figma file (a token Figma rejects, or whose owner can't open a file, is asked for again) the Figma stories link (committed refs and URLs in Figma story files). It is written to `.env.local` only when `git check-ignore` says that file is ignored; otherwise init writes nothing and prints the line to add yourself. `FIGMA_TOKEN` in the environment wins over `.env.local`; every command reads both.
   - Pull the pinned browser image (`Y/n`), when Docker runs and the image isn't pulled. Without Docker: an info line, reports use host Chromium.
   - Registry auth and the Figma MCP are never asked: a fix line and an info line.

   `--yes` (`-y`) or no terminal (CI, agents): no prompt, no secret written, no pull; the checklist prints and init exits 0. `--dry-run` runs no check (`plan  first-run wizard: …`). A complete setup prints only `ok` and `info` lines and asks nothing. The checklist ends with the PR workflow caller.

It never touches stories, components, tokens, the manager theme, other Vitest projects, git history or CI files. `test/init-cli.test.ts` runs it on copies of both fixtures with the kit stripped.

## `figma-qa report`

The one local command, aliased in a project's `package.json` as `"figma-report": "figma-qa report"` (`pnpm figma-report`). It never prompts and exits 0 (pass, approved or no code equivalent), 1 (a cell differs from Figma) or 2 (harness or setup error).

1. **doctor**: the config loads; the committed refs are in the kit's refs format (else exit 2 naming `figma-qa migrate`, or a kit upgrade for refs from a newer kit); `.storybook/main` adds the kit and Vitest has the `figma-qa` project, else exit 2 pointing at `figma-qa init`.
2. **collect**: story files from Storybook's `stories` globs are scanned as text; only files with a `figma` tag literal, or `tags` the scan can't read, are handed to Vitest.
3. **browser**, only once collect found a story to run (a `--changed` PR that reaches none pulls nothing): with Docker running, `docker compose up --wait` starts `mcr.microsoft.com/playwright:v<project's playwright>-noble` (compose project `figma-qa`, Playwright server on `127.0.0.1:29317`, or `$FIGMA_QA_BROWSER_PORT`, behind a per-user secret path kept in `~/.cache/figma-qa/browser-token`, left running for the next run). Without Docker, or with `--host-browser`, the host's Chromium runs and the summary and report warn that pixels are not comparable to CI. Docker running but the image failing to start is exit 2.
4. **tests**: Figma sync happens lazily per story. Each cell is captured once and its pixel diff runs in Node while the next cell is captured; each ref is flattened onto the page backdrop once per (ref hash, backdrop), kept in memory and under `node_modules/.cache/figma-qa/flat-v1`, so an unchanged ref is never flattened again.
5. **report**: `figma-qa/.results/run.json` and `figma-qa/.results/report/`. From a terminal (stdout a TTY, no `CI`) the report opens with `$BROWSER` or the platform's opener; `--no-open` or `BROWSER=none` opens nothing. With `storybook dev` running, the "Figma diff" panel URL is printed.

Each `fail` cell is triaged where code can tell, in its results JSON (`triage`), the panel and the report: `harness` (the image couldn't be measured: capture blocked, sizes differ; not a design verdict), `token` (a colour is another kit token than the one Figma names or equals by value; any other differing row is a spec number), `value` (every differing row is a spec number: size, radius, spacing, type), otherwise none. Under each failing cell the summary prints, and `--json` lists in the story's `failing`, an entry to paste into that block's `approved` with a reason; nothing rewrites story files.

Positional filters intersect the scanned files: a filter with `*`, `?` or `--` is a story-id glob (`'swatch-figma--*'`, other stories in a collected file are skipped), anything else a component name, matched against the meta `component`, the title or one of its segments, or the file name (`Swatch`, `Swatch.figma`). No match is exit 2. `--json` prints the summary, with `files`, per-phase `timings` (ms), `cellMs` (checks per captured cell, ms) and `panelUrl`, and nothing else on stdout.

`--changed [base]` keeps only the Figma story files a change reaches, through Vitest's own `changed`: files changed in `git diff base...HEAD` plus staged, unstaged and untracked ones (no base: only those), then each story file's import graph. A change to `.storybook/`, the refs dir, `figma-qa.config.*`, `package.json` or the Vite / Vitest config reaches every Figma story. Filters go before the flag (a following non-option argument is the base) and intersect it. A base git can't resolve (a shallow clone without it) or no repository is exit 2. Nothing affected is exit 0 with the warning `No Figma stories affected.`

`--ci` is the PR workflow's mode: it opens nothing, and picks the browser as a local run does (the pinned image when Docker runs, as it does on GitHub's Ubuntu runners). Beside the HTML report it writes `figma-qa/.results/summary.md`, the sticky comment's body: the `<!-- figma-qa -->` marker, the verdict, a per-story table of pass / fail / approved / missing cells and triage counts, and harness and setup errors (and `harness` cells) labelled "not a design verdict"; a rejected token adds "rotate the `FIGMA_TOKEN` repository secret".

## `figma-qa scaffold`

`figma-qa scaffold <figma-url...> --story <path/Component.stories.tsx> [--dry-run]` turns UI-kit nodes into a starter Figma story. Each URL may be a page, section, frame or one component set; every `COMPONENT_SET` beneath it is collected, in URL order then document order. It needs a live `FIGMA_TOKEN` and makes one `/nodes` call per Figma file.

- **File**: only the kit-owned sibling `<Component>.figma.stories.tsx` is written; the story at `--story` is read, never edited. Its meta title plus `/Figma` is the title (no sibling: the path under `src/`), `tags: ['figma', '!autodocs']`, and `component` and the CSF Next `preview` come from the sibling's own imports (no sibling: `.storybook/preview` if it uses `definePreview`).
- **Entries**: one `parameters.design` entry, one `figmaMatrix.blocks` entry and one `renderCell` stub per set. The name is the set name's last `/` segment with the component's name stripped, in kebab-case (`Button/Button Icon` → `icon`); a clash gets `-2`, `-3` and a warning. The layout is written out: `columns` is `State`, else the axis with the most options; `sections` is `Size` when present and not the columns, else `null`.
- **Stubs**: each renderer returns `null` under a `TODO(figma-qa)` comment, so `figma-qa report` lists every cell as missing and exits 0 until the bodies are written.
- **Re-runs** append the sets the file doesn't link yet (matched by file key and node id) and change nothing else: renamed entries, their order and hand-written renderers stay. A linked set Figma no longer has is a warning; deleting it is the author's call. A file whose `design` entries, matrix story or top-level `renderCell` object aren't literals exits 2 with the lines to add by hand.
- **Cache**: the fetched sets go to the local raw cache, so the first report syncs them without another `/nodes` call.

## Upgrading

The kit follows semver. A change to the `figma-qa.config.ts` format or to the committed refs format (`refsDir`: manifests, PNGs, `variables.json`) is a **major** release, and ships a `figma-qa migrate` step that carries a project's committed files to the new format.

`<refsDir>/format.json` records the refs format, `{ "format": 1 }`; a sync writes it with the first refs, and refs committed before it existed are format 1. `figma-qa migrate [--dry-run]` runs, in order, every step after the recorded format and moves the stamp after each one, so a failed step re-runs from where it stopped. Up to date, it changes nothing. Commit what it writes.

To upgrade: bump the kit (`pnpm add -D @phenomenon-studio/storybook-figma-qa@<version>`), then run `pnpm exec figma-qa init`. Init runs the installed kit's `migrate` (not that of a `dlx` kit), then re-installs the agent skills whose files changed. `report` exits 2 on refs in another format than the kit's: older ones need `figma-qa migrate`, newer ones a kit upgrade.

## Reading the output

Every command writes results to stdout and progress or diagnostics to stderr. It exits 0 (ok), 1 (design failure, `report` only) or 2 (harness or setup error). The examples below are real runs in `fixtures/sb11`, shortened where a line repeats. Each new command or flag adds its example here (AGENTS.md).

### `figma-qa report`

Vitest's own progress comes first: `✓` / `×` per story file and story. A `×` there only means the story's checks failed, and the summary below says why. The summary is one block per story, then run-level lines:

```text
ERROR src/Misconfigured.figma.stories.tsx › No Matrix: error: Story is tagged `figma` but has no `parameters.figmaMatrix.blocks`.
PASS  Swatch › Matrix: 2 pass, 0 fail, 2 approved, 2 missing
FAIL  Swatch › Matrix: 0 pass, 4 fail, 0 approved, 2 missing
      ✗ swatch · Size=Small, Tone=Brand [token]
        approved: { when: { Size: ['Small'], Tone: ['Brand'] }, reason: 'TODO: why this deviation is deliberate (WCAG criterion or decision)' },
      ✗ swatch · Size=Small, Tone=Neutral
        approved: { when: { Size: ['Small'], Tone: ['Neutral'] }, reason: '…' },
FAIL  Swatch › Blocked: 0 pass, 4 fail, 0 approved, 2 missing
      ✗ swatch · Size=Small, Tone=Brand [harness]
        not measured: fix the capture, no approval can cover it
WARN  Host Chromium (--host-browser): pixels are not comparable to CI.

figma-qa report: 2 pass, 8 fail, 2 approved, 6 missing (exit 2)
Timings: doctor 0.0 s, collect 1.1 s, browser 0.0 s, tests 2.2 s, report 0.0 s, per cell 78 ms
HTML report: figma-qa/.results/report/index.html
```

- **`PASS` / `FAIL` / `ERROR` `<title> › <story>`** is the story's verdict.
  - `ERROR` means the story measured nothing (misconfigured, uncached set, failed to render). It is exit 2, not a design verdict.
  - The counts are matrix cells, one per Figma variant. `approved` cells differ, but an `approved` entry in the story covers them. `missing` cells are variants Figma draws that the code doesn't have (`renderCell` returned null). Neither fails the run.
- **`✗ <block> · <variant> [<triage>]`** is a failing cell.
  - `[token]`: another kit token than Figma's.
  - `[value]`: a spec number is off.
  - `[harness]`: the capture couldn't be measured.
  - No tag: code can't tell, so this is where judgment goes. Open the HTML report for that cell's expected / actual rows and the pixel diff.
- **`approved: { … },`** is only for a deviation a human confirms is deliberate. Paste it into that block's `approved` and replace the `TODO` reason. A fix needs no entry. Harness cells print `not measured` instead, because no approval can cover them.
- **`ERROR <message>`** without a story is a run-level harness or setup error. It is exit 2, and the message names the fix (often `figma-qa init` or `--host-browser`).
- **`WARN`** lines never change the exit code. They cover host Chromium, Figma changed since the last sync, unnamed variables and `No Figma stories affected.`
- **The totals line** ends with the exit code. `Timings` show where the time went; `per cell` is the checks' time per captured cell (missing cells aren't captured), meant to stay ≤ 150 ms warm, reported and never gated. `HTML report` is the path to open. `Figma diff panel: <url>` follows when `storybook dev` is running.

`--json` prints only the summary on stdout; Vitest's output goes to stderr. The same object is written to `figma-qa/.results/run.json`:

```json
{
    "exitCode": 1,
    "hostBrowser": true,
    "cells": { "pass": 0, "fail": 8, "approved": 0, "missing": 4 },
    "files": ["src/SwatchTriage.figma.stories.tsx"],
    "stories": [
        {
            "storyId": "swatch-figma-triage--matrix",
            "title": "Swatch",
            "name": "Matrix",
            "file": "src/SwatchTriage.figma.stories.tsx",
            "verdict": "fail",
            "cells": { "pass": 0, "fail": 4, "approved": 0, "missing": 2 },
            "error": null,
            "results": "figma-qa/.results/results/swatch-figma-triage--matrix.json",
            "failing": [
                {
                    "block": "swatch",
                    "variant": "Size=Small, Tone=Brand",
                    "triage": "token",
                    "approved": "{ when: { Size: ['Small'], Tone: ['Brand'] }, reason: 'TODO: …' }"
                }
            ]
        }
    ],
    "errors": [],
    "warnings": ["Host Chromium (--host-browser): pixels are not comparable to CI."],
    "timings": { "doctor": 1, "collect": 1302, "browser": 0, "tests": 2822, "report": 30 },
    "cellMs": 89,
    "panelUrl": null
}
```

- **The verdict fields** are `exitCode`, `stories[].verdict` and `stories[].error`. `errors` holds failures outside any story.
- **`stories[].results`** points at the per-story results JSON. It has every cell's spec rows (`spec.mismatches`: element, property, `expected` (Figma), `actual` (story), `delta`, `tolerance`) and its pixel diff (`image`). Read that file to see what differs.
- **`failing[].approved`** is `null` for `harness` cells.

`--ci` also writes `figma-qa/.results/summary.md`, the PR comment body:

```markdown
<!-- figma-qa -->
## Figma QA: fail

0 pass · 8 fail · 0 approved · 4 missing

| Story | Verdict | Pass | Fail | Approved | Missing | Triage |
| --- | --- | --- | --- | --- | --- | --- |
| Swatch › Matrix | fail | 0 | 4 | 0 | 2 | token 1 · value 1 · uncategorised 2 |
| Swatch › Blocked | fail | 0 | 4 | 0 | 2 | harness 4 (not a design verdict) |

<details><summary>Failing cells</summary>

- Swatch › Matrix: swatch · Size=Small, Tone=Brand (token)
- …

</details>

### Warnings

- Host Chromium (--host-browser): pixels are not comparable to CI.
```

- **The headline** reads `pass`, `fail`, `harness or setup error (not a design verdict)` (exit 2), or `cells not measured (not a design verdict)` (exit 1 from `harness` cells only).
- **`### Errors (not a design verdict)`** lists story and run errors.
- **`No Figma stories affected.`** replaces the table on a `--changed` run that reached no Figma story.

### `figma-qa doctor`

```text
ok    config: no figma-qa.config.ts, defaults apply
warn  icons: none match src/icons/*.svg; Figma cells render without glyphs (set icons.glob)
ok    refs: figma-qa/__refs__ in refs format 1
ok    setup: kit addon in .storybook/main, figma-qa Vitest project
todo  registry: .npmrc lacks @phenomenon-studio:registry=https://npm.pkg.github.com
      fix: run `figma-qa init`: it writes only that line
todo  figma token: FIGMA_TOKEN not set; reports run offline from committed refs, new sets and --refresh need it
      fix: create a personal access token (scope: File content, read-only) in Figma → Settings → Security
      fix: run `figma-qa init` in a terminal to paste it, or put FIGMA_TOKEN=<token> in .env.local (gitignored)
      fix: the token's owner needs a Dev or Full seat on the plan that owns the UI kit file (View/Collab seats get 429s)
info  file access: not checked: needs a working FIGMA_TOKEN (FIXTUREKIT)
ok    browser: Docker runs; pinned image mcr.microsoft.com/playwright:v1.65.1-noble pulled
ok    variables: every bound variable is named in figma-qa/__refs__/variables.json
info  figma mcp: agents name variables and read annotations through the Figma MCP server's use_figma; add it to your agent
figma-qa doctor: done
```

Each line is one check: the kit wiring (`config`, `icons`, `refs`, `setup`), then the human items init's wizard covers, in its order. A `fix:` line under a check is the human fix.

- **`ok`**: the check passed.
- **`todo`**: missing, and yours to add; the report still runs (offline without a token, the image pulled on first run). Exit stays 0.
- **`warn`**: the report still runs, but this is worth fixing, or a check couldn't reach Figma (`not verified: …`, a 429 names its `X-Figma-Rate-Limit-Type`). Exit stays 0.
- **`info`**: no action needed: no Figma story yet, no Docker (host Chromium), unnamed variables matched by value, the Figma MCP.
- **`block`**: setup is broken, and `report` would exit 2 too: refs in another format than the kit's (`block refs: figma-qa/__refs__ is refs format 2; this kit reads format 1: upgrade the kit.`, or `run \`figma-qa migrate\`` for older refs), kit wiring (fix: `figma-qa init`), a token Figma rejects (`401`/`403`), or a file its owner can't open. Doctor exits 2.

`file access` prints one line per Figma file: `ok    file access: FIXTUREKIT "Fixture UI kit", version 1`. A config that fails to load prints `figma-qa doctor: <reason>` on stderr and exits 2.

### `figma-qa init`

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
- **`figma-qa init: checklist`**: doctor's human checks after the prompts, read as in [`figma-qa doctor`](#figma-qa-doctor), then the PR workflow line. Under `--yes` or without a terminal only this part prints. A `FIGMA_TOKEN` from the environment that Figma rejects is never asked for (a token saved to `.env.local` would not be read): `block figma token: Figma rejected FIGMA_TOKEN from env`, with the fix.

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

### `figma-qa scaffold`

```text
figma-qa scaffold: wrote src/Button.figma.stories.tsx (2 sets added)
+ swatch  Swatch (10:0)  columns Tone, sections Size
+ glyph   Glyph (20:0)  columns Icon, no sections
next: rename each entry to the code's variant and write its renderCell; until then `figma-qa report Button` reports its cells missing
```

- **`wrote <file> (N sets added)`**: the Figma story was created or appended to.
- **`+ <entry>  <set> (<node id>)  columns …, sections …`**: one line per added set: the design entry name it got, Figma's set name and node id, and the layout written for its block.
- **`warn  <entry>: …`**: a name clash renamed the entry (`would also be named swatch; renamed swatch-2`), a linked set is `no longer a component set in Figma`, or a URL `holds no component set`. Warnings never change the exit code.
- **`already links every set; nothing to add`**: a re-run found nothing new and wrote nothing.

With `--dry-run` it prints a unified diff of the Figma story instead of writing it (`--- /dev/null` for a new file), then the same lines under `dry run, <file> not written (N sets to add)`:

```text
--- a/src/Button.figma.stories.tsx
+++ b/src/Button.figma.stories.tsx
@@ -12,6 +12,7 @@
     parameters: {
         design: [
             { name: 'swatch', type: 'figma', url: 'https://www.figma.com/design/FIXTUREKIT/Fixture-UI-kit?node-id=10-0' },
+            { name: 'glyph', type: 'figma', url: 'https://www.figma.com/design/FIXTUREKIT/Fixture-UI-kit?node-id=20-0' },
         ],
     },
 });
@@ -22,6 +23,10 @@
…
figma-qa scaffold: dry run, src/Button.figma.stories.tsx not written (1 set to add)
+ glyph  Glyph (20:0)  columns Icon, no sections
```

Without a token it prints ``figma-qa scaffold: needs FIGMA_TOKEN, as it reads the UI kit live from Figma. Run `figma-qa init` to set it up, or export FIGMA_TOKEN.`` on stderr and exits 2. A file it can't edit prints `figma-qa scaffold: cannot edit <file>: <reason>. Add each set by hand:` on stderr, the lines to add on stdout, and exits 2.

### `figma-qa variables`

With no argument, stdout is only runnable script: one block per Figma file, headed by `// Figma file <key>: N unnamed. Run with use_figma …`. Paste a whole block into `use_figma`. When nothing is unnamed, stdout is empty and stderr says `figma-qa variables: every bound variable is named in figma-qa/__refs__/variables.json.`

With `<file>` or `-`, it merges the script's JSON output and prints what changed: `figma-qa variables: named 2: VariableID:1:2, VariableID:1:3; every bound variable is named.` A second line lists ids `not found in the file the script ran in`. They stay unnamed: the script ran in another file, or the variable was deleted.

### `figma-qa migrate`

Refs already in the kit's format:

```text
ok    figma-qa/__refs__: refs format 1, up to date
figma-qa migrate: done
```

Refs committed before the format stamp existed (`format.json` removed):

```text
write figma-qa/__refs__/format.json: refs format 1
figma-qa migrate: done
```

The same with `--dry-run`: the plan, nothing written:

```text
write figma-qa/__refs__/format.json: refs format 1
figma-qa migrate: dry run, nothing written
```

- **`ok`**: the refs are in this kit's format, or there are none (`figma-qa/__refs__: no committed refs, nothing to migrate`); nothing is written.
- **`write`**: the stamp is written. A step run adds a line per step before it, `run   refs format 1 → 2: <what the step changes>`; the stamp moves after each step.
- **`figma-qa migrate: done`**: the closing line. Init prints the step lines but not this one. Before the kit is installed, `init --dry-run` prints `plan  figma-qa migrate, after installing the kit`; an installed kit from before `migrate` existed prints `ok    migrate: the installed kit predates figma-qa migrate`.
- **Exit 2**, on stderr: refs from a newer kit (`figma-qa migrate: figma-qa/__refs__ is refs format 2; this kit reads format 1: upgrade the kit.`), a stamp that isn't `{ "format": <positive integer> }`, a step that failed (`refs format 1 → 2 failed: <reason>`; the stamp stays at the last finished step, so a re-run resumes there), or a config the kit can't load. `report` names the same refs format error in its summary `errors`, `variables` on stderr (exit 2), and `doctor` as a `block refs:` line; init stops at `figma-qa init: figma-qa migrate failed (exit 2): fix what it names, then re-run init.`

## PR workflow

[`figma-qa.yml`](.github/workflows/figma-qa.yml) is a reusable workflow: on every pull request it runs `figma-qa report --ci --changed <base sha>` on the stories the PR reaches, keeps one sticky comment (the `--ci` summary plus links to the HTML report artifact and the job log) and uploads the report as the `figma-qa-report` artifact for 14 days. Exit 1 and 2 fail the job; it is not meant as a required check. `figma-qa init` prints the caller job for the project (`todo  PR workflow`); a consumer repo adds:

```yaml
# .github/workflows/figma-qa.yml
name: Figma QA
on: pull_request
permissions:
    contents: read
    packages: read
    pull-requests: write
jobs:
    figma-qa:
        uses: Phenomenon-Studio/storybook-figma-qa/.github/workflows/figma-qa.yml@v1
        secrets:
            FIGMA_TOKEN: ${{ secrets.FIGMA_TOKEN }}
        # with:
        #     paths: src .storybook figma-qa   # skip PRs that change none of these
        #     working-directory: apps/web      # the project with the kit, in a monorepo
        #     setup: pnpm codegen              # run at the repo root after install
```

- **`FIGMA_TOKEN`** is a per-repo secret, passed explicitly. Unset (or a fork PR, which gets no secrets) skips the check with a notice. A token Figma rejects turns the comment into "rotate the `FIGMA_TOKEN` repository secret".
- **Install** is `pnpm install --frozen-lockfile` or `npm ci`, by the lockfile at the repo root: pnpm and npm only, any other lockfile fails the job. The kit comes from GitHub Packages with the run's `GITHUB_TOKEN` (`packages: read`): the kit package's "Manage Actions access" must list the consumer repo, and this repo's Actions access must allow organization repositories.
- **Skips** (no token, or `paths` unchanged) turn an existing sticky comment into `## Figma QA: skipped` with the reason, so an older result never reads as current. With no comment yet, a skip posts nothing.
- **Node** comes from the project's `.nvmrc` / `.node-version`, else the repo root's, else current LTS.
- **Browser**: the CLI starts the pinned Playwright image with Docker, tagged from the project's `playwright`, as a local run does, and only once collect found a story to run: a PR that reaches no Figma story pulls nothing. A `services:` container can't run it: it takes neither a command (`run-server`) nor a tag computed from the installed version.
- **The PR's own code** runs with `FIGMA_TOKEN` and `packages: read` only. A separate job holding `pull-requests: write` posts the comment from the report job's outputs.

## Figma variables

Figma colours bound to a variable are held to the CSS token `tokenName` maps its name to (config; default `--color-` + the kebab-cased path). A colour matching Figma by value but painted with another token fails as "right value, wrong token": the check overrides the token for the cell's element and its ancestors and sees whether the computed colour follows. The row's `actual.note` names the token the story paints with instead: the alias its code wrote (`= --color-primary` in the fixtures, an alias of `--color-blue-600`), not the primitive behind it. Names come from `<refsDir>/variables.json`, since the REST variables endpoint is Enterprise-only.

An id with no name, or a name with no kit token, is matched by value: the row's note says `guess`, and the run carries one warning counting the unnamed ids. Neither changes the exit code.

`figma-qa variables` prints a read-only Plugin API script for the unnamed ids only, one per Figma file, to run with the Figma MCP `use_figma`. `figma-qa variables -` (stdin) or `figma-qa variables <file>` merges the script's returned JSON into `variables.json`: names already committed never change, and a repeat merge writes nothing. Output that isn't the script's shape exits 2 and writes nothing.

## Releasing

Bump `packages/storybook-figma-qa/package.json` `version`, merge, then publish a GitHub Release tagged `v<version>`. [`publish.yml`](.github/workflows/publish.yml) reruns CI on that commit and publishes to GitHub Packages with the workflow's `GITHUB_TOKEN` (no publish secret):

| Release | Version | npm dist-tag | `vN` tag |
| --- | --- | --- | --- |
| Release | `X.Y.Z` | `latest` | `vX` moved to the release commit |
| Pre-release | `X.Y.Z-next.N` | `next` | untouched |

Any other tag/version/pre-release combination fails before publishing.

[`nightly.yml`](.github/workflows/nightly.yml) runs `figma-qa report --refresh` in `fixtures/sb11` against live Figma with the `FIGMA_TOKEN` repo secret (skipped with a notice when unset), in the pinned Playwright image the CLI starts with Docker, and uploads the HTML report as the `figma-qa-report` artifact. PR CI never sees a token.
