---
title: figma-qa migrate
description: Carry committed refs and config to the installed kit's format after a major upgrade.
---

You rarely run it yourself: `figma-qa init` runs the installed kit's `migrate` after an upgrade. Run it directly when `report` or `doctor` says the refs need it.

## Synopsis

```sh
figma-qa migrate [--dry-run]
```

| Flag | Effect |
| --- | --- |
| `--dry-run` | Prints the plan; writes nothing. |

`<refsDir>/format.json` records the refs format, `{ "format": 1 }`. Migrate runs every step after the recorded format, in order, and moves the stamp after each one, so a failed step re-runs from where it stopped. Commit what it writes.

## Response example

Refs already in the kit's format:

```text
ok    figma-qa/__refs__: refs format 1, up to date
figma-qa migrate: done
```

Refs committed before the format stamp existed (`format.json` removed):

```text
write figma-qa/__refs__/format.json: refs format 1
figma-qa migrate: done
```

The same with `--dry-run`: the plan, nothing written:

```text
write figma-qa/__refs__/format.json: refs format 1
figma-qa migrate: dry run, nothing written
```

- **`ok`**: the refs are in this kit's format, or there are none (`figma-qa/__refs__: no committed refs, nothing to migrate`); nothing is written.
- **`write`**: the stamp is written. A step run adds a line per step before it, `run   refs format 1 → 2: <what the step changes>`; the stamp moves after each step.
- **`figma-qa migrate: done`**: the closing line. Init prints the step lines but not this one. Before the kit is installed, `init --dry-run` prints `plan  figma-qa migrate, after installing the kit`; an installed kit from before `migrate` existed prints `ok    migrate: the installed kit predates figma-qa migrate`.
- **Exit 2**, on stderr: refs from a newer kit (`figma-qa migrate: figma-qa/__refs__ is refs format 2; this kit reads format 1: upgrade the kit.`), a stamp that isn't `{ "format": <positive integer> }`, a step that failed (`refs format 1 → 2 failed: <reason>`; the stamp stays at the last finished step, so a re-run resumes there), or a config the kit can't load. `report` names the same refs format error in its summary `errors`, `variables` on stderr (exit 2), and `doctor` as a `block refs:` line; init stops at `figma-qa init: figma-qa migrate failed (exit 2): fix what it names, then re-run init.`

## Exit codes

- **0**: up to date, migrated, or a dry run.
- **2**: refs from a newer kit, a malformed stamp, a failed step, or a config that doesn't load (above).

## Related

- [Upgrading](../upgrading.md).
