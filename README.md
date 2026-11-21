# storybook-figma-qa

Monorepo for `@phenomenon-studio/storybook-figma-qa`, the Figma QA kit: checks Storybook stories against the Figma UI kit.

| Path | Role |
| --- | --- |
| `packages/storybook-figma-qa` | The published package: Storybook addon (`./preset`, `./manager`, `./preview`), `./vitest` plugin, `figma-qa` CLI, agent `skills/`. |
| `fixtures/sb10` | React + Vite project on Storybook 10.6, wired to the kit by hand. |
| `fixtures/sb11` | Same on Storybook 11 beta. |

Fixtures get an injected copy of the kit (`injectWorkspacePackages`), so its peers resolve against each fixture's Storybook / Vitest like a real install.

```sh
pnpm install && pnpm build && pnpm install --offline   # second install links the figma-qa bin
pnpm typecheck
pnpm test                                               # figma-qa CLI in both fixtures
pnpm --dir fixtures/sb11 build-storybook && pnpm smoke:panel fixtures/sb11/storybook-static
```

## Releasing

Bump `packages/storybook-figma-qa/package.json` `version`, merge, then publish a GitHub Release tagged `v<version>`. [`publish.yml`](.github/workflows/publish.yml) reruns CI on that commit and publishes to GitHub Packages with the workflow's `GITHUB_TOKEN` (no publish secret):

| Release | Version | npm dist-tag | `vN` tag |
| --- | --- | --- | --- |
| Release | `X.Y.Z` | `latest` | `vX` moved to the release commit |
| Pre-release | `X.Y.Z-next.N` | `next` | untouched |

Any other tag/version/pre-release combination fails before publishing.

[`nightly.yml`](.github/workflows/nightly.yml) runs `figma-qa report --refresh` in `fixtures/sb11` against live Figma with the `FIGMA_TOKEN` repo secret (skipped with a notice when unset). PR CI never sees a token.
