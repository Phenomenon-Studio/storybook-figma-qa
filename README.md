# storybook-figma-qa

Monorepo for `@phenomenon-studio/storybook-figma-qa`, the Figma QA kit: checks Storybook stories against the Figma UI kit.

| Path | Role |
| --- | --- |
| `packages/storybook-figma-qa` | The published package: Storybook addon (`./preset`, `./manager`, `./preview`), `./vitest` plugin, `./config` (`defineConfig` for an optional `figma-qa.config.ts`), `figma-qa` CLI, agent `skills/`. |
| `packages/storybook-figma-qa/{.storybook,stories}` | The kit's own Storybook (SB 10, dev only): the "Figma diff" panel and HTML report fed fixed results, tested with play functions and axe by the `ui` Vitest project. |
| `fixtures/sb10` | React + Vite project on Storybook 10.6, wired to the kit by hand. |
| `fixtures/sb11` | Same on Storybook 11 beta. |
| `fixtures/*/figma-qa/__refs__` | Committed Figma refs for the fixtures' synthetic `Swatch` and `Glyph` sets, plus `variables.json` naming the two colour variables Swatch binds (`Brand` maps to a kit token, `Tone/Neutral` doesn't). Fixtures have no `figma-qa.config.ts`: the config tests write one per run. |
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

## `figma-qa init`

`pnpm dlx @phenomenon-studio/storybook-figma-qa init [--yes] [--dry-run] [--next]` installs the kit into a React + Vite project. Each step detects before it acts, so a re-run on a set-up project changes nothing; `--dry-run` prints the plan and writes or runs nothing.

