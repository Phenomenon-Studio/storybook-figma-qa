// What a failing cell's results say differs from Figma, as the lines `report` prints under it: a git-style `- figma` /
// `+ story` pair per spec row, then the pixel share. Presentation only, from the results JSON. Browser-safe.
import type { FigmaCellResult, FigmaIssue, FigmaIssueValue } from './types.ts';

/** Spec rows printed per cell; the rest are counted and left to the results file, so one cell can't flood the run. */
export const MAX_DIFF_ROWS = 5;

type Options = {
    /** ANSI red/green on the `-`/`+` lines: only for a person at a terminal, never for agents, pipes or CI logs. */
    colour: boolean;
    /** The story's results JSON, relative to the project root: where the rows past the cap are. */
    resultsFile: string;
};

/** ANSI foreground codes; 39 restores the default. */
const RED = 31;
const GREEN = 32;

function paint(text: string, code: number, colour: boolean): string {
    return colour ? `\u001b[${code}m${text}\u001b[39m` : text;
}

function side(label: string, value: FigmaIssueValue, delta?: string): string {
    return [label, value.text, value.tokens?.join(' '), delta && `delta ${delta}`]
        .filter((part) => {
            return Boolean(part);
        })
        .join('  ');
}

function row(issue: FigmaIssue, colour: boolean): string[] {
    return [
        `${issue.element} › ${issue.property} (${issue.tolerance})`,
        paint(side('- figma', issue.expected), RED, colour),
        // Delta is story minus Figma: it reads on the story's line.
        paint(side('+ story', issue.actual, issue.delta), GREEN, colour),
    ];
}

/** `31.2%`, `1%`; a non-zero share that rounds to nothing reads `<0.1%`, not a misleading `0%`. */
function percent(ratio: number): string {
    const value = Math.round(ratio * 1000) / 10;

    return value === 0 && ratio > 0 ? '<0.1%' : `${value}%`;
}

function pixels(image: FigmaCellResult['image'], diff: string | null): string[] {
    if (image.ratio !== null) {
        const file = diff ? ` → ${diff}` : '';

        return [`pixels: ${percent(image.ratio)} differ (max ${percent(image.maxRatio)})${file}`];
    }

    return image.error ? [`pixels: not measured: ${image.error}`] : [];
}

export function cellDiff(cell: Pick<FigmaCellResult, 'spec' | 'image' | 'files'>, options: Options): string[] {
    const { mismatches } = cell.spec;
    const shown = mismatches.slice(0, MAX_DIFF_ROWS).flatMap((issue) => {
        return row(issue, options.colour);
    });
    const hidden = mismatches.length - MAX_DIFF_ROWS;
    const more = hidden > 0 ? [`… ${hidden} more ${hidden === 1 ? 'row' : 'rows'} in ${options.resultsFile}`] : [];

    return [...shown, ...more, ...pixels(cell.image, cell.files.diff)];
}
