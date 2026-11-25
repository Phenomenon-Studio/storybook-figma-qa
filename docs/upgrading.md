---
title: Upgrading
description: Bump the kit, re-run init, and let migrate carry committed refs to the new format.
sidebar:
  order: 7
---

The kit follows semver. A change to the `figma-qa.config.ts` format or to the committed refs format (`refsDir`: manifests, PNGs, `variables.json`) is a **major** release, and ships a `figma-qa migrate` step that carries a project's committed files to the new format.

`<refsDir>/format.json` records the refs format, `{ "format": 1 }`; a sync writes it with the first refs, and refs committed before it existed are format 1. `figma-qa migrate [--dry-run]` runs, in order, every step after the recorded format and moves the stamp after each one, so a failed step re-runs from where it stopped. Up to date, it changes nothing. Commit what it writes.

To upgrade: bump the kit (`pnpm add -D @phenomenon-studio/storybook-figma-qa@<version>`), then run `pnpm exec figma-qa init`. Init runs the installed kit's `migrate` (not that of a `dlx` kit), then re-installs the agent skills whose files changed. `report` exits 2 on refs in another format than the kit's: older ones need `figma-qa migrate`, newer ones a kit upgrade.

```sh
pnpm add -D @phenomenon-studio/storybook-figma-qa@<version>
pnpm exec figma-qa init
```

The PR workflow is pinned to the kit's major (`@v0` while the kit is 0.x), so after a major upgrade bump that tag in `.github/workflows/figma-qa.yml` too. See [`figma-qa migrate`](./commands/migrate.md) for its output.
