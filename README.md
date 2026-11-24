# storybook-figma-qa

Monorepo for `@phenomenon-studio/storybook-figma-qa`, the Figma QA kit: checks Storybook stories against the Figma UI kit.

| Path | Role |
| --- | --- |
| `packages/storybook-figma-qa` | The published package: Storybook addon (`./preset`, `./manager`, `./preview`), `./vitest` plugin, `./config` (`defineConfig` for an optional `figma-qa.config.ts`), `figma-qa` CLI, agent `skills/`. |
| `packages/storybook-figma-qa/{.storybook,stories}` | The kit's own Storybook (SB 10, dev only): the "Figma diff" panel and HTML report fed fixed results, tested with play functions and axe by the `ui` Vitest project. |
| `fixtures/sb10` | React + Vite project on Storybook 10.6, wired to the kit by hand. |
| `fixtures/sb11` | Same on Storybook 11 beta. |
| `fixtures/*/figma-qa/__refs__` | Committed Figma refs for the fixtures' synthetic `Swatch` and `Glyph` sets, plus `variables.json`. Fixtures have no `figma-qa.config.ts`: the config tests write one per run. |
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
4. **Project**: `"figma-report": "figma-qa report"` script, a `<!-- figma-qa:start -->` rules block in `AGENTS.md` (and `CLAUDE.md` when it doesn't import `@AGENTS.md`; only text between the markers is rewritten), and the kit's skills via the pinned `skills` CLI into `.agents/skills` and `.claude/skills` (skipped when the copies match the installed kit).

It never touches stories, components, tokens, the manager theme, other Vitest projects, git or CI files. `test/init-cli.test.ts` runs it on copies of both fixtures with the kit stripped.

## `figma-qa report`

The one local command, aliased in a project's `package.json` as `"figma-report": "figma-qa report"` (`pnpm figma-report`). It never prompts and exits 0 (pass, approved or no code equivalent), 1 (a cell differs from Figma) or 2 (harness or setup error).

1. **doctor**: the config loads; `.storybook/main` adds the kit and Vitest has the `figma-qa` project, else exit 2 pointing at `figma-qa init`.
2. **browser**: with Docker running, `docker compose up --wait` starts `mcr.microsoft.com/playwright:v<project's playwright>-noble` (compose project `figma-qa`, Playwright server on `127.0.0.1:3100` behind a per-user secret path kept in `~/.cache/figma-qa/browser-token`, left running for the next run). Without Docker, or with `--host-browser`, the host's Chromium runs and the summary and report warn that pixels are not comparable to CI. Docker running but the image failing to start is exit 2.
3. **collect**: story files from Storybook's `stories` globs are scanned as text; only files with a `figma` tag literal, or `tags` the scan can't read, are handed to Vitest.
4. **tests**: Figma sync happens lazily per story.
5. **report**: `figma-qa/.results/run.json` and `figma-qa/.results/report/`. From a terminal (stdout a TTY, no `CI`) the report opens with `$BROWSER` or the platform's opener; `--no-open` or `BROWSER=none` opens nothing. With `storybook dev` running, the "Figma diff" panel URL is printed.

Positional filters intersect the scanned files: a filter with `*`, `?` or `--` is a story-id glob (`'swatch-figma--*'`, other stories in a collected file are skipped), anything else a component name, matched against the meta `component`, the title or one of its segments, or the file name (`Swatch`, `Swatch.figma`). No match is exit 2. `--json` prints the summary, with `files`, per-phase `timings` (ms) and `panelUrl`, and nothing else on stdout.

## Releasing

Bump `packages/storybook-figma-qa/package.json` `version`, merge, then publish a GitHub Release tagged `v<version>`. [`publish.yml`](.github/workflows/publish.yml) reruns CI on that commit and publishes to GitHub Packages with the workflow's `GITHUB_TOKEN` (no publish secret):

| Release | Version | npm dist-tag | `vN` tag |
| --- | --- | --- | --- |
| Release | `X.Y.Z` | `latest` | `vX` moved to the release commit |
| Pre-release | `X.Y.Z-next.N` | `next` | untouched |

Any other tag/version/pre-release combination fails before publishing.

[`nightly.yml`](.github/workflows/nightly.yml) runs `figma-qa report --refresh` in `fixtures/sb11` against live Figma with the `FIGMA_TOKEN` repo secret (skipped with a notice when unset). PR CI never sees a token.
