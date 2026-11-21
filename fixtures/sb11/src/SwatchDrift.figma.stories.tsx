import { FigmaMatrix } from '@phenomenon-studio/storybook-figma-qa/preview';
import preview from '../.storybook/preview.ts';
import { Swatch } from './Swatch.tsx';
import { SWATCH_SET, swatchCell } from './swatch-cell.tsx';

const meta = preview.meta({
    title: 'Swatch/Figma drift',
    component: Swatch,
    // The matrix renders every variant itself; args only satisfy the component's required props.
    args: { tone: 'brand', size: 'small' } as const,
    tags: ['figma', '!autodocs'],
    parameters: { design: [{ name: 'swatch', type: 'figma', url: SWATCH_SET }] },
});

/** Same matrix without the approval: the Neutral cells deliberately differ from Figma, exit 1. */
export const Matrix = meta.story({
    parameters: { figmaMatrix: { blocks: [{ name: 'swatch', layout: { sections: 'Size', columns: 'Tone' } }] } },
    render: (_args, context) => {
        return <FigmaMatrix context={context} renderCell={{ swatch: swatchCell }} />;
    },
});
