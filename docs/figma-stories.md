---
title: Figma stories
description: How a story links Figma component sets, renders each variant as a cell, and records approved deviations.
sidebar:
  order: 4
---

A **Figma story** is a story file the kit checks. It sits beside the component's normal stories as `<Component>.figma.stories.tsx`, and [`figma-qa scaffold`](./commands/scaffold.md) writes its first version.

## Anatomy

From `fixtures/sb11`, the `Swatch` component against a `Swatch` component set with `Size` and `Tone` axes:

```tsx
// src/Swatch.figma.stories.tsx
import { FigmaMatrix } from '@phenomenon-studio/storybook-figma-qa/preview';
import preview from '../.storybook/preview.ts';
import { Swatch } from './Swatch.tsx';
import { SWATCH_SET, swatchCell } from './swatch-cell.tsx';

const meta = preview.meta({
    title: 'Swatch/Figma',
    component: Swatch,
    // The matrix renders every variant itself; args only satisfy the component's required props.
    args: { tone: 'brand', size: 'small' } as const,
    tags: ['figma', '!autodocs'],
    parameters: { design: [{ name: 'swatch', type: 'figma', url: SWATCH_SET }] },
});

/** Brand passes, Neutral differs but is approved, Danger has no code equivalent: exit 0. */
export const Matrix = meta.story({
    parameters: {
        figmaMatrix: {
            blocks: [
                {
                    layout: { sections: null, columns: 'Tone' },
                    approved: [
                        {
                            when: { Tone: ['Neutral'] },
                            reason: 'Darker neutral for 3:1 non-text contrast (WCAG 1.4.11).',
                        },
                    ],
                },
            ],
        },
    },
    render: (_args, context) => {
        return <FigmaMatrix context={context} renderCell={swatchCell} />;
    },
});
```

```tsx
// src/swatch-cell.tsx
import type { RenderCell } from '@phenomenon-studio/storybook-figma-qa/preview';
import { Swatch } from './Swatch.tsx';

const TONES: Record<string, 'brand' | 'neutral' | undefined> = { Brand: 'brand', Neutral: 'neutral' };

/** Figma `Swatch` variant → code. Danger has no code tone: null reports the cell as missing. */
export const swatchCell: RenderCell = (props) => {
    const tone = TONES[props.Tone ?? ''];

    return tone ? <Swatch tone={tone} size={props.Size === 'Small' ? 'small' : 'large'} /> : null;
};

export const SWATCH_SET = 'https://www.figma.com/design/FIXTUREKIT/Fixture-UI-kit?node-id=10-0';
```

## The parts

- **`tags: ['figma']`** opts the file in. `report` scans story files as text and hands only these to Vitest. `!autodocs` keeps the matrix out of the component's docs page.
- **`parameters.design`**: one named `figma` entry per component set, the set's Figma URL. It is the shape `@storybook/addon-designs` reads, so its Design tab shows the set too when that addon is installed. This is the only place a set's URL is written.
- **`parameters.figmaMatrix.blocks`**: one block per component set. `name` picks its `design` entry (a story with one entry may omit it). `layout` groups Figma's variant axes: one section per `sections` option (or `null`), `columns` across, the rest down.
- **`renderCell(props)`**: gets one Figma variant's props (`{ Size: 'Small', Tone: 'Brand' }`) and returns the code's equivalent, or `null` when the code has none, which reports the cell `missing`. A story with several blocks passes an object keyed by block name.
- **`<FigmaMatrix>`** renders every variant of every block as a cell beside Figma's image, and the kit measures each cell.

## Cells and verdicts

Each Figma variant is one **cell**:

| Verdict | Meaning | Fails the run |
| --- | --- | --- |
| `pass` | Spec rows and pixels match within tolerance. | no |
| `fail` | A spec row or the pixel diff is off. Triaged as `token`, `value`, `harness` or untagged. | yes (exit 1) |
| `approved` | Differs, but an `approved` entry covers it. Still measured. | no |
| `missing` | `renderCell` returned `null`: Figma draws a variant the code doesn't have. | no |

## Approving a deviation

When a difference is deliberate, the report prints the entry to paste under each failing cell:

```text
approved: { when: { Size: ['Small'], Tone: ['Brand'] }, reason: 'TODO: why this deviation is deliberate (WCAG criterion or decision)' },
```

Paste it into that block's `approved` and replace the reason. `when` matches cells whose Figma props take one of the listed options; an omitted axis matches any option. Widen it by hand when one reason covers several cells, as `Tone: ['Neutral']` does above. Never approve a `harness` cell: the capture failed, so there is nothing to approve.

## Tolerances

A cell may differ on up to 5 % of its pixels by default, since text anti-aliasing alone differs on about 3 % (Figma's text renderer isn't Chromium's). Change it per story with `figmaMatrix.maxDiffRatio`, or for the project with [`maxDiffRatio`](./reference/config.md).
