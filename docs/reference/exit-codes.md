---
title: Exit codes and warnings
description: What each exit code means, what never changes it, and where results and diagnostics go.
---

Every command writes results to stdout and progress or diagnostics to stderr.

| Code | Meaning | Commands |
| --- | --- | --- |
| `0` | OK. For `report`: every cell passes, is approved, or has no code equivalent. | all |
| `1` | Design failure: a cell differs from Figma, or couldn't be measured (`harness`). | `report` only |
| `2` | Harness or setup error, never a design verdict. The message names the fix. | all |

## What exits 2

- No kit wiring: `.storybook/main` lacks the kit or Vitest lacks the `figma-qa` project. Fix: [`figma-qa init`](../commands/init.md).
- A config that doesn't load, or a Figma story that is misconfigured (`ERROR <story>: …`).
- A set with no cached refs and no `FIGMA_TOKEN`, `--refresh` without `FIGMA_TOKEN`, or a token Figma rejects.
- Refs in another format than the kit's: [`figma-qa migrate`](../commands/migrate.md), or upgrade the kit.
- Docker running but the pinned image failing to start. `--host-browser` runs without it.
- A filter that matches no story, or a `--changed` base git can't resolve.

## Warnings never fail

`WARN` lines (and `warn` / `todo` / `info` in `doctor` and `init`) leave the exit code alone:

- **Host Chromium**: no Docker, or `--host-browser`. Pixels aren't comparable to CI.
- **Figma changed since the last sync**: the committed refs are older than the file. `--refresh` adopts the new version.
- **Unnamed variables**: colour rows matched by value, marked `guess`. See [Variables and tokens](../variables-and-tokens.md).
- **`No Figma stories affected.`**: a `--changed` run reached no Figma story. **`No Figma stories found.`**: the project has none yet.
