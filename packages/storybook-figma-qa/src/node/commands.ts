// Vitest browser commands: the Node side of the Figma checks. Refs are read from the committed refs dir, pixels are
// diffed here (one screenshot per cell crosses the channel), and results are written per story.
import type { BrowserCommand } from 'vitest/node';
import type { Box, FigmaSetManifest, FigmaStoryResult } from '../figma/types.ts';
import type { FigmaVariableCatalog } from '../figma/variables.ts';
import type { LoadedSets } from '../figma/story.ts';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { figmaSlug, parseFigmaUrl, REFS_DIR, refPng, RESULTS_DIR, resultsFile, variantSlug } from '../figma/types.ts';
import { pixelDiff } from './pixel-diff.ts';

/** Parsed JSON, or null when the file doesn't exist. Any other read or parse error is thrown. */
export async function readJson<T>(file: string): Promise<T | null> {
    try {
        return JSON.parse(await readFile(file, 'utf8')) as T;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

/** Manifests for a story's set URLs, plus the variable names. A set with no cached refs is a setup error. */
export const figmaEnsureSets: BrowserCommand<[urls: string[]]> = async ({ project }, urls): Promise<LoadedSets> => {
    const refs = path.join(project.config.root, REFS_DIR);
    const manifests: Record<string, FigmaSetManifest> = {};
    for (const url of urls) {
        const { fileKey, nodeId } = parseFigmaUrl(url);
        const manifest = await readJson<FigmaSetManifest>(path.join(refs, figmaSlug(fileKey, nodeId), 'manifest.json'));
        if (!manifest) {
            throw new Error(`Figma set ${url} not cached in ${REFS_DIR}; run with a Figma token to sync it.`);
        }
        manifests[url] = manifest;
    }
    const catalog = await readJson<FigmaVariableCatalog>(path.join(refs, 'variables.json'));

    return { manifests, variables: catalog?.variables ?? {} };
};

export type PixelDiffRequest = {
    storyId: string;
    /** Refs dir name of the set. */
    slug: string;
    variantId: string;
    /** The page ground, as computed: Figma's transparent export is flattened onto it. */
    backdrop: string;
    /** Text boxes, CSS px relative to the cell. */
    masks: Box[];
    /** Base64 PNG of the framed cell. */
    screenshot: string;
};

export type PixelDiffResponse = {
    pixels: number | null;
    masked: number;
    error: string | null;
    files: { figma: string; actual: string; diff: string | null };
};

export const figmaPixelDiff: BrowserCommand<[request: PixelDiffRequest]> = async (
    { project },
    request
): Promise<PixelDiffResponse> => {
    const root = project.config.root;
    const variant = variantSlug(request.variantId);
    const figma = refPng(path.basename(request.slug), request.variantId);
    const cell = `${RESULTS_DIR}/${path.basename(request.storyId)}-${variant}`;
    const actual = `${cell}-actual.png`;
    const screenshot = Buffer.from(request.screenshot, 'base64');
    const result = pixelDiff(await readFile(path.join(root, figma)), screenshot, request.backdrop, request.masks);
    await mkdir(path.join(root, RESULTS_DIR), { recursive: true });
    await writeFile(path.join(root, actual), screenshot);
    const diff = result.diff ? `${cell}-diff.png` : null;
    if (diff && result.diff) {
        await writeFile(path.join(root, diff), result.diff);
    }

    return { pixels: result.pixels, masked: result.masked, error: result.error, files: { figma, actual, diff } };
};

export const figmaSaveStoryResult: BrowserCommand<[result: FigmaStoryResult]> = async ({ project }, result) => {
    const file = path.join(project.config.root, resultsFile(path.basename(result.storyId)));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(result, null, 4)}\n`);
};
