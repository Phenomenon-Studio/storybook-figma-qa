// Opens Vitest on the kit's Figma project, the way `report` runs it. A project that `init` hasn't wired (no kit addon
// in `.storybook/main`, no `figmaQa()` in `test.projects`) is a blocked setup: exit 2 pointing at `figma-qa init`,
// never a run with half the kit.
import type { Writable } from 'node:stream';
import type { TestUserConfig, Vitest } from 'vitest/node';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { FIGMA_PROJECT, PACKAGE_NAME } from '../constants.ts';

export type OpenedProject = { vitest: Vitest } | { blocked: string };

type Streams = { stdout: Writable; stderr: Writable };

export const MAIN_FILES = ['main.ts', 'main.mts', 'main.cts', 'main.js', 'main.mjs', 'main.cjs'];

/**
 * Whether `.storybook/main` names the kit: read as text, since loading it needs Storybook's internal presets. `init`
 * writes the package name into `addons`; the preset it loads serves the preview's virtual modules, so without it
 * every Figma story fails to load.
 */
export async function addonBlocked(root: string): Promise<string | null> {
    for (const name of MAIN_FILES) {
        const source = await readFile(path.join(root, '.storybook', name), 'utf8').catch(() => {
            return null;
        });
        if (source !== null) {
            return source.includes(PACKAGE_NAME)
                ? null
                : `.storybook/${name} does not add ${PACKAGE_NAME} to addons: run \`figma-qa init\`.`;
        }
    }

    return 'No .storybook/main: run `figma-qa init`.';
}

/** Call after `addonBlocked`: this checks only the Vitest side. */
export async function openFigmaProject(
    options: TestUserConfig,
    streams: Streams
): Promise<OpenedProject> {
    // As `startVitest` does before `createVitest`: addon-vitest only adds the stories include under Vitest.
    process.env.TEST = 'true';
    process.env.VITEST = 'true';
    process.env.NODE_ENV ??= 'test';
    const { createVitest } = await import('vitest/node');
    let vitest: Vitest;
    try {
        vitest = await createVitest('test', { ...options, watch: false, project: [FIGMA_PROJECT] }, {}, streams);
    } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        if (/No projects (matched|were found)/.test(text)) {
            return {
                blocked: `No "${FIGMA_PROJECT}" Vitest project (figmaQa() in test.projects): run \`figma-qa init\`.`,
            };
        }
        throw error;
    }

    return { vitest };
}
