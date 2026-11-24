---
name: figma-qa-scaffold
description: Finish a Figma story that `figma-qa scaffold` wrote, naming each entry after the code's variant and writing its `renderCell` body. Use after running scaffold, or when a Figma story has `TODO(figma-qa)` stubs and every cell reports missing.
---

# Finish a scaffolded Figma story

`figma-qa scaffold` writes the deterministic part of `<Component>.figma.stories.tsx`: one `parameters.design` entry, one `figmaMatrix.blocks` entry and one `TODO(figma-qa)` renderer per Figma component set. This skill is the **mapping**: which code variant each set is, and which props render each Figma variant. Run the scaffold first when the user gave Figma URLs (`figma-qa scaffold <url...> --story <Component.stories.tsx>`); a re-run only appends sets.

## 1. Read the axes

Run `pnpm figma-report --json <Component>`. Every cell reports missing and it exits 0. Open the story's `results` file: each `blocks[]` has its design entry `set.name`, Figma's set name `set.set`, and `axes` (every property and its options).

Then read the component's props type and its existing stories.

**Done when** each block's axes sit beside the component props they could map to.

## 2. Name the entries

Name each entry after the code variant the set is (`icon-only`, not `button-icon`). The name lives in three places that must stay equal: the `design` entry's `name`, the block's `name`, and the `renderCell` key. Keep the scaffold's layout unless the user asks for another grouping.

**Done when** every entry name reads as a code variant and the three places match.

## 3. Write the renderers

Replace each stub with a body that maps the Figma props to the component: `(props, variant) => <Component … />`. Every option of every axis maps to a prop, or returns `null` on purpose because the code has no equivalent (the cell reports missing). Take labels from `variant.spec.texts[].characters` and glyphs from `<FigmaIcon figma={variant.spec.icons[i].component} />`, so the cell draws what Figma draws. Force interaction states (hover, focus, pressed) with the props or classes the component exposes. Delete the `TODO(figma-qa)` comment once its body is written.

**Done when** no `TODO(figma-qa)` remains, every option is mapped or listed as intentionally `null`, and the project's typecheck passes.

## 4. Check

Run the `figma-qa` skill on the component. Cells that fail because a renderer picked the wrong variant are **mapping**: fix them here.

**Done when** the report's missing cells are exactly the options you listed as having no code equivalent.
