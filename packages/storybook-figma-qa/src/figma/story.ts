// How a Figma story names its component sets: named `figma` entries in `parameters.design`, and matrix blocks that
// reference one by name. Shared by the preview loader, the matrix and the Vitest checks, so they can't disagree.
// Browser-safe: no Node imports.
import type { FigmaVariable } from './variables.ts';
import type { DesignEntry, FigmaMatrixBlock, FigmaMatrixParameter, FigmaSetManifest } from './types.ts';
import { figmaSlug, parseFigmaUrl } from './types.ts';

/** What the Node side serves for a story's set URLs (`figmaEnsureSets`). */
export type LoadedSets = {
    /** Keyed by set URL. */
    manifests: Record<string, FigmaSetManifest>;
    variables: Record<string, FigmaVariable>;
};

/** A matrix block bound to its design entry and synced set. */
export type ResolvedBlock = {
    name: string;
    url: string;
    slug: string;
    block: FigmaMatrixBlock;
    manifest: FigmaSetManifest;
};

export type ResolvedStory = { blocks: ResolvedBlock[]; variables: Record<string, FigmaVariable> };

/** What the preview loader hands the story under `loaded.figmaQa`. */
export type LoadedFigma = ResolvedStory | { error: string };

/** The setup file installs this so the preview loader can ask Node for refs without importing Vitest. */
export const LOAD_SETS_HOOK = '__figmaQaLoadSets';

export type LoadSets = (urls: string[]) => Promise<LoadedSets>;

/** A story set up wrongly: a harness error (exit 2), never a design verdict. */
export class FigmaStoryError extends Error {
    override name = 'FigmaStoryError';
}

export type StoryParameters = { design?: unknown; figmaMatrix?: FigmaMatrixParameter };

/** Named `figma` entries of `parameters.design` (one object or an array of them). */
export function figmaEntries(design: unknown): (DesignEntry & { name: string })[] {
    const entries = (Array.isArray(design) ? design : [design]) as Partial<DesignEntry>[];

    return entries.filter((entry): entry is DesignEntry & { name: string } => {
        return entry?.type === 'figma' && typeof entry.url === 'string' && typeof entry.name === 'string';
    });
}

/** Each matrix block with its design entry. Throws FigmaStoryError when the story is half-configured. */
export function storyBlocks(
    parameters: StoryParameters
): { block: FigmaMatrixBlock; entry: DesignEntry & { name: string } }[] {
    const entries = figmaEntries(parameters.design);
    if (entries.length === 0) {
        throw new FigmaStoryError(
            'Story is tagged `figma` but `parameters.design` has no named `figma` entry ({ name, type: "figma", url }).'
        );
    }
    const blocks = parameters.figmaMatrix?.blocks;
    if (!blocks?.length) {
        throw new FigmaStoryError('Story is tagged `figma` but has no `parameters.figmaMatrix.blocks`.');
    }

    return blocks.map((block) => {
        const entry =
            block.name === undefined && entries.length === 1
                ? entries[0]
                : entries.find((candidate) => {
                      return candidate.name === block.name;
                  });
        if (!entry) {
            const names = entries
                .map((candidate) => {
                    return candidate.name;
                })
                .join(', ');
            throw new FigmaStoryError(
                block.name === undefined
                    ? `A matrix block has no \`name\` and the story has several figma design entries (${names}).`
                    : `Matrix block "${block.name}" names no figma design entry (has: ${names}).`
            );
        }

        return { block, entry };
    });
}

/** Story blocks bound to the manifests Node served for them. */
export async function resolveStory(parameters: StoryParameters, loadSets: LoadSets): Promise<ResolvedStory> {
    const bound = storyBlocks(parameters);
    const loaded = await loadSets(
        bound.map(({ entry }) => {
            return entry.url;
        })
    );
    const blocks = bound.map(({ block, entry }) => {
        const { fileKey, nodeId } = parseFigmaUrl(entry.url);
        const manifest = loaded.manifests[entry.url];
        if (!manifest) {
            throw new FigmaStoryError(`No refs served for ${entry.url}.`);
        }

        return { name: entry.name, url: entry.url, slug: figmaSlug(fileKey, nodeId), block, manifest };
    });

    return { blocks, variables: loaded.variables };
}
