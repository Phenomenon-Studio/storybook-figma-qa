/** @jsxRuntime classic */
// Classic JSX like the rest of `ui/`: the components are shared with the manager panel.
// The HTML report: the run summary, then every story with the same section the panel shows. Rendered to static
// markup in Node (node/html-report.ts); needs no script, so it opens from disk and from a CI artifact.
import type { FigmaRunSummary, FigmaStoryResult } from '../figma/types.ts';
import type { FileUrl } from './results.tsx';
import React from 'react';
import { Counts, RunNotices, StorySection } from './results.tsx';
import { RUN_PHASES } from '../figma/types.ts';
import { FIGMA_QA_CSS } from './theme.ts';

const OUTCOME: Record<FigmaRunSummary['exitCode'], string> = {
    0: 'Every cell matches Figma, is approved or has no code equivalent.',
    1: 'Some cells differ from Figma.',
    2: 'A harness or setup error stopped some checks: those are not design verdicts.',
};

/** Where the run's time went, phase by phase. The report phase is still running while this renders. */
function Timings({ timings, cellMs }: Pick<FigmaRunSummary, 'timings' | 'cellMs'>) {
    const phases = RUN_PHASES.filter((phase) => {
        return timings[phase] !== undefined;
    });
    if (phases.length === 0) {
        return null;
    }

    return (
        <ul className="fqa-counts" aria-label="Timings">
            {phases.map((phase) => {
                return (
                    <li key={phase} data-phase={phase}>
                        {phase} <b>{((timings[phase] ?? 0) / 1000).toFixed(1)} s</b>
                    </li>
                );
            })}
            {cellMs === null ? null : (
                <li data-phase="cell">
                    per cell <b>{cellMs} ms</b>
                </li>
            )}
        </ul>
    );
}

export type ReportPageProps = { run: FigmaRunSummary; results: FigmaStoryResult[]; fileUrl: FileUrl };

export function ReportBody({ run, results, fileUrl }: ReportPageProps) {
    return (
        <main className="fqa-page">
            <header>
                <h1>Figma report</h1>
                <p>{OUTCOME[run.exitCode]}</p>
                <Counts cells={run.cells} />
                <Timings timings={run.timings} cellMs={run.cellMs} />
                <RunNotices hostBrowser={run.hostBrowser} errors={run.errors} />
            </header>
            {run.stories.map((story) => {
                const result = results.find((candidate) => {
                    return candidate.storyId === story.storyId;
                });

                return (
                    <StorySection
                        key={story.storyId ?? `${story.file}·${story.name}`}
                        storyId={story.storyId}
                        title={story.title}
                        name={story.name}
                        error={story.error}
                        blocks={result?.blocks ?? []}
                        warnings={result?.warnings ?? []}
                        fileUrl={fileUrl}
                    />
                );
            })}
        </main>
    );
}

/** The whole document; `renderToStaticMarkup` it and prefix `<!doctype html>`. */
export function ReportPage(props: ReportPageProps) {
    return (
        <html lang="en">
            <head>
                <meta charSet="utf-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <title>Figma report</title>
                <style dangerouslySetInnerHTML={{ __html: FIGMA_QA_CSS }} />
            </head>
            <body className="fqa" style={{ margin: 0, minHeight: '100vh' }}>
                <ReportBody {...props} />
            </body>
        </html>
    );
}
