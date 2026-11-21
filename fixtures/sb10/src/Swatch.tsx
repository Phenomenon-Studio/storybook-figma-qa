export type SwatchProps = { tone: 'brand' | 'neutral'; size: 'small' | 'large' };

const SIZES = { small: { side: 24, radius: 4 }, large: { side: 40, radius: 8 } };

/** A colour chip. The code has no `danger` tone: the Figma set's Danger variants have no code equivalent. */
export function Swatch({ tone, size }: SwatchProps) {
    const { side, radius } = SIZES[size];

    return <div style={{ width: side, height: side, borderRadius: radius, background: `var(--color-${tone})` }} />;
}
