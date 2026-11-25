---
title: figma-qa variables
description: Name the Figma variables the refs hold only by id, through a script run with the Figma MCP use_figma.
---

Figma's REST variables endpoint is Enterprise-only, so the refs know a colour's variable id but not always its name. Without a name, a colour is matched by value and flagged `guess`. Run this when a report warns about unnamed variables; the [`figma-qa-variables` skill](../skills.md#figma-qa-variables) drives it end to end. Why names matter: [Variables and tokens](../variables-and-tokens.md).

## Synopsis

```sh
figma-qa variables              # print the use_figma script for the unnamed ids
figma-qa variables result.json  # merge the script's output into variables.json
figma-qa variables -            # the same, from stdin
```

1. Run it with no argument and paste each printed block into `use_figma` (Figma MCP), in the Figma file the block names.
2. Feed the JSON the script returns back to `figma-qa variables <file>` or `-`.
3. Commit `figma-qa/__refs__/variables.json`.

The script is read-only. Names already committed never change, and a repeat merge writes nothing.

## Response example

With no argument, stdout is only runnable script: one block per Figma file, headed by `// Figma file <key>: N unnamed. Run with use_figma …`. Paste a whole block into `use_figma`. When nothing is unnamed, stdout is empty and stderr says `figma-qa variables: every bound variable is named in figma-qa/__refs__/variables.json.`

With `<file>` or `-`, it merges the script's JSON output and prints what changed: `figma-qa variables: named 2: VariableID:1:2, VariableID:1:3; every bound variable is named.` A second line lists ids `not found in the file the script ran in`. They stay unnamed: the script ran in another file, or the variable was deleted.

## Exit codes

- **0**: script printed, nothing unnamed, or merged.
- **2**: input that isn't the script's output shape (nothing is written), or refs in another format.

## Related

- [Variables and tokens](../variables-and-tokens.md).
- [`figma-qa-variables` skill](../skills.md#figma-qa-variables).
