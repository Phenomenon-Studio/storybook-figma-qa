// Node side of `figma-qa.config.ts`: loaded through Vite, so the TypeScript file and its imports load the way the
// preview loads them. One load per project root per process: the CLI, the Vitest browser commands and the Storybook
// preset of one run share it.
import type { ResolvedConfig } from '../config.ts';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { CONFIG_FILE, FigmaQaConfigError, resolveConfig } from '../config.ts';

export type ProjectConfig = {
    /** Absolute path of the config file; null when the project has none and every default applies. */
    file: string | null;
    config: ResolvedConfig;
};

const loads = new Map<string, Promise<ProjectConfig>>();

async function load(root: string): Promise<ProjectConfig> {
    const file = path.join(root, CONFIG_FILE);
    if (!existsSync(file)) {
        return { file: null, config: resolveConfig(undefined) };
    }
    const { loadConfigFromFile } = await import('vite');
    let raw: unknown;
    try {
        // `command`/`mode` only matter to function exports, which the config doesn't take.
        const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, file, root, 'silent');
        raw = loaded?.config;
    } catch (error) {
        throw new FigmaQaConfigError(`${CONFIG_FILE}: failed to load: ${(error as Error).message}`);
    }

    return { file, config: resolveConfig(raw) };
}

/** The project's config, validated. Rejects with FigmaQaConfigError. */
export function loadProjectConfig(root: string): Promise<ProjectConfig> {
    let loaded = loads.get(root);
    if (!loaded) {
        loaded = load(root);
        loads.set(root, loaded);
    }

    return loaded;
}
