import type { RenderCell } from '@phenomenon-studio/storybook-figma-qa/preview';
import { FigmaMatrix } from '@phenomenon-studio/storybook-figma-qa/preview';
import preview from '../.storybook/preview.ts';
import { Swatch } from './Swatch.tsx';
import { SWATCH_SET, swatchCell } from './swatch-cell.tsx';

const meta = preview.meta({
    title: 'Swatch/Figma triage',
    component: Swatch,
    // The matrix renders every variant itself; args only satisfy the component's required props.
    args: { tone: 'brand', size: 'small' } as const,
    tags: ['figma', '!autodocs'],
    parameters: {
        design: [{ name: 'swatch', type: 'figma', url: SWATCH_SET }],
        figmaMatrix: { blocks: [{ layout: { sections: 'Size', columns: 'Tone' } }] },
    },
});

/**
 * Small Brand painted with `--color-neutral` (token: Figma names `--color-brand`), Large Brand drawn small (value: its
 * size and radius are off). Neutral differs by a colour no kit token holds: uncategorised.
 */
const triageCell: RenderCell = (props, variant) => {
    if (props.Tone !== 'Brand') {
        return swatchCell(props, variant);
    }

    return props.Size === 'Small' ? <Swatch tone="brand" size="small" token="--color-neutral" /> : <Swatch tone="brand" size="small" />;
};

/** One failing cell per triage category but harness, plus an uncategorised one: exit 1. */
export const Matrix = meta.story({
    render: (_args, context) => {
        return <FigmaMatrix context={context} renderCell={triageCell} />;
    },
});

/** A fixed overlay above the cells the capture can't hide (`!important` beats inline `visibility`): every cell is harness. */
export const Blocked = meta.story({
    render: (_args, context) => {
        return (
            <>
                <style>{'.fixture-blocker { visibility: visible !important; }'}</style>
                <div className="fixture-blocker" style={{ position: 'fixed', inset: 0, zIndex: 1, background: '#000' }} />
                <FigmaMatrix context={context} renderCell={swatchCell} />
            </>
        );
    },
});
