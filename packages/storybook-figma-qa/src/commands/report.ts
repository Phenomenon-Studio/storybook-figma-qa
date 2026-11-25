// `figma-qa report`: the one local command. doctor → browser → collect → tests (Figma sync happens lazily inside) →
// report → open, never prompting. Runs the project's Figma Vitest project on the story files a static scan finds,
// then reads the per-story results they wrote and turns them into one verdict. Exit 0: every cell passes, is approved
// or has no code equivalent; 1: any cell differs from Figma; 2: a harness or setup error (blocked setup, unreachable
// browser, misconfigured story, uncached set, story that failed to render or load).
import type { TestModule, Vitest } from 'vitest/node';
import type { FigmaRunSummary, FigmaStoryResult, FigmaStorySummary, RunPhase } from '../figma/types.ts';
import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BROWSER_WS_ENV, REFRESH_ENV, STORIES_KEY } from '../constants.ts';
import { CI_SUMMARY_FILE, REPORT_DIR, RESULTS_DIR, resultsFile, RUN_FILE } from '../figma/types.ts';
import { failingCells } from '../figma/triage.ts';
import { countCells, noCells, runExitCode, storyVerdict } from '../figma/verdict.ts';
import { pickBrowser } from '../node/browser.ts';
import { ciSummary } from '../node/ci-summary.ts';
import { figmaToken } from '../node/figma-api.ts';
import { addonBlocked, openFigmaProject } from '../node/figma-project.ts';
import { CONFIG_FILE } from '../figma/config.ts';
import { loadProjectConfig } from '../node/config.ts';
import { refsFormatBlocked } from '../node/migrate.ts';
import { readJson } from '../node/json.ts';
import { countIds, unnamedVariables, unnamedWarning } from '../node/variables.ts';
import { parseFilters, scanStoryFile, selectStories } from '../figma/story-scan.ts';
import { panelUrl, runningStorybook } from '../node/storybook-url.ts';
import { print } from '../node/output.ts';

type Options = {
    json: boolean;
    refresh: boolean;
    hostBrowser: boolean;
    open: boolean;
    ci: boolean;
    /** Git base of `--changed`; `true` without one: staged, unstaged and untracked files only. */
    changed: string | true | null;
    filters: string[];
};

function parseArgs(argv: string[]): Options | string {
    const options: Options = {
        json: false,
        refresh: false,
        hostBrowser: false,
        open: true,
        ci: false,
        changed: null,
        filters: [],
    };
    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index] ?? '';
        const next = argv[index + 1];
        if (arg === '--changed') {
            // The base is optional: a following argument that isn't an option is it, so filters go before the flag.
            if (next !== undefined && !next.startsWith('-')) {
                options.changed = next;
                index++;
            } else {
                options.changed = true;
            }
        } else if (arg.startsWith('--changed=')) {
            options.changed = arg.slice('--changed='.length) || true;
        } else if (arg === '--ci') {
            options.ci = true;
            options.open = false;
        } else if (arg === '--json') {
            options.json = true;
        } else if (arg === '--refresh') {
            options.refresh = true;
        } else if (arg === '--host-browser') {
            options.hostBrowser = true;
        } else if (arg === '--no-open') {
            options.open = false;
        } else if (arg.startsWith('-')) {
            return `unknown option ${arg}`;
        } else {
            options.filters.push(arg);
        }
    }

    return options;
}

type Timings = FigmaRunSummary['timings'];

async function timed<T>(timings: Timings, phase: RunPhase, work: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
        return await work();
    } finally {
        // A phase may run in steps (collect: open Vitest, then scan).
        timings[phase] = (timings[phase] ?? 0) + Math.round(performance.now() - start);
    }
}

/** This run's results for a story; null when the story wrote none. */
async function readResult(root: string, storyId: string): Promise<FigmaStoryResult | null> {
    return readJson<FigmaStoryResult>(path.join(root, resultsFile(storyId)));
}

function message(error: unknown): string {
    return (error as { message?: string })?.message ?? String(error);
}

/** What the run knows before any story ran; every exit path builds its summary from it. */
type RunState = { hostBrowser: boolean; files: string[]; warnings: string[]; timings: Timings };

function summaryOf(state: RunState, fields: Partial<FigmaRunSummary>): FigmaRunSummary {
    return {
        exitCode: 0,
        hostBrowser: state.hostBrowser,
        cells: noCells(),
        files: state.files,
        stories: [],
        errors: [],
        warnings: state.warnings,
        timings: state.timings,
        cellMs: null,
        panelUrl: null,
        ...fields,
    };
}

