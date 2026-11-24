// Deterministic triage of failing cells, and the `approved` entry the CLI prints for each. Only what code can tell:
// a cell whose rows don't all say why it fails stays uncategorised, so judgment is spent there. Browser-safe.
import type { FailingCell, FigmaBlockResult, FigmaCellResult, FigmaIssue, TriageCategory } from './types.ts';

/** A colour row: either side carries a swatch. */
function isColour(issue: FigmaIssue): boolean {
    return issue.expected.swatch !== undefined || issue.actual.swatch !== undefined;
}

function issueTriage(issue: FigmaIssue): Exclude<TriageCategory, 'harness'> | null {
    if (isColour(issue)) {
        const figma = issue.expected.tokens ?? [];
        const story = issue.actual.tokens ?? [];
        // Figma's colour is a kit token and the story's is another one: a token swap, not a design question.
        const another =
            figma.length > 0 &&
            story.length > 0 &&
            !story.some((token) => {
                return figma.includes(token);
            });

        return another ? 'token' : null;
    }

    return issue.delta === undefined ? null : 'value';
}

/**
 * `harness` when the image couldn't be measured, whatever the spec says. Otherwise every differing row must be
 * categorised (a pixel-only failure says nothing about why): `token` when any row is, else `value`.
 */
export function triageCell(cell: Pick<FigmaCellResult, 'status' | 'spec' | 'image'>): TriageCategory | null {
    if (cell.status !== 'fail') {
        return null;
    }
    if (cell.image.error) {
        return 'harness';
    }
    const rows = cell.spec.mismatches.map(issueTriage);
    if (rows.length === 0 || rows.includes(null)) {
        return null;
    }

    return rows.includes('token') ? 'token' : 'value';
}

const PLACEHOLDER = 'TODO: why this deviation is deliberate (WCAG criterion or decision)';

function quote(text: string): string {
    return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** `{ when: { Size: ['Large'], Tone: ['Brand'] }, reason: '…' }`: the variant's every prop, so it covers only it. */
export function approvalEntry(props: Record<string, string>): string {
    const when = Object.entries(props).map(([name, option]) => {
        const key = /^[A-Za-z_$][\w$]*$/.test(name) ? name : quote(name);

        return `${key}: [${quote(option)}]`;
    });

    return `{ when: { ${when.join(', ')} }, reason: ${quote(PLACEHOLDER)} }`;
}

export function failingCells(blocks: readonly FigmaBlockResult[]): FailingCell[] {
    return blocks.flatMap((block) => {
        return block.cells
            .filter((cell) => {
                return cell.status === 'fail';
            })
            .map((cell) => {
                return {
                    block: block.set.name,
                    variant: cell.variant.name,
                    triage: cell.triage,
                    // setup.ts never lets an approval cover an unmeasured cell: pasting one would change nothing.
                    approved: cell.triage === 'harness' ? null : approvalEntry(cell.variant.props),
                };
            });
    });
}
