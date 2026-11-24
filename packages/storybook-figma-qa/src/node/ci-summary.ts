// The markdown summary `figma-qa report --ci` writes for the PR comment: per-story cell counts and triage, with harness
// and setup errors kept apart from design verdicts. Built from the run summary alone, so it can't disagree with the
// HTML report or `--json`.
import type { FigmaRunSummary, FigmaStorySummary, TriageCategory } from '../figma/types.ts';
import { TOKEN_REJECTED } from './figma-api.ts';

/** First line of the summary: the workflow finds its sticky comment by it. */
export const CI_MARKER = '<!-- figma-qa -->';

const NOT_A_VERDICT = 'not a design verdict';

/** One line of markdown text: no HTML, no table breaks. */
function inline(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\|/g, '\\|')
        .replace(/\s*\n\s*/g, ' ')
        .trim();
}

function storyName(story: FigmaStorySummary): string {
    return inline(`${story.title} › ${story.name}`);
}

function headline(summary: FigmaRunSummary): string {
    if (summary.exitCode === 2) {
        return `harness or setup error (${NOT_A_VERDICT})`;
    }
    if (summary.exitCode === 0) {
        return 'pass';
    }
    // Exit 1 holds for a story whose only failures are unmeasured cells, but no cell said anything about the design.
    const designFailure = summary.stories.some((story) => {
        return story.failing.some((cell) => {
            return cell.triage !== 'harness';
        });
    });

    return designFailure ? 'fail' : `cells not measured (${NOT_A_VERDICT})`;
}

const TRIAGE_ORDER: (TriageCategory | null)[] = ['harness', 'token', 'value', null];

/** `token 1 · value 1 · uncategorised 2`: where judgment goes, at a glance. */
function triage(story: FigmaStorySummary): string {
    if (story.error) {
        return NOT_A_VERDICT;
    }
    const parts = TRIAGE_ORDER.flatMap((category) => {
        const count = story.failing.filter((cell) => {
            return cell.triage === category;
        }).length;
        if (count === 0) {
            return [];
        }
        if (category === 'harness') {
            return [`harness ${count} (${NOT_A_VERDICT})`];
        }

        return [`${category ?? 'uncategorised'} ${count}`];
    });

    return parts.length > 0 ? parts.join(' · ') : '–';
}

function row(story: FigmaStorySummary): string {
    const { pass, fail, approved, missing } = story.cells;
    // A story that errored measured nothing: zeros would read as a clean result.
    const counts = story.error ? ['–', '–', '–', '–'] : [pass, fail, approved, missing];

    return `| ${[storyName(story), story.verdict, ...counts, triage(story)].join(' | ')} |`;
}

function list(heading: string, items: string[]): string[] {
    return items.length > 0
        ? [
              `### ${heading}`,
              '',
              ...items.map((item) => {
                  return `- ${item}`;
              }),
              '',
          ]
        : [];
}

export function ciSummary(summary: FigmaRunSummary, options: { changed: boolean }): string {
    const lines = [CI_MARKER, `## Figma QA: ${headline(summary)}`, ''];
    if (summary.files.length === 0 && summary.exitCode === 0) {
        lines.push(options.changed ? 'No Figma stories affected.' : 'No Figma stories found.', '');
    } else {
        const { pass, fail, approved, missing } = summary.cells;
        lines.push(`${pass} pass · ${fail} fail · ${approved} approved · ${missing} missing`, '');
    }
    if (summary.stories.length > 0) {
        lines.push(
            '| Story | Verdict | Pass | Fail | Approved | Missing | Triage |',
            '| --- | --- | --- | --- | --- | --- | --- |',
            ...summary.stories.map(row),
            ''
        );
    }
    const errors = [
        ...summary.stories.flatMap((story) => {
            return story.error ? [`${storyName(story)}: ${inline(story.error)}`] : [];
        }),
        ...summary.errors.map(inline),
    ];
    lines.push(...list(`Errors (${NOT_A_VERDICT})`, errors));
    if (
        summary.errors.some((error) => {
            return error.startsWith(TOKEN_REJECTED);
        })
    ) {
        lines.push('Figma rejected the token: rotate the `FIGMA_TOKEN` repository secret.', '');
    }
    const failing = summary.stories.flatMap((story) => {
        return story.failing.map((cell) => {
            return `${storyName(story)}: ${inline(`${cell.block} · ${cell.variant}`)} (${cell.triage ?? 'uncategorised'})`;
        });
    });
    if (failing.length > 0) {
        lines.push(
            '<details><summary>Failing cells</summary>',
            '',
            ...failing.map((item) => {
                return `- ${item}`;
            }),
            '',
            '</details>',
            ''
        );
    }
    lines.push(...list('Warnings', summary.warnings.map(inline)));

    return `${lines.join('\n').trimEnd()}\n`;
}
