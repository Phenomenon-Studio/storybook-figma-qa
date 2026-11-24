import type { LoadedSets, LoadSets, SkipUnselected } from './figma/story.ts';
import { definePreviewAddon } from 'storybook/internal/csf';
import { COMPARE_GLOBAL, DEV_ROUTE } from './constants.ts';
import { LOAD_SETS_HOOK, resolveStory, SKIP_HOOK } from './figma/story.ts';
import { FIGMA_TAG } from './figma/types.ts';

export { FigmaIcon } from './icon.tsx';
export type { FigmaIconProps } from './icon.tsx';
export { FigmaMatrix } from './matrix.tsx';
export type { FigmaMatrixProps, RenderCell } from './matrix.tsx';
export type {
    DesignEntry,
    FigmaApproval,
    FigmaIgnore,
    FigmaMatrixBlock,
    FigmaMatrixLayout,
    FigmaMatrixParameter,
    FigmaVariant,
} from './figma/types.ts';

/** No dev route to ask: a static Storybook build. The matrix says where refs load instead. */
class NoDevRoute extends Error {}

/** In a running Storybook, refs come from the dev route (node/vite-plugin.ts), as Node serves them to a run. */
const devLoadSets: LoadSets = async (urls) => {
    const response = await fetch(`${DEV_ROUTE}/sets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(urls),
    }).catch(() => {
        return null;
    });
    if (!response || response.status === 404) {
        throw new NoDevRoute();
    }
    if (!response.ok) {
        throw new Error(await response.text());
    }

    return response.json() as Promise<LoadedSets>;
};

/**
 * Binds a Figma story's matrix blocks to their synced sets, under `loaded.figmaQa`. In a run, refs come from Node
 * through the hook the Vitest setup installs; in a running Storybook, from the dev route. A misconfigured story
 * loads its error instead of throwing, so the run records it per story.
 */
async function loadFigma({ id, tags, parameters }: { id: string; tags: string[]; parameters: Record<string, unknown> }) {
    if (!tags.includes(FIGMA_TAG)) {
        return {};
    }
    (globalThis as { [SKIP_HOOK]?: SkipUnselected })[SKIP_HOOK]?.(id);
    const loadSets = (globalThis as { [LOAD_SETS_HOOK]?: LoadSets })[LOAD_SETS_HOOK] ?? devLoadSets;
    try {
        return { figmaQa: await resolveStory(parameters, loadSets) };
    } catch (error) {
        if (error instanceof NoDevRoute) {
            return {};
        }

        return { figmaQa: { error: error instanceof Error ? error.message : String(error) } };
    }
}

/** CSF Next preview addon: `definePreview({ addons: [figmaQa()] })`. */
export default function figmaQa() {
    return definePreviewAddon({
        // Storybook drops undeclared globals, so the panel can only set the compare mode once it's declared.
        initialGlobals: { [COMPARE_GLOBAL]: 'off' },
        loaders: [loadFigma],
    });
}
