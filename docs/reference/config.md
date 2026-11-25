---
title: figma-qa.config.ts
description: The optional project config. Every key has a default, so most projects have no file.
---

Put it at the project root. Both the CLI and the Storybook preview read it, so a hook runs where the comparison does: keep it browser-safe (no Node imports).

```ts
// figma-qa.config.ts
import { defineConfig } from '@phenomenon-studio/storybook-figma-qa/config';

export default defineConfig({
    tokens: { prefix: '--color-' },
    tokenName: (variable) => {
        return `--color-${variable.name.toLowerCase().replaceAll('/', '-')}`;
    },
    icons: { glob: 'src/icons/*.svg' },
    refsDir: 'figma-qa/__refs__',
    maxDiffRatio: 0.05,
});
```

| Key | Default | What it does |
| --- | --- | --- |
| `tokens.prefix` | `--color-` | Custom properties read as colour tokens from the preview's stylesheets. |
| `tokenName(variable)` | prefix + the variable's full path, kebab-cased (`Surface/control` → `--color-surface-control`) | The CSS token a Figma colour variable is expected as. `null`, or a name the stylesheets don't define, falls back to matching by value. |
| `icons.glob` | `src/icons/*.svg` | Project SVG icons, relative to the project root. Figma glyphs in a cell render from these. |
| `icons.name(figmaName)` | last path segment, kebab-cased (`Icons/Chevron Down` → `chevron-down`) | Figma glyph component name → icon file name without `.svg`. `iconName` exports the default, to wrap. |
| `refsDir` | `figma-qa/__refs__` | Committed Figma refs, relative to the project root. |
| `maxDiffRatio` | `0.05` | Share of pixels a cell may differ on. Text anti-aliasing alone differs on ~3 %. A story's `figmaMatrix.maxDiffRatio` wins. |

A config that doesn't load or validate makes every command exit 2 with the reason. Changing this file's format is a major kit release, shipped with a [`figma-qa migrate`](../commands/migrate.md) step.
