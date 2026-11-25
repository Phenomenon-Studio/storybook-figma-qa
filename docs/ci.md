---
title: CI / PR workflow
description: A reusable GitHub Actions workflow that checks the Figma stories a PR reaches and keeps one sticky comment for developers and designers.
sidebar:
  order: 6
---

[`figma-qa.yml`](https://github.com/Phenomenon-Studio/storybook-figma-qa/blob/main/.github/workflows/figma-qa.yml) is a reusable workflow: on every pull request it runs `figma-qa report --ci --changed <base sha>` on the stories the PR reaches, keeps one sticky comment (the `--ci` summary plus links to the HTML report artifact and the job log) and uploads the report as the `figma-qa-report` artifact for 14 days. Exit 1 and 2 fail the job; it is not meant as a required check. `figma-qa init` prints the caller job for the project (`todo  PR workflow`); a consumer repo adds:

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
        uses: Phenomenon-Studio/storybook-figma-qa/.github/workflows/figma-qa.yml@v0
        secrets:
            FIGMA_TOKEN: ${{ secrets.FIGMA_TOKEN }}
        # with:
        #     paths: src .storybook figma-qa   # skip PRs that change none of these
        #     working-directory: apps/web      # the project with the kit, in a monorepo
        #     setup: pnpm codegen              # run at the repo root after install
```

- **`FIGMA_TOKEN`** is a per-repo secret, passed explicitly. Unset (or a fork PR, which gets no secrets) skips the check with a notice. A token Figma rejects turns the comment into "rotate the `FIGMA_TOKEN` repository secret".
- **Install** is `pnpm install --frozen-lockfile` or `npm ci`, by the lockfile at the repo root: pnpm and npm only, any other lockfile fails the job. The kit comes from GitHub Packages with the run's `GITHUB_TOKEN` (`packages: read`). Repo and package are public, so any repo, in the org or not, can call the workflow and read the package: no Actions-access lists to edit.
- **Skips** (no token, or `paths` unchanged) turn an existing sticky comment into `## Figma QA: skipped` with the reason, so an older result never reads as current. With no comment yet, a skip posts nothing.
- **Node** comes from the project's `.nvmrc` / `.node-version`, else the repo root's, else current LTS.
- **Browser**: the CLI starts the pinned Playwright image with Docker, tagged from the project's `playwright`, as a local run does, and only once collect found a story to run: a PR that reaches no Figma story pulls nothing. A `services:` container can't run it: it takes neither a command (`run-server`) nor a tag computed from the installed version.
- **The PR's own code** runs with `FIGMA_TOKEN` and `packages: read` only. A separate job holding `pull-requests: write` posts the comment from the report job's outputs.

## The PR comment

The job runs `figma-qa report --ci`, which writes `figma-qa/.results/summary.md`; the workflow posts it as one sticky comment (updated on each push) with links to the HTML report artifact and the job log. A failing run in `fixtures/sb11`, rendered (headings shown smaller here):

> #### Figma QA: fail
>
> 0 pass · 8 fail · 0 approved · 4 missing
>
> | Story | Verdict | Pass | Fail | Approved | Missing | Triage |
> | --- | --- | --- | --- | --- | --- | --- |
> | Swatch › Matrix | fail | 0 | 4 | 0 | 2 | token 1 · value 1 · uncategorised 2 |
> | Swatch › Blocked | fail | 0 | 4 | 0 | 2 | harness 4 (not a design verdict) |
>
> <details><summary>Failing cells</summary>
>
> - Swatch › Matrix: swatch · Size=Small, Tone=Brand (token)
> - …
>
> </details>
>
> #### Warnings
>
> - Host Chromium (--host-browser): pixels are not comparable to CI.

The file itself:

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

## For designers

Each run uploads the HTML report as the `figma-qa-report` artifact, kept 14 days. Download it from the comment's link, unzip, and open `index.html`: every failing cell with Figma's image, the story's image and the diff map. See [Results UI](./reference/results-ui.md).
