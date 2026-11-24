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
(cd fixtures/sb11 && pnpm figma-report Swatch.figma)    # one report by hand; HTML in figma-qa/.results/report
pnpm --dir fixtures/sb11 build-storybook && pnpm smoke:panel fixtures/sb11/storybook-static
pnpm smoke:panel --dev fixtures/sb11                    # report, then `storybook dev`: panel shows the run's verdict
```

## Releasing

Bump `packages/storybook-figma-qa/package.json` `version`, merge, then publish a GitHub Release tagged `v<version>`. [`publish.yml`](.github/workflows/publish.yml) reruns CI on that commit and publishes to GitHub Packages with the workflow's `GITHUB_TOKEN` (no publish secret):

| Release | Version | npm dist-tag | `vN` tag |
| --- | --- | --- | --- |
| Release | `X.Y.Z` | `latest` | `vX` moved to the release commit |
| Pre-release | `X.Y.Z-next.N` | `next` | untouched |

Any other tag/version/pre-release combination fails before publishing.

[`nightly.yml`](.github/workflows/nightly.yml) runs `figma-qa report --refresh` in `fixtures/sb11` against live Figma with the `FIGMA_TOKEN` repo secret (skipped with a notice when unset). PR CI never sees a token.