type Ran = { summary: FigmaRunSummary; results: FigmaStoryResult[] };

/**
 * Checks time per captured cell, over the stories that captured any: a story that errored before capturing, or whose
 * cells are all missing, measured no cell and would only inflate the figure.
 */
function perCell(results: FigmaStoryResult[]): number | null {
    let total = 0;
    let captured = 0;
    for (const result of results) {
        const counts = countCells(result.blocks);
        const cells = counts.pass + counts.fail + counts.approved;
        if (cells > 0) {
            total += result.checksMs;
            captured += cells;
        }
    }
    if (captured === 0) {
        return null;
    }

    return Math.round(total / captured);
}

function failedRun(state: RunState, error: string): Ran {
    return { summary: summaryOf(state, { exitCode: 2, errors: [error] }), results: [] };
}

async function summarize(
    root: string,
    state: RunState,
    modules: readonly TestModule[],
    unhandled: readonly unknown[]
): Promise<Ran> {
    const stories: FigmaStorySummary[] = [];
    const results: FigmaStoryResult[] = [];
    const errors = unhandled.map(message);
    const warnings = new Set<string>(state.warnings);
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
                failing: failingCells(result?.blocks ?? []),
            });
        }
    }
    // One line for the whole refs dir, whatever the stories bound: a warning, never a verdict.
    const { refsDir } = (await loadProjectConfig(root)).config;
    const unnamed = unnamedWarning(countIds(await unnamedVariables(root, refsDir)));
    if (unnamed) {
        warnings.add(unnamed);
    }
    const cells = countCells(
        results.flatMap((result) => {
            return result.blocks;
        })
    );
    const summary = summaryOf(state, {
        exitCode: runExitCode(stories, errors),
        cells,
        cellMs: perCell(results),
        stories,
        errors,
        warnings: [...warnings],
    });

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
    await writeSummary(root, written);

    return written;
}

async function writeSummary(root: string, summary: FigmaRunSummary) {
    await mkdir(path.join(root, RESULTS_DIR), { recursive: true });
    await writeFile(path.join(root, RUN_FILE), `${JSON.stringify(summary, null, 4)}\n`);
}

/** The panel opens on the first story that needs a look: an error or a fail, else the first story. */
async function findPanel(root: string, summary: FigmaRunSummary): Promise<string | null> {
    const stories = summary.stories.filter((story) => {
        return story.storyId !== null;
    });
    const story =
        stories.find((candidate) => {
            return candidate.verdict !== 'pass';
        }) ?? stories[0];
    if (!story?.storyId) {
        return null;
    }
    const base = await runningStorybook(root);

    return base ? panelUrl(base, story.storyId) : null;
}

function printHuman(summary: FigmaRunSummary): void {
    for (const story of summary.stories) {
        const { pass, fail, approved, missing } = story.cells;
        const counts = `${pass} pass, ${fail} fail, ${approved} approved, ${missing} missing`;
        const detail = story.error ? `error: ${story.error}` : counts;
        print(`${story.verdict.toUpperCase().padEnd(5)} ${story.title} › ${story.name}: ${detail}`);
        for (const cell of story.failing) {
            const triage = cell.triage ? ` [${cell.triage}]` : '';
            print(`      ✗ ${cell.block} · ${cell.variant}${triage}`);
            if (cell.approved) {
                // Deliberate? Paste into that block's `approved` and say why; a fix needs no entry.
                print(`        approved: ${cell.approved},`);
            } else {
                print('        not measured: fix the capture, no approval can cover it');
            }
        }
    }
    for (const error of summary.errors) {
        print(`ERROR ${error}`);
    }
    for (const warning of summary.warnings) {
        print(`WARN  ${warning}`);
    }
    const { pass, fail, approved, missing } = summary.cells;
    print(
        `\nfigma-qa report: ${pass} pass, ${fail} fail, ${approved} approved, ${missing} missing (exit ${summary.exitCode})`
    );
    const timings = Object.entries(summary.timings).map(([phase, ms]) => {
        return `${phase} ${(ms / 1000).toFixed(1)} s`;
    });
    if (summary.cellMs !== null) {
        timings.push(`per cell ${summary.cellMs} ms`);
    }
    print(`Timings: ${timings.join(', ')}`);
    print(`HTML report: ${REPORT_DIR}/index.html`);
    if (summary.panelUrl) {
        print(`Figma diff panel: ${summary.panelUrl}`);
    }
}

