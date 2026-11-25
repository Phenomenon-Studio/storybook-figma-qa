// The `--ci` markdown summary, built from a run summary alone: pure, so tested without a fixture run.
import type { FigmaRunSummary, FigmaStorySummary } from '../src/figma/types.ts';
import { describe, expect, it } from 'vitest';
import { CI_MARKER, ciSummary } from '../src/node/ci-summary.ts';

function story(fields: Partial<FigmaStorySummary>): FigmaStorySummary {
    return {
        storyId: 'swatch--matrix',
        title: 'Swatch',
        name: 'Matrix',
        file: 'src/Swatch.figma.stories.tsx',
        verdict: 'pass',
        cells: { pass: 2, fail: 0, approved: 1, missing: 0 },
        error: null,
        results: null,
        failing: [],
        annotations: [],
        ...fields,
    };
}

function run(fields: Partial<FigmaRunSummary>): FigmaRunSummary {
    return {
        exitCode: 0,
        hostBrowser: false,
        cells: { pass: 0, fail: 0, approved: 0, missing: 0 },
        files: ['src/Swatch.figma.stories.tsx'],
        stories: [],
        errors: [],
        warnings: [],
        timings: {},
        cellMs: null,
        panelUrl: null,
        ...fields,
    };
}

function fail(variant: string, triage: 'harness' | 'token' | 'value' | null) {
    return { block: 'Swatch', variant, triage, approved: triage === 'harness' ? null : '{ … }' };
}

describe('ciSummary', () => {
    it('opens with the sticky-comment marker and the run verdict', () => {
        const markdown = ciSummary(
            run({ cells: { pass: 2, fail: 0, approved: 1, missing: 0 }, stories: [story({})] }),
            { changed: false }
        );

        expect(markdown.startsWith(`${CI_MARKER}\n`)).toBe(true);
        expect(markdown).toContain('Figma QA: pass');
        expect(markdown).toContain('2 pass · 0 fail · 1 approved · 0 missing');
        expect(markdown).toContain('| Swatch › Matrix | pass | 2 | 0 | 1 | 0 | – |');
    });

    it('counts failing cells per triage category, harness cells as not a design verdict', () => {
        const markdown = ciSummary(
            run({
                exitCode: 1,
                stories: [
                    story({
                        verdict: 'fail',
                        cells: { pass: 0, fail: 4, approved: 0, missing: 0 },
                        failing: [
                            fail('Size=Small, Tone=Brand', 'token'),
                            fail('Size=Large, Tone=Brand', 'value'),
                            fail('Size=Small, Tone=Neutral', null),
                            fail('Size=Large, Tone=Neutral', null),
                        ],
                    }),
                    story({
                        name: 'Blocked',
                        verdict: 'fail',
                        cells: { pass: 0, fail: 2, approved: 0, missing: 0 },
                        failing: [fail('Size=Small, Tone=Brand', 'harness'), fail('Size=Large, Tone=Brand', 'harness')],
                    }),
                ],
            }),
            { changed: false }
        );

        expect(markdown).toContain('Figma QA: fail');
        expect(markdown).toContain('| Swatch › Matrix | fail | 0 | 4 | 0 | 0 | token 1 · value 1 · uncategorised 2 |');
        expect(markdown).toContain('| Swatch › Blocked | fail | 0 | 2 | 0 | 0 | harness 2 (not a design verdict) |');
        expect(markdown).toContain('- Swatch › Matrix: Swatch · Size=Small, Tone=Brand (token)');
    });

    it('heads a run whose only failing cells are harness ones as not a design verdict', () => {
        const markdown = ciSummary(
            run({
                exitCode: 1,
                stories: [
                    story({
                        verdict: 'fail',
                        cells: { pass: 0, fail: 1, approved: 0, missing: 0 },
                        failing: [fail('Size=Small, Tone=Brand', 'harness')],
                    }),
                ],
            }),
            { changed: false }
        );

        expect(markdown).toContain('## Figma QA: cells not measured (not a design verdict)');
    });

    it('labels story and run errors as not a design verdict, escaped for markdown', () => {
        const markdown = ciSummary(
            run({
                exitCode: 2,
                stories: [
                    story({
                        title: 'Swatch/Figma misconfigured',
                        verdict: 'error',
                        cells: { pass: 0, fail: 0, approved: 0, missing: 0 },
                        error: 'No set <Swatch> | line one\nline two',
                    }),
                ],
                errors: ['src/Broken.figma.stories.tsx: failed to load'],
            }),
            { changed: false }
        );

        expect(markdown).toContain('Figma QA: harness or setup error (not a design verdict)');
        expect(markdown).toContain('| Swatch/Figma misconfigured › Matrix | error | – | – | – | – | not a design verdict |');
        expect(markdown).toContain('### Errors (not a design verdict)');
        expect(markdown).toContain('- Swatch/Figma misconfigured › Matrix: No set &lt;Swatch&gt; \\| line one line two');
        expect(markdown).toContain('- src/Broken.figma.stories.tsx: failed to load');
    });

    it('tells a rejected token to rotate the secret', () => {
        const markdown = ciSummary(
            run({
                exitCode: 2,
                errors: ['Figma rejected FIGMA_TOKEN (403 on /files/X/meta): check the token.'],
            }),
            { changed: false }
        );

        expect(markdown).toContain('rotate the `FIGMA_TOKEN` repository secret');
    });

    it('lists warnings, which never change the verdict', () => {
        const markdown = ciSummary(run({ stories: [story({})], warnings: ['Host Chromium (--ci): pixels differ.'] }), {
            changed: false,
        });

        expect(markdown).toContain('Figma QA: pass');
        expect(markdown).toContain('### Warnings\n\n- Host Chromium (--ci): pixels differ.');
    });

    it('says no Figma stories are affected when a --changed run collected none', () => {
        const markdown = ciSummary(run({ files: [] }), { changed: true });

        expect(markdown).toContain('No Figma stories affected.');
        expect(markdown).not.toContain('| Story |');
    });
});
