// `figma-qa report`: runs the project's Figma Vitest project, then reads the per-story results it wrote and turns
// them into one verdict. Exit 0: every cell passes, is approved or has no code equivalent; 1: any cell differs from
// Figma; 2: a harness or setup error (misconfigured story, uncached set, story that failed to render or load).
import type { TestModule } from 'vitest/node';
import type { FigmaRunSummary, FigmaStoryResult, FigmaStorySummary } from '../figma/types.ts';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FIGMA_PROJECT, REFRESH_ENV } from '../constants.ts';
import { REPORT_DIR, RESULTS_DIR, resultsFile, RUN_FILE } from '../figma/types.ts';
import { countCells, noCells, runExitCode, storyVerdict } from '../figma/verdict.ts';
import { figmaToken } from '../node/figma-api.ts';
import { loadProjectConfig } from '../node/config.ts';
import { readJson } from '../node/json.ts';

/** Every run uses the host's Chromium until the pinned browser image is wired in: pixels aren't comparable to CI. */
const HOST_BROWSER = true;

type Options = { json: boolean; refresh: boolean; filters: string[] };

function parseArgs(argv: string[]): Options | string {
    const options: Options = { json: false, refresh: false, filters: [] };
    for (const arg of argv) {
        if (arg === '--json') {
            options.json = true;
        } else if (arg === '--refresh') {
            options.refresh = true;
        } else if (arg.startsWith('-')) {
            return `unknown option ${arg}`;
        } else {
            options.filters.push(arg);
        }
    }

    return options;
}

/** This run's results for a story; null when the story wrote none. */
async function readResult(root: string, storyId: string): Promise<FigmaStoryResult | null> {
    return readJson<FigmaStoryResult>(path.join(root, resultsFile(storyId)));
}

function failed(error: string): FigmaRunSummary {
    return { exitCode: 2, hostBrowser: HOST_BROWSER, cells: noCells(), stories: [], errors: [error], warnings: [] };
}

function message(error: unknown): string {
    return (error as { message?: string })?.message ?? String(error);
}

async function summarize(
    root: string,
    modules: readonly TestModule[],
    unhandled: readonly unknown[]
): Promise<{ summary: FigmaRunSummary; results: FigmaStoryResult[] }> {
    const stories: FigmaStorySummary[] = [];
    const results: FigmaStoryResult[] = [];
    const errors = unhandled.map(message);
    const warnings = new Set<string>();
    for (const module of modules) {
        const file = path.relative(root, module.moduleId);
        for (const error of module.errors()) {
            errors.push(`${file}: ${message(error)}`);
        }
        for (const test of module.children.allTests()) {
            const state = test.result().state;
            if (state === 'skipped' || state === 'pending') {
                continue;
            }
            const storyId = (test.meta() as { storyId?: string }).storyId ?? null;
            const result = storyId ? await readResult(root, storyId) : null;
            let error = result?.error ?? null;
            if (!result) {
                // The checks never ran: the story didn't render, or isn't a Figma story addon-vitest could compose.
                const cause = test.result().errors?.[0];
                error = cause ? message(cause) : 'No Figma results written for this story.';
            } else {
                results.push(result);
            }
            for (const warning of result?.warnings ?? []) {
                warnings.add(warning);
            }
            const cells = countCells(result?.blocks ?? []);
            stories.push({
                storyId,
                title: result?.title ?? file,
                name: test.name,
                file,
                verdict: storyVerdict(error, cells),
                cells,
                error,
                results: result && storyId ? resultsFile(storyId) : null,
            });
        }
    }
    const summary: FigmaRunSummary = {
        exitCode: runExitCode(stories, errors),
        hostBrowser: HOST_BROWSER,
        cells: countCells(
            results.flatMap((result) => {
                return result.blocks;
            })
        ),
        stories,
        errors,
        warnings: [...warnings],
    };

    return { summary, results };
}

/**
 * Leaves the run where the panel and the HTML report read it: the summary beside the story results, and the report
 * directory rendered from both. A report that fails to render is a harness error, not a lost verdict.
 */
