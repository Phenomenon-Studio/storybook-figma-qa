---
title: figma-qa doctor
description: Check the kit's wiring and the human setup items (token, file access, browser image, variable names) without running a report.
---

Run it when a report exits 2 on setup, after cloning a project, or to see what is left after `init`. `report` runs the wiring half of it first; `init` ends with its human half as a checklist.

## Synopsis

```sh
figma-qa doctor
```

No flags. It never writes anything.

## Response example

In `fixtures/sb11`, with no `FIGMA_TOKEN`:

```text
ok    config: no figma-qa.config.ts, defaults apply
warn  icons: none match src/icons/*.svg; Figma cells render without glyphs (set icons.glob)
ok    refs: figma-qa/__refs__ in refs format 1
ok    setup: kit addon in .storybook/main, figma-qa Vitest project
todo  registry: .npmrc lacks @phenomenon-studio:registry=https://npm.pkg.github.com
      fix: run `figma-qa init`: it writes only that line
todo  figma token: FIGMA_TOKEN not set; reports run offline from committed refs, new sets and --refresh need it
      fix: create a personal access token (scope: File content, read-only) in Figma → Settings → Security
      fix: run `figma-qa init` in a terminal to paste it, or put FIGMA_TOKEN=<token> in .env.local (gitignored)
      fix: the token's owner needs a Dev or Full seat on the plan that owns the UI kit file (View/Collab seats get 429s)
info  file access: not checked: needs a working FIGMA_TOKEN (FIXTUREKIT)
ok    browser: Docker runs; pinned image mcr.microsoft.com/playwright:v1.65.1-noble pulled
ok    variables: every bound variable is named in figma-qa/__refs__/variables.json
info  figma mcp: agents name variables and read annotations through the Figma MCP server's use_figma; add it to your agent
figma-qa doctor: done
```

Each line is one check: the kit wiring (`config`, `icons`, `refs`, `setup`), then the human items init's wizard covers, in its order. A `fix:` line under a check is the human fix.

- **`ok`**: the check passed.
- **`todo`**: missing, and yours to add; the report still runs (offline without a token, the image pulled on first run). Exit stays 0.
- **`warn`**: the report still runs, but this is worth fixing, or a check couldn't reach Figma (`not verified: …`, a 429 names its `X-Figma-Rate-Limit-Type`). Exit stays 0.
- **`info`**: no action needed: no Figma story yet, no Docker (host Chromium), unnamed variables matched by value, the Figma MCP.
- **`block`**: setup is broken, and `report` would exit 2 too: refs in another format than the kit's (`block refs: figma-qa/__refs__ is refs format 2; this kit reads format 1: upgrade the kit.`, or `run \`figma-qa migrate\`` for older refs), kit wiring (fix: `figma-qa init`), a token Figma rejects (`401`/`403`), or a file its owner can't open. Doctor exits 2.

`file access` prints one line per Figma file: `ok    file access: FIXTUREKIT "Fixture UI kit", version 1`. A config that fails to load prints `figma-qa doctor: <reason>` on stderr and exits 2.

## Exit codes

- **0**: no `block` line. `todo`, `warn` and `info` never fail it.
- **2**: a `block` line, or a config that doesn't load.

## Related

- [`figma-qa init`](./init.md): fixes most `todo` lines and asks for the token.
- [Exit codes and warnings](../reference/exit-codes.md).
