# Triage: failing Figma cells

A cell in the per-story results JSON (`blocks[].cells[]`, matched by `variant.name`) carries:

- `spec.mismatches[]`: one row per property that differs: `element`, `property`, `expected` (Figma), `actual` (story), `delta`, `tolerance`, `selector`. Colour sides carry `note` (kit token: `= --x` exact, `≈ --x (Δn)` nearest, `guess …` for an unnamed variable) and `tokens`; text and glyph colours carry `contrast` with the WCAG minimum.
- `image`: the pixel diff. `error` set → nothing was measured. `classes` counts differing pixels drawn only in Figma, only in the story, or in another colour; `blob` is the largest differing region and the element under it; `pair` is the dominant colour change. `files.diff` is the diff map to look at.

Spec rows outrank pixels: a pixel ratio says a difference exists, a row says what it is. Text is masked from pixels and judged by its rows.

## Classes

| Class | Means | Owner |
| --- | --- | --- |
| **structure** | An element is missing, extra or reordered; a glyph or label Figma draws that the code doesn't. | Component markup |
| **behaviour** | One state (hover, pressed, focused, disabled, selected) differs while its siblings match. | The component's state styles, or the story's forced state |
| **value** | A spec number is off beyond tolerance: size, padding, gap, radius, font. | The component's classes, spacing and type tokens |
| **token** | A colour from another kit token than Figma's, or a token whose value drifted from Figma. | The component's colour class, or the token file |
| **mapping** | The cell renders the wrong variant or content: `renderCell` maps an option wrong, or uses a fixed label instead of Figma's. | The Figma story |
| **harness** | Nothing measurable: capture blocked, sizes differ, a wrapper adds size, an animation frame. | The Figma story's wrapper or play function |
| **deliberate** | A difference the code means: a comment, ADR or design decision explains it. | An approval the user confirms |

## Signals

| Signal | Usual class | Check |
| --- | --- | --- |
| CLI `triage: 'harness'`, `Capture blocked: … covers the cell` | harness | Something stays above the cell (an open popup or overlay): close it in the play function. |
| CLI `triage: 'harness'`, sizes differ, spec clean | harness | The measured root, the first element inside `[data-figma-variant]`, isn't Figma's box: unwrap it or make the wrapper `flex`. |
| CLI `triage: 'token'`, tolerance `painted with --x` | token | The component paints with the token in `actual.note`; switch to `--x`. `not a kit token` means a raw colour. |
| Colour row, same token on both sides, Figma `≈ (Δn)` | token | The token's value drifted from Figma: fix the token, the component is right. |
| Colour row, Figma `≈` large Δ, no plausible token | deliberate or token | Figma uses a colour the kit lacks: ask design or add the token. |
| Colour row with `contrast.story ≥ required > contrast.figma` | deliberate | An accessibility fix: approve with the criterion, never copy Figma's colour. |
| One state column off, its siblings match | behaviour | The state style uses another token or value than Figma's state. |
| Every cell of a set off by the same amount | token or value | One shared token. |
| `Presence` (not found), or text that differs from Figma's | mapping | Take the label from the variant (`renderCell`'s second argument: `variant.spec.texts[].characters`), not a fixed string. |
| `Count` on icons or glyphs | structure, or mapping | Render the glyph the variant names (`<FigmaIcon figma={variant.spec.icons[i].component} />`); nothing renders when the project has no such icon. |
| `Font file` (fallback rendered) | harness | The font face for that weight isn't loaded in Storybook. |
| `Corner radius` and pixels pass | harness | Figma paints the radius on a deeper frame than the measured root. |
| Size or position row with `(±Npx)` | value | The tolerance already includes the text allowance; what is left is real. |
| Pixel-only fail | structure or value | `blob.element` names the element; `classes.figma` / `classes.story` = a shape drawn on one side only; `classes.colour` with `pair` = fill or stroke colour. |
| Spinner or animated cells a few percent off | harness | Pause the animation in the story. |

Fix rows that stand alone before rows that follow from them (a wrong size moves every child's offset), and re-run.

## Deliberate

Before calling value or behaviour drift a bug, search the component for the reason: comments citing a Figma node, a WCAG criterion or an ADR, and the project's decision records. A documented reason makes the cell an approval candidate. The CLI prints the entry to paste; `when` lists Figma property options, and an omitted property matches every option, so widen it only to cells that share the reason:

```ts
approved: [{ when: { State: ['Focused'] }, reason: 'Figma draws no focus ring; added for WCAG 2.4.7.' }],
```
