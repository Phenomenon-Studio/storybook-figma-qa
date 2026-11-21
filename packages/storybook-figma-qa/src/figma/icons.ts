// Glyph identity for the spec check: which project icon a Figma glyph names, and which one a rendered `<svg>` is.
// The project icon set isn't wired into the kit yet (`icons` config), so no glyph has a known file and the identity
// row is skipped; position, size and colour of glyphs are still compared.

/** The project SVG file a Figma glyph names, or null when the project has none. */
export function kitIconFile(_figma: string | null): string | null {
    return null;
}

/** The project SVG file a rendered `<svg>` was made from, or null when it isn't a project icon. */
export function kitIconOf(_svg: Element): string | null {
    return null;
}
