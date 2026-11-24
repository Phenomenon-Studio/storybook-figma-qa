import type { RenderCell } from '@phenomenon-studio/storybook-figma-qa/preview';
import { FigmaMatrix } from '@phenomenon-studio/storybook-figma-qa/preview';
import preview from '../.storybook/preview.ts';
import { Swatch } from './Swatch.tsx';
import { SWATCH_SET, swatchCell } from './swatch-cell.tsx';

const meta = preview.meta({
    title: 'Swatch/Figma token',
    component: Swatch,
    // The matrix renders every variant itself; args only satisfy the component's required props.
    args: { tone: 'brand', size: 'small' } as const,
    tags: ['figma', '!autodocs'],
    parameters: { design: [{ name: 'swatch', type: 'figma', url: SWATCH_SET }] },
});

/** Brand painted with `--color-primary`: Figma's value, but not the `--color-brand` its variable names. */
const primaryCell: RenderCell = (props, variant) => {
    return props.Tone === 'Brand' ? (
        <Swatch tone="brand" token="--color-primary" size={props.Size === 'Small' ? 'small' : 'large'} />
    ) : (
        swatchCell(props, variant)
    );
};

/** Brand cells fail as right value, wrong token; Neutral is approved as in `Swatch/Figma`: exit 1. */
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
        return <FigmaMatrix context={context} renderCell={primaryCell} />;
    },
});
