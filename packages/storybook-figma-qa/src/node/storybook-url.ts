// Where a running `storybook dev` of this project serves, so `figma-qa report` can print the "Figma diff" panel URL.
// The preset records it when Storybook's dev server starts; the report trusts it only while that process lives and
// its dev route answers for this project.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEV_ROUTE, PANEL_ID } from '../constants.ts';
import { RUN_FILE } from '../figma/types.ts';

const MARKER = 'node_modules/.cache/figma-qa/storybook.json';

type Marker = { url: string; pid: number };

export async function recordStorybook(root: string, url: string): Promise<void> {
    const file = path.join(root, MARKER);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify({ url, pid: process.pid } satisfies Marker)}\n`);
}

function alive(pid: number): boolean {
    try {
        process.kill(pid, 0);

        return true;
    } catch (error) {
        // EPERM: alive, owned by someone else.
        return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
}

/** The running Storybook's base URL (with a trailing slash), or null when none serves this project. */
export async function runningStorybook(root: string): Promise<string | null> {
    let marker: Marker;
    try {
        marker = JSON.parse(await readFile(path.join(root, MARKER), 'utf8')) as Marker;
    } catch {
        return null;
    }
    if (!alive(marker.pid)) {
        return null;
    }
    const base = marker.url.endsWith('/') ? marker.url : `${marker.url}/`;
    try {
        // The run file only this project's dev route serves: a reused port can't pass for it.
        const response = await fetch(new URL(`${DEV_ROUTE.slice(1)}/files/${RUN_FILE}`, base), {
            signal: AbortSignal.timeout(2000),
        });
        await response.body?.cancel();

        return response.ok ? base : null;
    } catch {
        return null;
    }
}

export function panelUrl(base: string, storyId: string): string {
    return `${base}?path=/story/${storyId}&addonPanel=${encodeURIComponent(PANEL_ID)}`;
}