1. **Storybook**: none → `npx storybook@^10 init` for React + Vite (`--next`: `storybook@next`, the 11 beta). Before 10.6 → exit 2 pointing at `storybook upgrade`; no React + Vite (or another framework in `.storybook/main`) → exit 2 naming what it found.
2. **Packages**: project `.npmrc` gets only `@phenomenon-studio:registry=https://npm.pkg.github.com` (the token stays in the user's `~/.npmrc`), then the kit and, when missing, `storybook add @storybook/addon-vitest`.
3. **Config** (magicast, literal shapes only): the kit in `.storybook/main` `addons`, `figmaQa()` in CSF Next `definePreview({ addons })` (a classic preview is left to the preset), `figmaQa()` in Vitest `test.projects`. Any other shape prints the exact snippet and exits 2 after the other steps.
4. **Project**: `"figma-report": "figma-qa report"` script, a `<!-- figma-qa:start -->` rules block in `AGENTS.md` (and `CLAUDE.md` when it doesn't import `@AGENTS.md`; only text between the markers is rewritten), and the kit's skills (`figma-qa`: run the report and triage failing cells; `figma-qa-scaffold`: finish a scaffolded story; `figma-qa-variables`: name unnamed Figma variables) via the pinned `skills` CLI into `.agents/skills` and `.claude/skills` (skipped when the copies match the installed kit).

It never touches stories, components, tokens, the manager theme, other Vitest projects, git or CI files. `test/init-cli.test.ts` runs it on copies of both fixtures with the kit stripped.

## `figma-qa report`

The one local command, aliased in a project's `package.json` as `"figma-report": "figma-qa report"` (`pnpm figma-report`). It never prompts and exits 0 (pass, approved or no code equivalent), 1 (a cell differs from Figma) or 2 (harness or setup error).

1. **doctor**: the config loads; `.storybook/main` adds the kit and Vitest has the `figma-qa` project, else exit 2 pointing at `figma-qa init`.
2. **browser**: with Docker running, `docker compose up --wait` starts `mcr.microsoft.com/playwright:v<project's playwright>-noble` (compose project `figma-qa`, Playwright server on `127.0.0.1:3100` behind a per-user secret path kept in `~/.cache/figma-qa/browser-token`, left running for the next run). Without Docker, or with `--host-browser`, the host's Chromium runs and the summary and report warn that pixels are not comparable to CI. Docker running but the image failing to start is exit 2.
3. **collect**: story files from Storybook's `stories` globs are scanned as text; only files with a `figma` tag literal, or `tags` the scan can't read, are handed to Vitest.
4. **tests**: Figma sync happens lazily per story.
5. **report**: `figma-qa/.results/run.json` and `figma-qa/.results/report/`. From a terminal (stdout a TTY, no `CI`) the report opens with `$BROWSER` or the platform's opener; `--no-open` or `BROWSER=none` opens nothing. With `storybook dev` running, the "Figma diff" panel URL is printed.

Each `fail` cell is triaged where code can tell, in its results JSON (`triage`), the panel and the report: `harness` (the image couldn't be measured: capture blocked, sizes differ; not a design verdict), `token` (a colour is another kit token than the one Figma names or equals by value; any other differing row is a spec number), `value` (every differing row is a spec number: size, radius, spacing, type), otherwise none. Under each failing cell the summary prints, and `--json` lists in the story's `failing`, an entry to paste into that block's `approved` with a reason; nothing rewrites story files.

Positional filters intersect the scanned files: a filter with `*`, `?` or `--` is a story-id glob (`'swatch-figma--*'`, other stories in a collected file are skipped), anything else a component name, matched against the meta `component`, the title or one of its segments, or the file name (`Swatch`, `Swatch.figma`). No match is exit 2. `--json` prints the summary, with `files`, per-phase `timings` (ms) and `panelUrl`, and nothing else on stdout.

`--changed [base]` keeps only the Figma story files a change reaches, through Vitest's own `changed`: files changed in `git diff base...HEAD` plus staged, unstaged and untracked ones (no base: only those), then each story file's import graph. A change to `.storybook/`, the refs dir, `figma-qa.config.*`, `package.json` or the Vite / Vitest config reaches every Figma story. Filters go before the flag (a following non-option argument is the base) and intersect it. A base git can't resolve (a shallow clone without it) or no repository is exit 2. Nothing affected is exit 0 with the warning `No Figma stories affected.`

`--ci` is the PR workflow's mode: it opens nothing, and picks the browser as a local run does (the pinned image when Docker runs, as it does on GitHub's Ubuntu runners). Beside the HTML report it writes `figma-qa/.results/summary.md`, the sticky comment's body: the `<!-- figma-qa -->` marker, the verdict, a per-story table of pass / fail / approved / missing cells and triage counts, and harness and setup errors (and `harness` cells) labelled "not a design verdict"; a rejected token adds "rotate the `FIGMA_TOKEN` repository secret".

## `figma-qa scaffold`

`figma-qa scaffold <figma-url...> --story <path/Component.stories.tsx> [--dry-run]` turns UI-kit nodes into a starter Figma story. Each URL may be a page, section, frame or one component set; every `COMPONENT_SET` beneath it is collected, in URL order then document order. It needs a live `FIGMA_TOKEN` and makes one `/nodes` call per Figma file.

- **File**: only the kit-owned sibling `<Component>.figma.stories.tsx` is written; the story at `--story` is read, never edited. Its meta title plus `/Figma` is the title (no sibling: the path under `src/`), `tags: ['figma', '!autodocs']`, and `component` and the CSF Next `preview` come from the sibling's own imports (no sibling: `.storybook/preview` if it uses `definePreview`).
- **Entries**: one `parameters.design` entry, one `figmaMatrix.blocks` entry and one `renderCell` stub per set. The name is the set name's last `/` segment with the component's name stripped, in kebab-case (`Button/Button Icon` → `icon`); a clash gets `-2`, `-3` and a warning. The layout is written out: `columns` is `State`, else the axis with the most options; `sections` is `Size` when present and not the columns, else `null`.
- **Stubs**: each renderer returns `null` under a `TODO(figma-qa)` comment, so `figma-qa report` lists every cell as missing and exits 0 until the bodies are written.
- **Re-runs** append the sets the file doesn't link yet (matched by file key and node id) and change nothing else: renamed entries, their order and hand-written renderers stay. A linked set Figma no longer has is a warning; deleting it is the author's call. A file whose `design` entries, matrix story or top-level `renderCell` object aren't literals exits 2 with the lines to add by hand.
- **Cache**: the fetched sets go to the local raw cache, so the first report syncs them without another `/nodes` call.

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
Timings: doctor 0.0 s, browser 0.0 s, collect 0.7 s, tests 2.4 s, report 0.0 s
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
- **The totals line** ends with the exit code. `Timings` show where the time went, and `HTML report` is the path to open. `Figma diff panel: <url>` follows when `storybook dev` is running.

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
    "timings": { "doctor": 1, "browser": 0, "collect": 799, "tests": 2307, "report": 27 },
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
ok    setup: kit addon in .storybook/main, figma-qa Vitest project
ok    browser: Docker runs; report starts the pinned browser image
figma-qa doctor: done
```

Each line is one check:

- **`ok`**: the check passed.
- **`warn`**: the report still runs, but this is worth fixing. Exit stays 0.
- **`block`**: setup is broken, and `report` would exit 2 too. The line names the fix, usually `figma-qa init`. Doctor exits 2.

A config that fails to load prints `figma-qa doctor: <reason>` on stderr and exits 2.

### `figma-qa init`

```text
figma-qa init --dry-run: the plan; nothing is written or run
ok    storybook: 11.0.0-beta.3 with @storybook/react-vite
write .npmrc: @phenomenon-studio:registry=https://npm.pkg.github.com
ok    package: @phenomenon-studio/storybook-figma-qa
ok    .storybook/main.ts: kit in addons
ok    vitest.config.ts: figmaQa() in test.projects
write AGENTS.md: figma-qa rules block
run   npx -y skills@1.9.0 add ./node_modules/@phenomenon-studio/storybook-figma-qa/skills --copy -y -a claude-code codex
figma-qa init: dry run, nothing written
```

Each line is one step:

- **`ok`**: the step is already in place, and init leaves it alone.
- **`write`**: init creates or changes the file.
- **`edit`**: you make this change by hand. Init exits 2 after printing the snippet.
- **`run`**: init runs the command.
- **`plan`**: init would act, but can't yet (it waits on a step before it).

A re-run on a set-up project prints only `ok` lines. If a config has a shape init won't edit, init prints `figma-qa init: one file needs this edit by hand, then re-run init:` and the exact snippet on stderr, then exits 2.

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

## PR workflow

[`figma-qa.yml`](.github/workflows/figma-qa.yml) is a reusable workflow: on every pull request it runs `figma-qa report --ci --changed <base sha>` on the stories the PR reaches, keeps one sticky comment (the `--ci` summary plus links to the HTML report artifact and the job log) and uploads the report as the `figma-qa-report` artifact for 14 days. Exit 1 and 2 fail the job; it is not meant as a required check. A consumer repo adds:

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
- **Install** is `pnpm install --frozen-lockfile` or `npm ci`, by the lockfile at the repo root. The kit comes from GitHub Packages with the run's `GITHUB_TOKEN` (`packages: read`): the kit package's "Manage Actions access" must list the consumer repo, and this repo's Actions access must allow organization repositories.
- **Browser**: the CLI starts the pinned Playwright image with Docker, tagged from the project's `playwright`, as a local run does. A `services:` container can't: it takes neither a command (`run-server`) nor a tag computed from the installed version.
- **The PR's own code** runs with `FIGMA_TOKEN` and a token that can comment, as in any same-repo CI job.

## Figma variables

Figma colours bound to a variable are held to the CSS token `tokenName` maps its name to (config; default `--color-` + the kebab-cased path). A colour matching Figma by value but painted with another token fails as "right value, wrong token": the check overrides the token for the cell's element and its ancestors and sees whether the computed colour follows. Names come from `<refsDir>/variables.json`, since the REST variables endpoint is Enterprise-only.

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
