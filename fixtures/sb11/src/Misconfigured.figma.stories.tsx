import preview from '../.storybook/preview.ts';
import { Swatch } from './Swatch.tsx';
import { SWATCH_SET } from './swatch-cell.tsx';

// Tagged `figma` but half-configured: each story is a setup error, exit 2.
const meta = preview.meta({
    title: 'Swatch/Figma misconfigured',
    tags: ['figma', '!autodocs'],
    render: () => {
        return <Swatch tone="brand" size="small" />;
    },
});

export const NoDesignEntry = meta.story({
    parameters: { figmaMatrix: { blocks: [{ layout: { sections: null, columns: 'Tone' } }] } },
});

export const NoMatrix = meta.story({
    parameters: { design: [{ name: 'swatch', type: 'figma', url: SWATCH_SET }] },
});
// proof PR: affected (expect CLI exit 2)
