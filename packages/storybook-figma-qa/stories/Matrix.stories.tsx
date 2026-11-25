// The matrix a Figma story renders, fed a fixed resolved set: it runs inside the user's Storybook, so it must pass
// the same axe checks their stories do (a project with `a11y: { test: 'error' }` fails every Figma story otherwise).
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { LoadedFigma } from '../src/figma/story.ts';
import type { FigmaSetManifest, FigmaVariant } from '../src/figma/types.ts';
import { expect, within } from 'storybook/test';
import { FigmaMatrix } from '../src/matrix.tsx';

function variant(props: Record<string, string>, index: number): FigmaVariant {
    const name = Object.entries(props)
        .map(([axis, option]) => {
            return `${axis}=${option}`;
        })
        .join(', ');

    return { id: `10:${index + 1}`, name, props } as unknown as FigmaVariant;
}

/** Every combination of the axes, Figma's order: one variant each. */
function loadedSet(axes: FigmaSetManifest['axes']): { figmaQa: LoadedFigma } {
    const combos = axes.reduce<Record<string, string>[]>(
        (acc, axis) => {
            return acc.flatMap((combo) => {
                return axis.options.map((option) => {
                    return { ...combo, [axis.name]: option };
                });
            });
        },
        [{}]
    );
    const manifest = { source: { name: 'Swatch' }, axes, variants: combos.map(variant) } as unknown as FigmaSetManifest;

    return {
        figmaQa: {
            blocks: [
                {
                    name: 'swatch',
                    url: 'https://www.figma.com/design/FIXTUREKIT/Kit?node-id=10-0',
                    slug: 'FIXTUREKIT-10-0',
                    block: { layout: { sections: 'Size', columns: 'Tone' } },
                    manifest,
                },
            ],
            variables: {},
            warnings: [],
        },
    };
}

const SIZE = { name: 'Size', options: ['Small', 'Large'] };
const TONE = { name: 'Tone', options: ['Brand', 'Danger'] };

const meta = {
    title: 'Matrix',
    component: FigmaMatrix,
    args: {
        context: { loaded: loadedSet([SIZE, TONE]) },
        // Danger has no code equivalent: its cell is the empty `missing` marker.
        renderCell: (props) => {
            return props.Tone === 'Danger' ? null : <span>{props.Size}</span>;
        },
    },
} satisfies Meta<typeof FigmaMatrix>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Every axis is a section or a column: no row labels. */
export const Sections: Story = {
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.getAllByRole('table')).toHaveLength(2);
        await expect(canvas.getAllByRole('columnheader', { name: 'Danger' })).toHaveLength(2);
        await expect(canvasElement.querySelectorAll('[data-figma-variant]')).toHaveLength(2);
        await expect(canvasElement.querySelectorAll('[data-figma-missing]')).toHaveLength(2);
    },
};

/** A third axis labels the rows: row headers, and an empty corner cell that is not a header. */
export const RowLabels: Story = {
    args: { context: { loaded: loadedSet([SIZE, { name: 'Shape', options: ['Square', 'Round'] }, TONE]) } },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.getAllByRole('rowheader', { name: 'Round' })).toHaveLength(2);
        await expect(canvasElement.querySelectorAll('[data-figma-variant]')).toHaveLength(4);
    },
};
