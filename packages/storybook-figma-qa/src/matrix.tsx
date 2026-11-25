// Renders one cell per Figma variant of each matrix block, laid out by the block's `layout`. A cell the code can
// render is stamped `data-figma-variant` and wraps only the component (its first child is what's measured); one
// `renderCell` returns null for is stamped `data-figma-missing`. Authors write only `renderCell(props)`.
import type { ReactNode } from 'react';
import type { LoadedFigma, ResolvedBlock } from './figma/story.ts';
import type { FigmaVariant } from './figma/types.ts';
import { layoutMatrix } from './figma/layout.ts';

/** Renders the code version of one Figma variant from its properties; null = no code equivalent. */
export type RenderCell = (props: Record<string, string>, variant: FigmaVariant) => ReactNode;

export type FigmaMatrixProps = {
    /** The story context: pass the render function's second argument. */
    context: { loaded: Record<string, unknown> };
    /** One renderer for every block, or one per design entry name. */
    renderCell: RenderCell | Record<string, RenderCell>;
};

const cellStyle = { padding: 12, verticalAlign: 'middle' } as const;
const labelStyle = { ...cellStyle, font: '12px/1.4 system-ui, sans-serif', textAlign: 'left' } as const;

function Block({ resolved, renderCell }: { resolved: ResolvedBlock; renderCell: RenderCell | undefined }) {
    const { name, block, manifest } = resolved;
    const sections = layoutMatrix(manifest.axes, block.layout, manifest.variants);

    return (
        <section data-figma-block={name}>
            <h2 style={labelStyle}>{manifest.source.name}</h2>
            {sections.map((section) => {
                // No axis left for the rows: no row labels, and no empty header cells (axe `empty-table-header`).
                const hasRowLabels = section.rows.some((row) => {
                    return row.label !== '';
                });

                return (
                    <table key={section.title ?? 'all'} style={{ borderCollapse: 'collapse' }}>
                        {section.title && <caption style={labelStyle}>{section.title}</caption>}
                        <thead>
                            <tr>
                                {hasRowLabels && <td />}
                                {section.columns.map((column) => {
                                    return (
                                        <th key={column} scope="col" style={labelStyle}>
                                            {column}
                                        </th>
                                    );
                                })}
                            </tr>
                        </thead>
                        <tbody>
                            {section.rows.map((row) => {
                                return (
                                    <tr key={row.label}>
                                        {hasRowLabels && (
                                            <th scope="row" style={labelStyle}>
                                                {row.label}
                                            </th>
                                        )}
                                        {row.cells.map((variant, column) => {
                                            if (!variant) {
                                                return (
                                                    <td key={`empty-${section.columns[column]}`} style={cellStyle} />
                                                );
                                            }
                                            const content = renderCell?.(variant.props, variant) ?? null;

                                            return (
                                                <td key={variant.id} style={cellStyle}>
                                                    {content === null ? (
                                                        <div data-figma-missing={variant.id} title={variant.name} />
                                                    ) : (
                                                        <div
                                                            data-figma-variant={variant.id}
                                                            title={variant.name}
                                                            style={{ position: 'relative', display: 'inline-flex' }}
                                                        >
                                                            {content}
                                                        </div>
                                                    )}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                );
            })}
        </section>
    );
}

/** The matrix of a Figma story: render it from the story's `render(args, context)`. */
export function FigmaMatrix({ context, renderCell }: FigmaMatrixProps) {
    const loaded = context.loaded.figmaQa as LoadedFigma | undefined;
    if (!loaded) {
        return (
            <p style={labelStyle}>
                Figma refs load in a `figma-qa report` run and in a running Storybook, not in a static build.
            </p>
        );
    }
    if ('error' in loaded) {
        return (
            <p role="alert" style={labelStyle}>
                {loaded.error}
            </p>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {loaded.blocks.map((resolved) => {
                return (
                    <Block
                        key={resolved.name}
                        resolved={resolved}
                        renderCell={typeof renderCell === 'function' ? renderCell : renderCell[resolved.name]}
                    />
                );
            })}
        </div>
    );
}
