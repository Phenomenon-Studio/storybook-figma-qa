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
