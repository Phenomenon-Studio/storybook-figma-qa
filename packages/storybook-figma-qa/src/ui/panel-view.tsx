/** @jsxRuntime classic */
// Classic JSX: Storybook 10's manager shares `react` but not `react/jsx-runtime`.
// What the "Figma diff" panel shows for the selected story, from data the panel fetched. No manager APIs here, so
// stories can render it with fixed results.
import type { FigmaRunSummary, FigmaStoryResult } from '../figma/types.ts';
import type { FileUrl } from './results.tsx';
import React from 'react';
import { RunNotices, StorySection } from './results.tsx';

export type PanelViewProps = {
    storyId: string;
    figmaStory: boolean;
    /** undefined while loading; null when the story has no results (no run yet, or no dev server). */
    result: FigmaStoryResult | null | undefined;
    /** The last run's summary, for run-wide notices; null when there is none. */
    run: FigmaRunSummary | null | undefined;
    fileUrl: FileUrl;
    reloading: boolean;
    onReload: () => void;
};

function Message({ children }: { children: React.ReactNode }) {
    return <p className="fqa-muted">{children}</p>;
}

export function PanelView({ storyId, figmaStory, result, run, fileUrl, reloading, onReload }: PanelViewProps) {
    // A story that wrote no results (it failed to render) is in the run summary only, with why.
    const summary = run?.stories.find((story) => {
        return story.storyId === storyId;
    });
    let body: React.ReactNode;
    if (!figmaStory) {
        body = (
            <Message>
                Not a Figma story. Tag a story <code>figma</code> and link its component sets in{' '}
                <code>parameters.design</code> to check it against Figma.
            </Message>
        );
    } else if (result === undefined) {
        body = <Message>Loading Figma results…</Message>;
    } else if (result === null && summary?.error) {
        body = (
            <StorySection
                storyId={storyId}
                title={summary.title}
                name={summary.name}
                error={summary.error}
                blocks={[]}
                warnings={[]}
                fileUrl={fileUrl}
            />
        );
    } else if (result === null) {
        body = (
            <Message>
                No Figma results for this story yet. Run <code>figma-qa report</code>, then reload.
            </Message>
        );
    } else {
        body = (
            <>
                {run && <RunNotices hostBrowser={run.hostBrowser} errors={[]} />}
                <StorySection
                    storyId={result.storyId}
                    title={result.title}
                    name={result.name}
                    error={result.error}
                    blocks={result.blocks}
                    warnings={result.warnings}
                    fileUrl={fileUrl}
                />
            </>
        );
    }

    return (
        <div className="fqa fqa-panel">
            {figmaStory && (
                <div className="fqa-panel__bar">
                    <span className="fqa-muted">{result ? `Ran ${new Date(result.ranAt).toLocaleString()}` : ''}</span>
                    <button type="button" className="fqa-btn" disabled={reloading} aria-busy={reloading} onClick={onReload}>
                        {reloading ? 'Reloading…' : 'Reload results'}
                    </button>
                </div>
            )}
            {body}
        </div>
    );
}
