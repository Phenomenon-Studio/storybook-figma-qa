---
title: Agent skills
description: The three skills init installs for your agent, when each one triggers, and what it leaves to you.
---

The kit ships three **thin skills**: each calls `figma-qa` commands and keeps only the judgment the CLI can't make. [`figma-qa init`](./commands/init.md) installs them into `.agents/skills` and `.claude/skills` (Codex and Claude Code), and re-installs them when an upgrade changed them. It also writes a `figma-qa` rules block into `AGENTS.md`, so agents know the kit is there.

Agents pick a skill up on their own when a task matches its description; you can also name it (`/figma-qa` in Claude Code).

## figma-qa

**When:** a component with a Figma story changed, you ask whether code matches Figma, or Figma cells fail.

1. **Run** `figma-report --json`, scoped to the work: the components touched, or `--changed`. Exit 2 gets fixed (story config) or handed to you (token, Docker), never mistaken for a design verdict.
2. **Triage** every failing cell into a class, starting from the CLI's `triage`:

   | Class | Means | Owner |
   | --- | --- | --- |
   | structure | An element is missing, extra or reordered. | Component markup |
   | behaviour | One state differs while its siblings match. | State styles, or the story's forced state |
   | value | A spec number is off beyond tolerance. | Classes, spacing and type tokens |
   | token | A colour from another kit token than Figma's. | Colour class, or the token file |
   | mapping | `renderCell` renders the wrong variant or content. | The Figma story |
   | harness | Nothing measurable: capture blocked, sizes differ. | The story's wrapper or play function |
   | deliberate | A difference the code means. | An approval you confirm |

3. **Act**: fixes the story itself (harness, mapping); fixes the component when you asked for fixes, else reports the owner; for a deliberate difference, pastes the `approved` entry with a reason and **asks you to confirm it**.
4. **Report**: one table per story: cell, class, Figma value, story value, owner `file:line`, action, then the approvals waiting on you.

**Left to you:** confirming every approval, the Figma token, `--refresh` when Figma changed.

## figma-qa-scaffold

**When:** after [`figma-qa scaffold`](./commands/scaffold.md), or a Figma story still has `TODO(figma-qa)` stubs and every cell reports missing.

1. **Reads the axes** of each set from a `--json` report, beside the component's props.
2. **Names each entry** after the code variant it is (`icon-only`, not `button-icon`), equal in the `design` entry, the block and the `renderCell` key.
3. **Writes each renderer**: every option of every axis maps to a prop, or returns `null` on purpose. Labels and glyphs come from Figma's own variant spec, so the cell draws what Figma draws.
4. **Checks** with the `figma-qa` skill: the missing cells must be exactly the options it listed as having no code equivalent.

## figma-qa-variables

**When:** a report warns that Figma variables are unnamed, or a spec row reads `guess`.

1. Runs [`figma-qa variables`](./commands/variables.md): one read-only script block per Figma file.
2. Runs each block with the Figma MCP `use_figma` on that file.
3. Merges each returned JSON with `figma-qa variables <file>`, unedited.
4. Relays ids `not found in the file` to you.

Needs the Figma MCP server in your agent; `figma-qa doctor` reminds you with an `info  figma mcp` line.
