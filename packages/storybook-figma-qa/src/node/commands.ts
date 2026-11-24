// Vitest browser commands: the Node side of the Figma checks. Refs are synced lazily into the refs dir, pixels are
// diffed here (one screenshot per cell crosses the channel), and results are written per story.
import type { BrowserCommand } from 'vitest/node';
import type { Box, FigmaSetManifest, FigmaStoryResult } from '../figma/types.ts';
import type { FigmaVariableCatalog } from '../figma/variables.ts';
import type { LoadedSets } from '../figma/story.ts';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { refPng, RESULTS_DIR, resultsFile, variantSlug } from '../figma/types.ts';
import { loadProjectConfig } from './config.ts';
import { readJson } from './json.ts';
import { pixelDiff } from './pixel-diff.ts';
import { FigmaSync } from './sync.ts';

/** One sync state per Vitest run: every story of the run shares its `/meta` calls and coalesced batches. */
const syncs = new WeakMap<object, FigmaSync>();

/**
 * Manifests for a story's set URLs, synced lazily (sync.ts), plus the variable names. Called by the preview loader
 * and again by the checks; the second call is served from the run's memory.
 */
export const figmaEnsureSets: BrowserCommand<[urls: string[]]> = async ({ project }, urls): Promise<LoadedSets> => {
    const root = project.config.root;
    const { refsDir } = (await loadProjectConfig(root)).config;
    let sync = syncs.get(project.vitest);
    if (!sync) {
        sync = new FigmaSync({ root, refsDir });
        syncs.set(project.vitest, sync);
    }
    const synced = await Promise.all(
        urls.map((url) => {
            return sync.ensure(url);
        })
    );
    const manifests: Record<string, FigmaSetManifest> = {};
    const warnings = new Set<string>();
    urls.forEach((url, index) => {
        const set = synced[index];
        if (set) {
            manifests[url] = set.manifest;
            if (set.warning) {
                warnings.add(set.warning);
            }
        }
    });
    const catalog = await readJson<FigmaVariableCatalog>(path.join(root, refsDir, 'variables.json'));

    return { manifests, variables: catalog?.variables ?? {}, warnings: [...warnings] };
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
    const { refsDir } = (await loadProjectConfig(root)).config;
    const variant = variantSlug(request.variantId);
    const figma = refPng(refsDir, path.basename(request.slug), request.variantId);
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
