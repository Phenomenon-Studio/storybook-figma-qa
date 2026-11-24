import { FigmaMatrix } from '@phenomenon-studio/storybook-figma-qa/preview';
import preview from '../.storybook/preview.ts';
import { GLYPH_SET, glyphCell } from './glyph-cell.tsx';

// Not a literal at the meta: `figma-qa report` can't read it statically and collects the file anyway. Storybook
// resolves a same-file const.
const GLYPH_TAGS = ['figma', '!autodocs'];

const meta = preview.meta({
    title: 'Glyph/Figma',
    tags: GLYPH_TAGS,
    parameters: { design: [{ name: 'glyph', type: 'figma', url: GLYPH_SET }] },
});

/** Passes only when the config's `icons` finds `src/glyphs/glyph-*.svg`; with the default glob, exit 1. */
export const Matrix = meta.story({
    parameters: { figmaMatrix: { blocks: [{ layout: { sections: null, columns: 'Icon' } }] } },
    render: (_args, context) => {
        return <FigmaMatrix context={context} renderCell={glyphCell} />;
    },
});