async function writeRun(root: string, summary: FigmaRunSummary, results: FigmaStoryResult[]) {
    let written = summary;
    try {
        // React's server renderer loads only here, once per run.
        const { writeHtmlReport } = await import('../node/html-report.ts');
        await writeHtmlReport(root, summary, results);
    } catch (error) {
        written = { ...summary, exitCode: 2, errors: [...summary.errors, `HTML report: ${message(error)}`] };
    }
    await mkdir(path.join(root, RESULTS_DIR), { recursive: true });
    await writeFile(path.join(root, RUN_FILE), `${JSON.stringify(written, null, 4)}\n`);

    return written;
}

function printHuman(summary: FigmaRunSummary): void {
    for (const story of summary.stories) {
        const { pass, fail, approved, missing } = story.cells;
        const counts = `${pass} pass, ${fail} fail, ${approved} approved, ${missing} missing`;
        const detail = story.error ? `error: ${story.error}` : counts;
        console.log(`${story.verdict.toUpperCase().padEnd(5)} ${story.title} › ${story.name}: ${detail}`);
    }
    for (const error of summary.errors) {
        console.log(`ERROR ${error}`);
    }
    for (const warning of summary.warnings) {
        console.log(`WARN  ${warning}`);
    }
    const { pass, fail, approved, missing } = summary.cells;
    console.log(
        `\nfigma-qa report: ${pass} pass, ${fail} fail, ${approved} approved, ${missing} missing (exit ${summary.exitCode})`
    );
    if (summary.stories.length > 0) {
        console.log(`HTML report: ${REPORT_DIR}/index.html`);
    }
}

type Ran = { summary: FigmaRunSummary; results: FigmaStoryResult[] };

function failedRun(error: string): Ran {
    return { summary: failed(error), results: [] };
}

/** Runs the Figma Vitest project and summarizes what it wrote. */
async function run(root: string, options: Options): Promise<Ran> {
    if (options.refresh && !figmaToken()) {
        return failedRun('--refresh fetches from Figma and needs FIGMA_TOKEN.');
    }
    try {
        // Rejected before Vitest starts: a typo'd key must not run with defaults.
        await loadProjectConfig(root);
    } catch (error) {
        return failedRun(message(error));
    }
    // The browser commands run in this process: sync.ts reads the flag from here.
    if (options.refresh) {
        process.env[REFRESH_ENV] = '1';
    }

    // `--json` keeps stdout for the summary: Vitest's output and anything plugins log go to stderr.
    // Redirect the stream, not `console.log`: Storybook writes its first-run telemetry notice
    // straight to `process.stdout`.
    const writeStdout = process.stdout.write;
    if (options.json) {
        process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write;
    }
    let ran: Ran;
    try {
        const { startVitest } = await import('vitest/node');
        // Filled by the reporter at the end of the run.
        const result: { summary?: ReturnType<typeof summarize> } = {};
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
                            result.summary = summarize(root, modules, unhandled);
                        },
                    },
                ],
            },
            {},
            { stdout: options.json ? process.stderr : process.stdout, stderr: process.stderr }
        );
        await vitest.close();
        ran = (await result.summary) ?? failedRun('Vitest did not run.');
    } catch (error) {
        ran = failedRun(message(error));
    } finally {
        process.stdout.write = writeStdout;
    }

    return ran;
}

export async function report(argv: string[]): Promise<number> {
    const options = parseArgs(argv);
    if (typeof options === 'string') {
        console.error(`figma-qa report: ${options}`);

        return 2;
    }
    const root = process.cwd();
    // Only this run's output counts: stale results would mask a story that no longer writes any, and the panel would
    // show a run that a setup error replaced.
    await rm(path.join(root, RESULTS_DIR), { recursive: true, force: true });
    const ran = await run(root, options);
    const summary = await writeRun(root, ran.summary, ran.results);

    if (options.json) {
        console.log(JSON.stringify(summary, null, 4));
    } else {
        printHuman(summary);
    }

    return summary.exitCode;
}
