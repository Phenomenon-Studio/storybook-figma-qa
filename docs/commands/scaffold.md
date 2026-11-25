---
title: figma-qa scaffold
description: Turn UI-kit pages, frames or component sets into a starter Figma story, one entry per component set.
---

Use it when a component has no Figma story yet, or its UI-kit page gained a set the story doesn't link. It writes the wiring; the [`figma-qa-scaffold` skill](../skills.md#figma-qa-scaffold) (or you) then names each entry after the code's variant and writes its `renderCell`.

## Synopsis

```sh
figma-qa scaffold <figma-url...> --story <path/Component.stories.tsx> [--dry-run]
```

| Argument | Effect |
| --- | --- |
| `<figma-url...>` | One or more Figma URLs: a page, section, frame or one component set. |
| `--story` | The component's existing story. Read for its title and imports, never edited. |
| `--dry-run` | Prints a unified diff of the Figma story instead of writing it. |

## What it does

`figma-qa scaffold <figma-url...> --story <path/Component.stories.tsx> [--dry-run]` turns UI-kit nodes into a starter Figma story. Each URL may be a page, section, frame or one component set; every `COMPONENT_SET` beneath it is collected, in URL order then document order. It needs a live `FIGMA_TOKEN` and makes one `/nodes` call per Figma file.

- **File**: only the kit-owned sibling `<Component>.figma.stories.tsx` is written; the story at `--story` is read, never edited. Its meta title plus `/Figma` is the title (no sibling: the path under `src/`), `tags: ['figma', '!autodocs']`, and `component` and the CSF Next `preview` come from the sibling's own imports (no sibling: `.storybook/preview` if it uses `definePreview`).
- **Entries**: one `parameters.design` entry, one `figmaMatrix.blocks` entry and one `renderCell` stub per set. The name is the set name's last `/` segment with the component's name stripped, in kebab-case (`Button/Button Icon` → `icon`); a clash gets `-2`, `-3` and a warning. The layout is written out: `columns` is `State`, else the axis with the most options; `sections` is `Size` when present and not the columns, else `null`.
- **Stubs**: each renderer returns `null` under a `TODO(figma-qa)` comment, so `figma-qa report` lists every cell as missing and exits 0 until the bodies are written.
- **Re-runs** append the sets the file doesn't link yet (matched by file key and node id) and change nothing else: renamed entries, their order and hand-written renderers stay. A linked set Figma no longer has is a warning; deleting it is the author's call. A file whose `design` entries, matrix story or top-level `renderCell` object aren't literals exits 2 with the lines to add by hand.
- **Cache**: the fetched sets go to the local raw cache, so the first report syncs them without another `/nodes` call.

## Response example

```text
figma-qa scaffold: wrote src/Button.figma.stories.tsx (2 sets added)
+ swatch  Swatch (10:0)  columns Tone, sections Size
+ glyph   Glyph (20:0)  columns Icon, no sections
next: rename each entry to the code's variant and write its renderCell; until then `figma-qa report Button` reports its cells missing
```

- **`wrote <file> (N sets added)`**: the Figma story was created or appended to.
- **`+ <entry>  <set> (<node id>)  columns …, sections …`**: one line per added set: the design entry name it got, Figma's set name and node id, and the layout written for its block.
- **`warn  <entry>: …`**: a name clash renamed the entry (`would also be named swatch; renamed swatch-2`), a linked set is `no longer a component set in Figma`, or a URL `holds no component set`. Warnings never change the exit code.
- **`already links every set; nothing to add`**: a re-run found nothing new and wrote nothing.

With `--dry-run` it prints a unified diff of the Figma story instead of writing it (`--- /dev/null` for a new file), then the same lines under `dry run, <file> not written (N sets to add)`:

```text
--- a/src/Button.figma.stories.tsx
+++ b/src/Button.figma.stories.tsx
@@ -12,6 +12,7 @@
     parameters: {
         design: [
             { name: 'swatch', type: 'figma', url: 'https://www.figma.com/design/FIXTUREKIT/Fixture-UI-kit?node-id=10-0' },
+            { name: 'glyph', type: 'figma', url: 'https://www.figma.com/design/FIXTUREKIT/Fixture-UI-kit?node-id=20-0' },
         ],
     },
 });
@@ -22,6 +23,10 @@
…
figma-qa scaffold: dry run, src/Button.figma.stories.tsx not written (1 set to add)
+ glyph  Glyph (20:0)  columns Icon, no sections
```

## Exit codes

- **0**: written, appended, or nothing to add. Warnings never change it.
- **2**: no `FIGMA_TOKEN`, a URL Figma rejects, or a Figma story whose `design` entries, matrix story or `renderCell` object aren't literals (the lines to add by hand are printed).

## Related

- [Figma stories](../figma-stories.md): the file scaffold writes, explained.
- [`figma-qa-scaffold` skill](../skills.md#figma-qa-scaffold): finishes the stubs.
