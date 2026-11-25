// Lazy Figma sync, through the real CLI against a stub of the Figma REST API serving recorded responses.
import type { FigmaStub } from './figma-stub.ts';
import type { Fixture } from './cli.ts';
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixtureDir, FIXTURES, HOST_WARNING, report, storyResult } from './cli.ts';
import { startFigmaStub } from './figma-stub.ts';

const REFS = 'figma-qa/__refs__';
const SET_DIR = `${REFS}/FIXTUREKIT-10-0`;
const NODES_CACHE = 'node_modules/.cache/figma-qa';

async function files(dir: string): Promise<Record<string, string>> {
    const names = (await readdir(dir)).sort();

    return Object.fromEntries(
        await Promise.all(
            names.map(async (name) => {
                return [name, (await readFile(path.join(dir, name))).toString('base64')] as const;
            })
        )
    );
}

async function manifestVersion(fixture: Fixture): Promise<string> {
    const manifest = JSON.parse(await readFile(path.join(fixtureDir(fixture), SET_DIR, 'manifest.json'), 'utf8'));

    return (manifest as { source: { version: string } }).source.version;
}

describe.each(FIXTURES)('figma sync in fixtures/%s', (fixture) => {
    const root = fixtureDir(fixture);
    let stub: FigmaStub;
    let backup: string;
    let token: Record<string, string>;

    // Syncs write the committed refs: each test starts from, and leaves, the committed state and no raw cache.
    beforeEach(async () => {
        backup = await mkdtemp(path.join(tmpdir(), 'figma-qa-refs-'));
        await cp(path.join(root, REFS), backup, { recursive: true });
        await rm(path.join(root, NODES_CACHE), { recursive: true, force: true });
        stub = await startFigmaStub('FIXTUREKIT');
        token = { FIGMA_TOKEN: 'stub-token', FIGMA_API_URL: stub.url };
    });

    afterEach(async () => {
        await stub.close();
        await rm(path.join(root, REFS), { recursive: true, force: true });
        await cp(backup, path.join(root, REFS), { recursive: true });
        await rm(backup, { recursive: true, force: true });
        await rm(path.join(root, NODES_CACHE), { recursive: true, force: true });
    });

    it('costs one /meta and no /nodes or /images when the Figma version is unchanged', async () => {
        const { code, stderr, summary } = await report(fixture, ['Swatch.figma'], token);

        expect(code, stderr).toBe(0);
        // Loader and checks both ask for the set: served from the run's memory the second time.
        expect(stub.routes()).toEqual(['meta']);
        expect(summary.warnings).toEqual([HOST_WARNING]);
    });

    it('warns, without failing or refetching, when Figma is newer than the synced refs', async () => {
        stub.version = '2';

        const { code, stderr, summary } = await report(fixture, ['Swatch.figma'], token);

        expect(code, stderr).toBe(0);
        expect(stub.routes()).toEqual(['meta']);
        expect(summary.warnings).toEqual([HOST_WARNING, expect.stringContaining('Figma changed since')]);
        expect(summary.warnings[1]).toContain('version 1 → 2');
        const result = await storyResult(fixture, summary.stories[0]?.results ?? null);
        expect([HOST_WARNING, ...result.warnings]).toEqual(summary.warnings);
    });

    it.each([401, 403])('exits 2 when Figma rejects the token (%i)', async (status) => {
        stub.fail = { status };

        const { code, stderr, summary } = await report(fixture, ['Swatch.figma'], token);

        expect(code, stderr).toBe(2);
        expect(summary.stories[0]?.error).toContain(`Figma rejected FIGMA_TOKEN (${status}`);
    });

    it('exits 2 on a 429 it needed, logging the rate-limit type', async () => {
        stub.fail = { status: 429, headers: { 'x-figma-rate-limit-type': 'low', 'retry-after': '86400' } };

        const { code, stderr, summary } = await report(fixture, ['Swatch.figma', '--refresh'], token);

        expect(code, stderr).toBe(2);
        expect(summary.stories[0]?.error).toContain('X-Figma-Rate-Limit-Type: low');
        expect(stderr).toContain('X-Figma-Rate-Limit-Type: low');
    });

    it('exits 2 for a set with no cached refs and no token', async () => {
        await rm(path.join(root, SET_DIR), { recursive: true });

        const { code, stderr, summary } = await report(fixture, ['Swatch.figma']);

        expect(code, stderr).toBe(2);
        expect(summary.stories[0]?.error).toContain('not cached; run with FIGMA_TOKEN');
    });

    it('syncs an uncached set once per run for every story that links it', async () => {
        const committed = await files(path.join(root, SET_DIR));
        const stamp = await readFile(path.join(root, REFS, 'format.json'), 'utf8');
        await rm(path.join(root, SET_DIR), { recursive: true });
        await rm(path.join(root, REFS, 'format.json'));

        // Swatch and SwatchDrift link the same set.
        const { code, stderr, summary } = await report(fixture, ['Swatch.figma', 'SwatchDrift.figma'], token);

        expect(code, stderr).toBe(1);
        expect(summary.stories).toHaveLength(2);
        expect(stub.routes().filter((route) => {
            return route !== 'png';
        })).toEqual(['meta', 'nodes', 'images']);
        expect(stub.routes().filter((route) => {
            return route === 'png';
        })).toHaveLength(6);
        const nodes = stub.requests.find((request) => {
            return request.route === 'nodes';
        })?.url;
        expect(nodes?.searchParams.get('ids')).toBe('10:0');
        expect(nodes?.searchParams.has('depth')).toBe(false);
        expect(nodes?.searchParams.has('geometry')).toBe(false);
        const images = stub.requests.find((request) => {
            return request.route === 'images';
        })?.url;
        expect(Object.fromEntries(images?.searchParams ?? [])).toMatchObject({
            ids: '10:1,10:2,10:3,10:4,10:5,10:6',
            format: 'png',
            scale: '2',
            use_absolute_bounds: 'true',
        });
        // The committed refs are exactly what a sync of the recordings writes, stamped with the kit's refs format.
        expect(await files(path.join(root, SET_DIR))).toEqual(committed);
        expect(await readFile(path.join(root, REFS, 'format.json'), 'utf8')).toBe(stamp);
    });

    it('--refresh adopts a new version, re-rendering images only when the set changed', async () => {
        // Unchanged version, no raw cache to rebuild from: nothing to adopt.
        let run = await report(fixture, ['Swatch.figma', '--refresh'], token);
        expect(run.code, run.stderr).toBe(0);
        expect(stub.routes()).toEqual(['meta']);

        // New file version, same set subtree: one /nodes, no /images.
        stub.version = '2';
        stub.requests = [];
        run = await report(fixture, ['Swatch.figma', '--refresh'], token);
        expect(run.code, run.stderr).toBe(0);
        expect(stub.routes()).toEqual(['meta', 'nodes']);
        expect(await manifestVersion(fixture)).toBe('2');
        expect(run.summary.warnings).toEqual([HOST_WARNING]);

        // Same version again: rebuilt offline from the raw /nodes JSON, so a hand-edited manifest is restored.
        const manifestFile = path.join(root, SET_DIR, 'manifest.json');
        const synced = await readFile(manifestFile, 'utf8');
        await writeFile(manifestFile, synced.replace('"name": "Swatch"', '"name": "Edited"'));
        stub.requests = [];
        run = await report(fixture, ['Swatch.figma', '--refresh'], token);
        expect(run.code, run.stderr).toBe(0);
        expect(stub.routes()).toEqual(['meta']);
        expect(await readFile(manifestFile, 'utf8')).toBe(synced);

        // The set itself changed: /nodes, then /images for its variants.
        stub.version = '3';
        const set = stub.nodes.nodes['10:0'] as { document: { name: string } };
        set.document.name = 'Swatch v3';
        stub.requests = [];
        run = await report(fixture, ['Swatch.figma', '--refresh'], token);
        expect(run.code, run.stderr).toBe(0);
        expect(stub.routes().filter((route) => {
            return route !== 'png';
        })).toEqual(['meta', 'nodes', 'images']);
        expect(await manifestVersion(fixture)).toBe('3');
    });

    it('--refresh without a token exits 2 before running', async () => {
        const { code, stderr, summary } = await report(fixture, ['Swatch.figma', '--refresh']);

        expect(code, stderr).toBe(2);
        expect(summary.errors).toEqual([expect.stringContaining('needs FIGMA_TOKEN')]);
        expect(summary.stories).toEqual([]);
    });
});
