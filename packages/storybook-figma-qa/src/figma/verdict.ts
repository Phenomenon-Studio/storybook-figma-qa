// The one place a verdict is derived from results: the CLI summary, the Storybook panel and the HTML report all call
// these, so they can't disagree. Browser-safe: no Node imports.
import type { CellCounts, FigmaBlockResult, FigmaStorySummary, StoryVerdict } from './types.ts';

export function noCells(): CellCounts {
    return { pass: 0, fail: 0, approved: 0, missing: 0 };
}

export function countCells(blocks: readonly FigmaBlockResult[]): CellCounts {
    const counts = noCells();
    for (const block of blocks) {
        for (const cell of block.cells) {
            counts[cell.status]++;
        }
    }

    return counts;
}

/** A harness error outranks any cell; `missing` and `approved` cells never fail a story. */
export function storyVerdict(error: string | null, cells: CellCounts): StoryVerdict {
    if (error) {
        return 'error';
    }

    return cells.fail > 0 ? 'fail' : 'pass';
}

/** 2: a harness or setup error anywhere; 1: any cell differs from Figma; 0 otherwise. */
export function runExitCode(stories: readonly Pick<FigmaStorySummary, 'verdict'>[], errors: readonly string[]) {
    const verdicts = stories.map((story) => {
        return story.verdict;
    });
    if (errors.length > 0 || verdicts.includes('error')) {
        return 2;
    }

    return verdicts.includes('fail') ? 1 : 0;
}
