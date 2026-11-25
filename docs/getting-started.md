---
title: Getting started
description: Install the kit in a React + Vite Storybook project and run your first Figma report.
sidebar:
  order: 1
---

You need a React + Vite project (Storybook 10.6+ or the 11 beta; `init` installs Storybook when there is none), Node 22.12+, and pnpm or npm. Docker is optional but recommended: with it, reports run in the same pinned browser as CI.

## 1. Install

The kit is on GitHub Packages, which needs a token even to install. It stays in your user `~/.npmrc`; the project's `.npmrc` gets only the scope line (init writes it):

```sh
gh auth refresh -s read:packages
echo "//npm.pkg.github.com/:_authToken=$(gh auth token)" >> ~/.npmrc
echo "@phenomenon-studio:registry=https://npm.pkg.github.com" >> .npmrc   # once, so dlx finds the package
pnpm dlx @phenomenon-studio/storybook-figma-qa init
```

Without `gh`: a [classic personal access token](https://github.com/settings/tokens) with `read:packages` in that `~/.npmrc` line instead of `$(gh auth token)`.

[`init`](./commands/init.md) adds the kit, wires Storybook and Vitest, installs the agent skills, and ends with a checklist of what only you can do. In a terminal it asks for two of those:

- **`FIGMA_TOKEN`**: a Figma personal access token (scope: File content, read-only), saved to `.env.local` only if git ignores it. Without it, reports still run offline from committed refs.
- **The pinned browser image**: pulled when Docker runs.

Run [`figma-qa doctor`](./commands/doctor.md) any time to see what is still missing.

## 2. Link a component to Figma

Copy the Figma URL of the component's UI-kit page or component set, and scaffold its Figma story next to the existing one:

```sh
pnpm exec figma-qa scaffold 'https://www.figma.com/design/<file>/<name>?node-id=10-0' --story src/Button.stories.tsx
```

It writes `src/Button.figma.stories.tsx` with one stub per component set. Ask your agent to finish it (the [`figma-qa-scaffold` skill](./skills.md#figma-qa-scaffold)), or write each `renderCell` yourself: [Figma stories](./figma-stories.md).

## 3. Run the report

```sh
pnpm figma-report Button
```

The first run syncs the linked sets from Figma into `figma-qa/__refs__/`; commit that folder, so later runs (and teammates without a token) work offline. The terminal prints one block per story; the HTML report opens in your browser. [Reading the output](./commands/report.md#response-example).

## 4. Fix or approve

For each failing cell, either fix the code, or, when the deviation is deliberate, paste the printed `approved` entry into the story with a reason. Your agent can do this triage with the [`figma-qa` skill](./skills.md#figma-qa).

## 5. Add the PR check

`init` printed a `todo  PR workflow` line with the job to add. See [CI / PR workflow](./ci.md).
