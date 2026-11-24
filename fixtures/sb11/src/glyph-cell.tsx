import type { RenderCell } from '@phenomenon-studio/storybook-figma-qa/preview';
import { FigmaIcon } from '@phenomenon-studio/storybook-figma-qa/preview';

/**
 * Figma `Glyph` variant → code: the project icon its instance names, inset 4px. Icons live in `src/glyphs/` as
 * `glyph-<name>.svg`, outside the kit's default glob: without a config the cells render no glyph.
 */
export const glyphCell: RenderCell = (_props, variant) => {
    return (
        <div style={{ display: 'flex', boxSizing: 'border-box', width: 24, height: 24, padding: 4, color: 'var(--color-brand)' }}>
            <FigmaIcon figma={variant.spec.icons[0]?.component} />
        </div>
    );
};

export const GLYPH_SET = 'https://www.figma.com/design/FIXTUREKIT/Fixture-UI-kit?node-id=20-0';
