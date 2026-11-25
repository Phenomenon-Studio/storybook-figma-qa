// Fixed results for the UI stories: one of each case the panel and the report must show. Images are a real run's
// (fixtures/sb11, Swatch), served from `stories/images`.
import type { FigmaCellResult, FigmaRunSummary, FigmaStorySummary, FigmaStoryResult } from '../src/figma/types.ts';
import { resultsFile } from '../src/figma/types.ts';
import { failingCells } from '../src/figma/triage.ts';
import { countCells, runExitCode, storyVerdict } from '../src/figma/verdict.ts';

const SET_URL = 'https://www.figma.com/design/FIXTUREKIT/Fixture-UI-kit?node-id=10-0';
const RAN_AT = '2026-11-24T10:00:00.000Z';

/** Story files are served at the Storybook root. */
export function fileUrl(file: string): string {
    return `/${file}`;
}

function cell(status: FigmaCellResult['status'], tone: string, extra: Partial<FigmaCellResult> = {}): FigmaCellResult {
    const name = `Size=Small, Tone=${tone}`;
    const slug = tone.toLowerCase();

    return {
        variant: { id: `10:${tone}`, name, props: { Size: 'Small', Tone: tone } },
        status,
        approval: null,
        triage: null,
        spec: { mismatches: [], ignored: [] },
        image: {
            mismatchedPixels: 0,
            ratio: 0,
            maxRatio: 0.05,
            error: null,
            classes: { figma: 0, story: 0, colour: 0, masked: 0 },
            pair: null,
            blob: null,
        },
        files: { figma: `images/${slug}-figma.png`, actual: `images/${slug}-story.png`, diff: null },
        ...extra,
    };
}

const differs: Partial<FigmaCellResult> = {
    spec: {
        mismatches: [
            {
                element: 'Component',
                property: 'Background',
                expected: { text: 'hsl(210 10.8% 71%)', note: 'var Tone/Neutral' },
                actual: { text: 'hsl(210 7.1% 55.7%)', note: '= --color-neutral' },
                delta: 'ΔEOK 0.126 · 39 RGB',
                tolerance: 'ΔEOK ≤ 0.01 as seen',
                selector: 'div',
            },
        ],
        ignored: [],
    },
    image: {
        mismatchedPixels: 2214,
        ratio: 0.9609375,
        maxRatio: 0.05,
        error: null,
        classes: { figma: 0, story: 0, colour: 2232, masked: 0 },
        pair: { figma: '#adb5bd', story: '#868e96' },
        blob: { area: 558, box: { x: 0, y: 0, width: 24, height: 24 }, element: 'div' },
    },
    files: {
        figma: 'images/neutral-figma.png',
        actual: 'images/neutral-story.png',
        diff: 'images/neutral-diff.png',
    },
};

function story(storyId: string, name: string, cells: FigmaCellResult[], extra: Partial<FigmaStoryResult> = {}) {
    const result: FigmaStoryResult = {
        storyId,
        title: 'Swatch',
        name,
        blocks: [
            {
                set: { name: 'swatch', set: 'Swatch', url: SET_URL, version: '1' },
                layout: { sections: null, columns: 'Tone' },
                axes: [{ name: 'Tone', options: ['Brand', 'Neutral', 'Danger'] }],
                cells,
            },
        ],
        error: null,
        warnings: [],
        ranAt: RAN_AT,
        checksMs: 420,
        ...extra,
    };

    return result;
}

export const PASS = story('swatch--pass', 'Pass', [cell('pass', 'Brand'), cell('missing', 'Danger')]);

export const FAIL = story('swatch--fail', 'Fail', [cell('pass', 'Brand'), cell('fail', 'Neutral', differs)]);

export const APPROVED = story('swatch--approved', 'Approved', [
    cell('pass', 'Brand'),
    cell('approved', 'Neutral', {
        ...differs,
        approval: 'Darker neutral for 3:1 non-text contrast (WCAG 1.4.11).',
    }),
]);

export const HARNESS_ERROR = story('swatch--harness-error', 'Harness error', [], {
    blocks: [],
    error: 'Story is tagged `figma` but has no `parameters.figmaMatrix.blocks`.',
});

export const FIGMA_CHANGED = story('swatch--figma-changed', 'Figma changed', [cell('pass', 'Brand')], {
    warnings: [`Figma changed since ${SET_URL} was synced (version 1 → 2): run \`figma-qa report --refresh\` to adopt it.`],
});

/** One failing cell per triage category, and one that code can't categorise. */
export const TRIAGED = story('swatch--triaged', 'Triaged', [
    cell('fail', 'Brand', {
        triage: 'harness',
        image: {
            ...differs.image!,
            mismatchedPixels: null,
            ratio: null,
            error: 'Capture blocked: div.blocker covers the cell. Harness issue, not a design diff.',
            classes: null,
            pair: null,
            blob: null,
        },
    }),
    cell('fail', 'Neutral', { ...differs, triage: 'token' }),
    cell('fail', 'Accent', { ...differs, triage: 'value' }),
    cell('fail', 'Danger', differs),
]);

export const ALL = [PASS, FAIL, APPROVED, HARNESS_ERROR, FIGMA_CHANGED];

/** A story that failed to render: it wrote no results, only the run summary knows it. */
export const RENDER_FAILED: FigmaStorySummary = {
    storyId: 'swatch--render-failed',
    title: 'Swatch',
    name: 'Render failed',
    file: 'src/Swatch.figma.stories.tsx',
    verdict: 'error',
    cells: countCells([]),
    error: 'Story failed before the Figma checks: Cannot read properties of undefined (reading "tone")',
    results: null,
    failing: [],
};

/** A run over `results` (plus stories that wrote none), summarized as the CLI does (verdict.ts). */
export function runOf(
    results: FigmaStoryResult[],
    hostBrowser = false,
    unwritten: FigmaStorySummary[] = []
): FigmaRunSummary {
    const written = results.map((result) => {
        const cells = countCells(result.blocks);

        return {
            storyId: result.storyId,
            title: result.title,
            name: result.name,
            file: 'src/Swatch.figma.stories.tsx',
            verdict: storyVerdict(result.error, cells),
            cells,
            error: result.error,
            results: resultsFile(result.storyId),
            failing: failingCells(result.blocks),
        };
    });
    const stories = [...written, ...unwritten];
    const cells = countCells(
        results.flatMap((result) => {
            return result.blocks;
        })
    );

    return {
        exitCode: runExitCode(stories, []),
        hostBrowser,
        cells,
        files: ['src/Swatch.figma.stories.tsx'],
        stories,
        errors: [],
        warnings: [],
        timings: { doctor: 40, collect: 900, browser: 1200, tests: 14_250 },
        cellMs: 95,
        panelUrl: null,
    };
}
