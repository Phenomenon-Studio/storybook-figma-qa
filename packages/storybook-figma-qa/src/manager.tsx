/** @jsxRuntime classic */
// Classic JSX: Storybook 10's manager shares `react` as a global but not `react/jsx-runtime`, so the automatic
// runtime would bundle the project's own React copy into the panel and break it.
// "Figma diff" panel: the selected Figma story's last `figma-qa report` results, read from the dev route a running
// Storybook serves (node/vite-plugin.ts) and rendered with the same components as the HTML report.
import type { FigmaRunSummary, FigmaStoryResult } from './figma/types.ts';
import React from 'react';
import { QueryClient, useQuery } from '@tanstack/react-query';
import { addons, types, useStorybookState } from 'storybook/manager-api';
import { ADDON_ID, DEV_ROUTE, PANEL_ID, PANEL_TITLE } from './constants.ts';
import { FIGMA_TAG, resultsFile, RUN_FILE } from './figma/types.ts';
import { PanelView } from './ui/panel-view.tsx';
import { FIGMA_QA_CSS } from './ui/theme.ts';

/**
 * The one QueryClient of the panel, passed to each query instead of through a provider (the provider would render
 * through `react/jsx-runtime`). Results change only when a report runs, so they stay fresh until Reload.
 */
const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false } },
});

const KEYS = {
    all: ['figma-qa'] as const,
    run: () => {
        return [...KEYS.all, 'run'] as const;
    },
    story: (storyId: string) => {
        return [...KEYS.all, 'story', storyId] as const;
    },
};

/** `cacheKey` changes with each fetch of the results, so the browser doesn't show a previous run's images. */
function fileUrl(projectPath: string, cacheKey: number): string {
    return `${DEV_ROUTE}/files/${encodeURI(projectPath)}?v=${cacheKey}`;
}

/** A results or refs file; null when there is none, or no dev route (a static build). */
async function readProjectFile<T>(projectPath: string, signal: AbortSignal): Promise<T | null> {
    const response = await fetch(fileUrl(projectPath, Date.now()), { signal });
    const json = response.headers.get('content-type')?.includes('application/json');

    return response.ok && json ? ((await response.json()) as T) : null;
}

function FigmaDiffPanel() {
    const { storyId, index } = useStorybookState();
    const figmaStory = index?.[storyId]?.tags?.includes(FIGMA_TAG) ?? false;
    const story = useQuery(
        {
            queryKey: KEYS.story(storyId),
            queryFn: ({ signal }) => {
                return readProjectFile<FigmaStoryResult>(resultsFile(storyId), signal).catch(() => {
                    return null;
                });
            },
            enabled: figmaStory,
        },
        queryClient
    );
    const run = useQuery(
        {
            queryKey: KEYS.run(),
            queryFn: ({ signal }) => {
                return readProjectFile<FigmaRunSummary>(RUN_FILE, signal).catch(() => {
                    return null;
                });
            },
            enabled: figmaStory,
        },
        queryClient
    );
    // Images are cached by the browser: their URLs change with each fetch of the results.
    const version = story.dataUpdatedAt;

    return (
        <PanelView
            storyId={storyId}
            figmaStory={figmaStory}
            result={story.data}
            run={run.data}
            fileUrl={(file) => {
                return fileUrl(file, version);
            }}
            reloading={story.isFetching || run.isFetching}
            onReload={() => {
                void queryClient.invalidateQueries({ queryKey: KEYS.all });
            }}
        />
    );
}

addons.register(ADDON_ID, () => {
    addons.add(PANEL_ID, {
        type: types.PANEL,
        title: PANEL_TITLE,
        render: ({ active }) => {
            if (!active) {
                return null;
            }

            return (
                <div style={{ height: '100%', overflow: 'auto' }}>
                    <style>{FIGMA_QA_CSS}</style>
                    <FigmaDiffPanel />
                </div>
            );
        },
    });
});
