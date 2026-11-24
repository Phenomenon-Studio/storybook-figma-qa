import type { LoadSets } from './figma/story.ts';
import { definePreviewAddon } from 'storybook/internal/csf';
import { COMPARE_GLOBAL } from './constants.ts';
import { LOAD_SETS_HOOK, resolveStory } from './figma/story.ts';
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

/**
 * Binds a Figma story's matrix blocks to their synced sets, under `loaded.figmaQa`. Refs come from Node through the
 * hook the Vitest setup installs; outside a run there is no hook and the matrix says so. A misconfigured story loads
 * its error instead of throwing, so the run records it per story.
 */
async function loadFigma({ tags, parameters }: { tags: string[]; parameters: Record<string, unknown> }) {
    const loadSets = (globalThis as { [LOAD_SETS_HOOK]?: LoadSets })[LOAD_SETS_HOOK];
    if (!tags.includes(FIGMA_TAG) || !loadSets) {
        return {};
    }
    try {
        return { figmaQa: await resolveStory(parameters, loadSets) };
    } catch (error) {
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
