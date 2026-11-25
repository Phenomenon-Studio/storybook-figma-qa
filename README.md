# storybook-figma-qa

`@phenomenon-studio/storybook-figma-qa` checks Storybook stories against the Figma UI kit: every Figma variant becomes a cell, measured against Figma's spec and image, with a verdict you can trust in a terminal, an agent session and CI.

**Docs: [phenomenon-studio.github.io/storybook-figma-qa](https://phenomenon-studio.github.io/storybook-figma-qa/)**: purpose, philosophy, workflow, every command with a real response example.

## Install

The kit is on GitHub Packages, which needs a token even to install. It stays in your user `~/.npmrc`; the project's `.npmrc` gets only the scope line (init writes it):

```sh
gh auth refresh -s read:packages
echo "//npm.pkg.github.com/:_authToken=$(gh auth token)" >> ~/.npmrc
echo "@phenomenon-studio:registry=https://npm.pkg.github.com" >> .npmrc   # once, so dlx finds the package
pnpm dlx @phenomenon-studio/storybook-figma-qa init
```

Without `gh`: a [classic personal access token](https://github.com/settings/tokens) with `read:packages` in that `~/.npmrc` line instead of `$(gh auth token)`.

Then [Getting started](https://phenomenon-studio.github.io/storybook-figma-qa/getting-started/).

## Development

Monorepo for the kit.

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

## Docs site

`docs/*.md` is the site's content (it reads on GitHub too); `site/` is the Starlight app, with its own lockfile outside the workspace. [`docs.yml`](.github/workflows/docs.yml) builds it on every PR and deploys `main` to GitHub Pages.

```sh
(cd site && pnpm install && pnpm dev)      # http://localhost:4321/storybook-figma-qa/
node scripts/docs-screenshots.mjs          # after a change to src/ui/: rewrites docs/assets/*.png from fixtures/sb11
```

Command pages carry a response example from a real `fixtures/sb11` run, shortened, never invented; a change to what a command prints updates its `docs/commands/<command>.md` in the same commit. Screenshots come from the fixtures only, never from a client project.

## Releasing

Bump `packages/storybook-figma-qa/package.json` `version` in a PR (`main` takes changes only through a PR with green CI), merge, then publish a GitHub Release tagged `v<version>`. [`publish.yml`](.github/workflows/publish.yml) reruns CI on that commit and publishes to GitHub Packages with the workflow's `GITHUB_TOKEN`, then moves `vX` over SSH with the `TAG_DEPLOY_KEY` secret, the private half of a write deploy key. A ruleset lets only maintainers and deploy keys create, move or delete `v*` tags: `vX` is what every consumer's workflow runs with its `FIGMA_TOKEN`. Without the secret the package still publishes and the job fails, naming the tag to move by hand:

| Release | Version | npm dist-tag | `vN` tag |
| --- | --- | --- | --- |
| Release | `X.Y.Z` | `latest` | `vX` moved to the release commit |
| Pre-release | `X.Y.Z-next.N` | `next` | untouched |

Any other tag/version/pre-release combination fails before publishing.

[`nightly.yml`](.github/workflows/nightly.yml) runs `figma-qa report --refresh` in `fixtures/sb11` against live Figma with the `FIGMA_TOKEN` repo secret (skipped with a notice when unset), in the pinned Playwright image the CLI starts with Docker, and uploads the HTML report as the `figma-qa-report` artifact. PR CI never sees a token.
