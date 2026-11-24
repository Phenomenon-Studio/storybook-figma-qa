// Renders the project icon a Figma glyph names, for cells: `<FigmaIcon figma={variant.spec.icons[0]?.component} />`.
import { projectIcon } from './figma/icons.ts';

export type FigmaIconProps = {
    /** Figma glyph component name (`Icons/Chevron Down`), mapped to a file by the config's `icons.name`. */
    figma: string | null | undefined;
};

/** The project SVG, inline so it inherits `currentColor`; nothing when the project has no such icon. */
export function FigmaIcon({ figma }: FigmaIconProps) {
    const icon = projectIcon(figma ?? null);

    return icon ? (
        // The project's own SVG file, matched by its icons glob: trusted like any imported asset.
        <span style={{ display: 'inline-flex' }} dangerouslySetInnerHTML={{ __html: icon.svg }} />
    ) : null;
}