/** Opens the report with `$BROWSER` (`none` opens nothing), else the platform's opener. Fire and forget. */
function openFile(file: string): void {
    const browser = process.env.BROWSER;
    if (browser === 'none') {
        return;
    }
    const [command, args]: [string, string[]] = browser
        ? [browser, [file]]
        : process.platform === 'darwin'
          ? ['open', [file]]
          : process.platform === 'win32'
            ? ['cmd', ['/c', 'start', '""', file]]
            : ['xdg-open', [file]];
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {
        // A missing opener leaves the report where the summary says it is.
    });
    child.unref();
}

const NONE_AFFECTED = 'No Figma stories affected.';

/**
 * Why `--changed` can't diff here, or null. Checked before Vitest: Vitest 4 ignores git's exit code, so an unknown base
 * would read as "nothing changed" and pass.
 */
function changedBlocked(root: string, changed: string | true): Promise<string | null> {
    const args =
        changed === true
            ? ['rev-parse', '--show-toplevel']
            : ['rev-parse', '--verify', '--quiet', `${changed}^{commit}`];

    return new Promise((resolve) => {
        execFile('git', args, { cwd: root }, (error) => {
            if (!error) {
                resolve(null);
            } else {
                resolve(
                    changed === true
                        ? '--changed needs a git repository.'
                        : `--changed: ${changed} is not a commit in this repository (shallow clone? fetch it first).`
                );
            }
        });
    });
}

/**
 * Story files the change reaches through their imports (Vitest's `changed`). What reaches every story without being
 * imported (Storybook's config, the committed refs, the kit config) reruns them all, like Vitest's own config files.
 */
async function affectedSpecifications(root: string, vitest: Vitest) {
    const { refsDir } = (await loadProjectConfig(root)).config;
    vitest.config.forceRerunTriggers.push(
        path.join(root, '.storybook', '**'),
        path.join(root, refsDir, '**'),
        path.join(root, CONFIG_FILE)
    );

    return vitest.getRelevantTestSpecifications();
}

