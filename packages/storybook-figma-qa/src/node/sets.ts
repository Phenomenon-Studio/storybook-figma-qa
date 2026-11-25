// What a story's set URLs load: the synced manifests plus the variable names. Served to the Vitest run by the
// `figmaEnsureSets` browser command and to a running Storybook by the dev route, so the matrix renders the same cells
// in both.
import type { FigmaSetManifest } from '../figma/types.ts';
import type { FigmaVariableCatalog } from '../figma/variables.ts';
import type { LoadedSets } from '../figma/story.ts';
import type { FigmaSync } from './sync.ts';
import path from 'node:path';
import { readJson } from './json.ts';

export async function loadSets(
    root: string,
    refsDir: string,
    sync: FigmaSync,
    urls: readonly string[]
): Promise<LoadedSets> {
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
            if (!set.manifest.annotations) {
                warnings.add(
                    `Designer notes of ${url} are not synced: run \`figma-qa report --refresh\` to read them.`
                );
            }
        }
    });
    const catalog = await readJson<FigmaVariableCatalog>(path.join(root, refsDir, 'variables.json'));

    return { manifests, variables: catalog?.variables ?? {}, warnings: [...warnings] };
}
