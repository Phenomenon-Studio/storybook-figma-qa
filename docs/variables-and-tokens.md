---
title: Variables and tokens
description: How Figma colour variables are held to your CSS tokens, and how to name the ones Figma's API doesn't.
sidebar:
  order: 5
---

Figma colours bound to a variable are held to the CSS token `tokenName` maps its name to (config; default `--color-` + the kebab-cased path). A colour matching Figma by value but painted with another token fails as "right value, wrong token": the check overrides the token for the cell's element and its ancestors and sees whether the computed colour follows. The row's `actual.note` names the token the story paints with instead: the alias its code wrote (`= --color-primary` in the fixtures, an alias of `--color-blue-600`), not the primitive behind it. Names come from `<refsDir>/variables.json`, since the REST variables endpoint is Enterprise-only.

An id with no name, or a name with no kit token, is matched by value: the row's note says `guess`, and the run carries one warning counting the unnamed ids. Neither changes the exit code.

`figma-qa variables` prints a read-only Plugin API script for the unnamed ids only, one per Figma file, to run with the Figma MCP `use_figma`. `figma-qa variables -` (stdin) or `figma-qa variables <file>` merges the script's returned JSON into `variables.json`: names already committed never change, and a repeat merge writes nothing. Output that isn't the script's shape exits 2 and writes nothing.

## Naming unnamed variables

1. Run `figma-qa report`. A warning counts the unnamed ids; their spec rows read `guess`.
2. Ask your agent to name them (the [`figma-qa-variables` skill](./skills.md#figma-qa-variables)), or run [`figma-qa variables`](./commands/variables.md) yourself and paste its script into the Figma MCP `use_figma`.
3. Commit `figma-qa/__refs__/variables.json`.

## Your token names

By default `Surface/control` is expected as `--color-surface-control`. If your tokens are named differently, set [`tokens.prefix` or `tokenName`](./reference/config.md) in `figma-qa.config.ts`.