/** Runs the Figma Vitest project on the scanned story files and summarizes what they wrote. */
async function run(root: string, options: Options, state: RunState): Promise<Ran> {
    const noMatch = `No Figma story matches ${options.filters.join(' ')}.`;
    const blocked = await timed(state.timings, 'doctor', async () => {
        if (options.refresh && !figmaToken()) {
            return '--refresh fetches from Figma and needs FIGMA_TOKEN.';
        }
        if (options.changed) {
            const changed = await changedBlocked(root, options.changed);
            if (changed) {
                return changed;
            }
        }
        let refsDir: string;
        try {
            // Rejected before Vitest starts: a typo'd key must not run with defaults.
            refsDir = (await loadProjectConfig(root)).config.refsDir;
        } catch (error) {
            return message(error);
        }
        // Refs in another format would be misread: an upgrade that skipped `figma-qa migrate`, or a downgrade.
        const wrongFormat = await refsFormatBlocked({ root, refsDir });
        if (wrongFormat) {
            return wrongFormat;
        }

        // An unwired project fails before Vitest loads. The Vitest project check needs Vitest's config, so it waits
        // for collect.
        return addonBlocked(root);
    });
    if (blocked) {
        return failedRun(state, blocked);
    }
    // The browser commands and `figmaQa()` run in this process: they read these from here.
    if (options.refresh) {
        process.env[REFRESH_ENV] = '1';
    }
    // Set once collect found a story to run: a PR that reaches none never pulls the image.
    delete process.env[BROWSER_WS_ENV];

    // `--json` keeps stdout for the summary: Vitest's output and anything plugins log go to stderr.
    // Redirect the stream, not `console.log`: Storybook writes its first-run telemetry notice
    // straight to `process.stdout`.
    const writeStdout = process.stdout.write;
    if (options.json) {
        process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write;
    }
    try {
        // Filled by the reporter at the end of the run.
        const finished: { ran?: Promise<Ran> } = {};
        const opened = await timed(state.timings, 'collect', () => {
            return openFigmaProject(
                {
                    reporters: [
                        ...(options.json ? [] : ['default' as const]),
                        {
                            onTestRunEnd: (modules, unhandled) => {
                                finished.ran = summarize(root, state, modules, unhandled);
                            },
                        },
                    ],
                    // Vitest's own `changed`: git diff against the base, then each story file's import graph.
                    ...(options.changed ? { changed: options.changed } : {}),
                },
                { stdout: options.json ? process.stderr : process.stdout, stderr: process.stderr }
            );
        });
        if ('blocked' in opened) {
            return failedRun(state, opened.blocked);
        }
        const { vitest } = opened;
        try {
            const files = await timed(state.timings, 'collect', async () => {
                // Vitest's own include (addon-vitest's stories globs), narrowed to files that can hold a Figma story:
                // collecting a story file costs a transform and a browser import.
                const specifications = options.changed
                    ? await affectedSpecifications(root, vitest)
                    : await vitest.globTestSpecifications();
                const scanned = await Promise.all(
                    specifications.map(async (specification) => {
                        return scanStoryFile(specification.moduleId, await readFile(specification.moduleId, 'utf8'));
                    })
                );
                const selection = selectStories(scanned, parseFilters(options.filters));
                vitest.provide(STORIES_KEY, selection.ids);

                return selection.files.map((file) => {
                    return file.file;
                });
            });
            state.files = files.map((file) => {
                return path.relative(root, file);
            });
            if (files.length === 0 && options.changed) {
                return { summary: summaryOf(state, { warnings: [...state.warnings, NONE_AFFECTED] }), results: [] };
            }
            if (files.length === 0) {
                return options.filters.length > 0
                    ? failedRun(state, noMatch)
                    : { summary: summaryOf(state, { warnings: [...state.warnings, 'No Figma stories found.'] }), results: [] };
            }
            // `figmaQa()`'s provider reads the endpoint when it opens the browser, inside `start`.
            const browser = await timed(state.timings, 'browser', () => {
                return pickBrowser(root, { hostBrowser: options.hostBrowser });
            });
            if (browser.kind === 'image') {
                process.env[BROWSER_WS_ENV] = browser.wsEndpoint;
            } else {
                state.hostBrowser = true;
                state.warnings.push(`Host Chromium (${browser.reason}): pixels are not comparable to CI.`);
            }
            await timed(state.timings, 'tests', () => {
                return vitest.start(files);
            });
        } finally {
            await vitest.close();
        }
        const ran = (await finished.ran) ?? failedRun(state, 'Vitest did not run.');
        if (options.filters.length > 0 && ran.summary.stories.length === 0 && ran.summary.errors.length === 0) {
            return failedRun(state, noMatch);
        }

        return ran;
    } catch (error) {
        return failedRun(state, message(error));
    } finally {
        process.stdout.write = writeStdout;
    }
}

export async function report(argv: string[]): Promise<number> {
    const options = parseArgs(argv);
    if (typeof options === 'string') {
        console.error(`figma-qa report: ${options}`);

        return 2;
    }
    // Only a person at a terminal gets a browser tab: agents, scripts and CI read the summary.
    const interactive = process.stdout.isTTY && !process.env.CI;
    const root = process.cwd();
    // Only this run's output counts: stale results would mask a story that no longer writes any, and the panel would
    // show a run that a setup error replaced.
    await rm(path.join(root, RESULTS_DIR), { recursive: true, force: true });
    const state: RunState = { hostBrowser: false, files: [], warnings: [], timings: {} };
    const ran = await run(root, options, state);
    const summary = await timed(state.timings, 'report', async () => {
        const written = await writeRun(root, ran.summary, ran.results);
        // Probed once run.json exists: a running Storybook proves it serves this project by serving that file.
        const found = await findPanel(root, written);

        return { ...written, panelUrl: found };
    });
    // Again with the report phase timed and the panel found: run.json stays equal to the printed summary.
    await writeSummary(root, summary);

    if (options.ci) {
        await writeFile(path.join(root, CI_SUMMARY_FILE), ciSummary(summary, { changed: Boolean(options.changed) }));
    }
    if (options.json) {
        print(JSON.stringify(summary, null, 4));
    } else {
        printHuman(summary);
        if (options.ci) {
            print(`Markdown summary: ${CI_SUMMARY_FILE}`);
        }
    }
    if (options.open && interactive) {
        openFile(path.join(root, REPORT_DIR, 'index.html'));
    }

    return summary.exitCode;
}
