// `figma-qa report`: runs the project's Figma Vitest project, then reads the per-story results it wrote and turns
// them into one verdict. Exit 0: every cell passes, is approved or has no code equivalent; 1: any cell differs from
// Figma; 2: a harness or setup error (misconfigured story, uncached set, story that failed to render or load).
import type { TestModule } from 'vitest/node';
import type { FigmaCellResult, FigmaStoryResult } from '../figma/types.ts';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { FIGMA_PROJECT } from '../constants.ts';
import { RESULTS_DIR, resultsFile } from '../figma/types.ts';
import { readJson } from '../node/commands.ts';

type Status = FigmaCellResult['status'];

type StorySummary = {
    storyId: string | null;
    title: string;
    name: string;
    file: string;
    /** `error`: harness or setup error, not a design verdict. */
    verdict: 'pass' | 'fail' | 'error';
    cells: Record<Status, number>;
    error: string | null;
    /** Per-story results JSON, relative to the project root. */
    results: string | null;
};

export type ReportSummary = {
    exitCode: 0 | 1 | 2;
    cells: Record<Status, number>;
    stories: StorySummary[];
    /** Errors outside any story: unloadable story files, unhandled errors, a missing Figma project. */
    errors: string[];
};

type Options = { json: boolean; filters: string[] };

function parseArgs(argv: string[]): Options | string {
    const options: Options = { json: false, filters: [] };
    for (const arg of argv) {
        if (arg === '--json') {
            options.json = true;
        } else if (arg.startsWith('-')) {
            return `unknown option ${arg}`;
        } else {
            options.filters.push(arg);
        }
    }

    return options;
}

function noCells(): Record<Status, number> {
    return { pass: 0, fail: 0, approved: 0, missing: 0 };
}

/** This run's results for a story; null when the story wrote none. */
async function readResult(root: string, storyId: string): Promise<FigmaStoryResult | null> {
    return readJson<FigmaStoryResult>(path.join(root, resultsFile(storyId)));
}

function message(error: unknown): string {
    return (error as { message?: string })?.message ?? String(error);
}

async function summarize(root: string, modules: readonly TestModule[], unhandled: readonly unknown[]) {
    const summary: ReportSummary = { exitCode: 0, cells: noCells(), stories: [], errors: unhandled.map(message) };
    for (const module of modules) {
        const file = path.relative(root, module.moduleId);
        for (const error of module.errors()) {
            summary.errors.push(`${file}: ${message(error)}`);
        }
        for (const test of module.children.allTests()) {
            const state = test.result().state;
            if (state === 'skipped' || state === 'pending') {
                continue;
            }
            const storyId = (test.meta() as { storyId?: string }).storyId ?? null;
            const result = storyId ? await readResult(root, storyId) : null;
            const story: StorySummary = {
                storyId,
                title: result?.title ?? file,
                name: test.name,
                file,
                verdict: 'pass',
                cells: noCells(),
                error: result?.error ?? null,
                results: result && storyId ? resultsFile(storyId) : null,
            };
            const cells = result?.blocks.flatMap((block) => {
                return block.cells;
            });
            for (const cell of cells ?? []) {
                story.cells[cell.status]++;
                summary.cells[cell.status]++;
            }
            if (!result) {
                // The checks never ran: the story didn't render, or isn't a Figma story addon-vitest could compose.
                const cause = test.result().errors?.[0];
                story.error = cause ? message(cause) : 'No Figma results written for this story.';
            }
            if (story.error) {
                story.verdict = 'error';
            } else if (story.cells.fail > 0) {
                story.verdict = 'fail';
            }
            summary.stories.push(story);
        }
    }
    const verdicts = summary.stories.map((story) => {
        return story.verdict;
    });
    if (summary.errors.length > 0 || verdicts.includes('error')) {
        summary.exitCode = 2;
    } else if (verdicts.includes('fail')) {
        summary.exitCode = 1;
    }

    return summary;
}

function printHuman(summary: ReportSummary): void {
    for (const story of summary.stories) {
        const { pass, fail, approved, missing } = story.cells;
        const counts = `${pass} pass, ${fail} fail, ${approved} approved, ${missing} missing`;
        const detail = story.error ? `error: ${story.error}` : counts;
        console.log(`${story.verdict.toUpperCase().padEnd(5)} ${story.title} › ${story.name}: ${detail}`);
    }
    for (const error of summary.errors) {
        console.log(`ERROR ${error}`);
    }
    const { pass, fail, approved, missing } = summary.cells;
    console.log(
        `\nfigma-qa report: ${pass} pass, ${fail} fail, ${approved} approved, ${missing} missing (exit ${summary.exitCode})`
    );
}

export async function report(argv: string[]): Promise<number> {
    const options = parseArgs(argv);
    if (typeof options === 'string') {
        console.error(`figma-qa report: ${options}`);

        return 2;
    }
    const root = process.cwd();
    // Only this run's output counts: stale results would mask a story that no longer writes any.
    await rm(path.join(root, RESULTS_DIR), { recursive: true, force: true });

    // `--json` keeps stdout for the summary: Vitest's output and anything plugins log go to stderr.
    // Redirect the stream, not `console.log`: Storybook writes its first-run telemetry notice
    // straight to `process.stdout`.
    const writeStdout = process.stdout.write;
    if (options.json) {
        process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write;
    }
    let summary: ReportSummary;
    try {
        const { startVitest } = await import('vitest/node');
        // Filled by the reporter at the end of the run.
        const run: { summary?: Promise<ReportSummary> } = {};
        const vitest = await startVitest(
            'test',
            options.filters,
            {
                watch: false,
                project: [FIGMA_PROJECT],
                reporters: [
                    ...(options.json ? [] : ['default' as const]),
                    {
                        onTestRunEnd: (modules, unhandled) => {
                            run.summary = summarize(root, modules, unhandled);
                        },
                    },
                ],
            },
            {},
            { stdout: options.json ? process.stderr : process.stdout, stderr: process.stderr }
        );
        await vitest.close();
        summary = (await run.summary) ?? {
            exitCode: 2,
            cells: noCells(),
            stories: [],
            errors: ['Vitest did not run.'],
        };
    } catch (error) {
        summary = { exitCode: 2, cells: noCells(), stories: [], errors: [message(error)] };
    } finally {
        process.stdout.write = writeStdout;
    }

    if (options.json) {
        console.log(JSON.stringify(summary, null, 4));
    } else {
        printHuman(summary);
    }

    return summary.exitCode;
}
