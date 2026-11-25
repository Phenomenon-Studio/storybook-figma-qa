// The terminal diff under a failing cell, built from its results alone: pure, so tested without a fixture run.
import type { FigmaCellResult, FigmaIssue } from '../src/figma/types.ts';
import { describe, expect, it } from 'vitest';
import { cellDiff, MAX_DIFF_ROWS } from '../src/figma/cell-diff.ts';

const RESULTS = 'figma-qa/.results/results/swatch--matrix.json';

function issue(fields: Partial<FigmaIssue>): FigmaIssue {
    return {
        element: 'Swatch',
        property: 'Width',
        expected: { text: '32px' },
        actual: { text: '24px' },
        tolerance: '±1px',
        ...fields,
    };
}

function cell(mismatches: FigmaIssue[], image: Partial<FigmaCellResult['image']> = {}): Pick<FigmaCellResult, 'spec' | 'image' | 'files'> {
    return {
        spec: { mismatches, ignored: [] },
        image: {
            mismatchedPixels: 100,
            ratio: 0.312,
            maxRatio: 0.01,
            error: null,
            classes: null,
            pair: null,
            blob: null,
            ...image,
        },
        files: { figma: 'refs/a.png', actual: 'figma-qa/.results/a.png', diff: 'figma-qa/.results/a-diff.png' },
    };
}

const fill = issue({
    property: 'Fill',
    expected: { text: '#3B82F6', swatch: '#3B82F6', tokens: ['--color-brand'] },
    actual: { text: '#64748B', swatch: '#64748B', tokens: ['--color-neutral'] },
    tolerance: '±3 per RGB channel',
});

describe('cellDiff', () => {
    it('prints a row per difference, with tokens, delta and the pixel share, plain without colour', () => {
        const lines = cellDiff(cell([fill, issue({ delta: '−8px' })]), { colour: false, resultsFile: RESULTS });

        expect(lines).toEqual([
            'Swatch › Fill (±3 per RGB channel)',
            '- figma  #3B82F6  --color-brand',
            '+ story  #64748B  --color-neutral',
            'Swatch › Width (±1px)',
            '- figma  32px',
            '+ story  24px  delta −8px',
            'pixels: 31.2% differ (max 1%) → figma-qa/.results/a-diff.png',
        ]);
        expect(lines.join('\n')).not.toContain('\u001b');
    });

    it('paints the Figma line red and the story line green with colour on', () => {
        const lines = cellDiff(cell([fill]), { colour: true, resultsFile: RESULTS });

        expect(lines[1]).toBe('\u001b[31m- figma  #3B82F6  --color-brand\u001b[39m');
        expect(lines[2]).toBe('\u001b[32m+ story  #64748B  --color-neutral\u001b[39m');
        expect(lines[0]).not.toContain('\u001b');
    });

    it('prints the image error for a cell that could not be measured', () => {
        const lines = cellDiff(cell([], { ratio: null, mismatchedPixels: null, error: 'Sizes differ: 64×64 vs 48×48' }), {
            colour: false,
            resultsFile: RESULTS,
        });

        expect(lines).toEqual(['pixels: not measured: Sizes differ: 64×64 vs 48×48']);
    });

    it('caps the rows and points at the results file for the rest', () => {
        const rows = Array.from({ length: MAX_DIFF_ROWS + 2 }, (_, index) => {
            return issue({ property: `Prop ${index}` });
        });

        const lines = cellDiff(cell(rows, { ratio: 0.0004 }), { colour: false, resultsFile: RESULTS });

        expect(
            lines.filter((line) => {
                return line.startsWith('Swatch › ');
            })
        ).toHaveLength(MAX_DIFF_ROWS);
        expect(lines.at(-2)).toBe(`… 2 more rows in ${RESULTS}`);
        expect(lines.at(-1)).toBe('pixels: <0.1% differ (max 1%) → figma-qa/.results/a-diff.png');
    });
});
