// Designer notes (Dev Mode annotations) travel with the refs: synced from the stub's recorded `/nodes`, attached to
// their cell or block, counted in the human output, and never part of a verdict.
import type { FigmaStub } from './figma-stub.ts';
import type { Annotation } from './cli.ts';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixtureDir, FIXTURES, HOST_WARNING, report, runCli, storyResult } from './cli.ts';
import { startFigmaStub } from './figma-stub.ts';

const REFS = 'figma-qa/__refs__';
const MANIFEST = `${REFS}/FIXTUREKIT-20-0/manifest.json`;
const NODES_CACHE = 'node_modules/.cache/figma-qa';

type Node = { id: string; annotations?: { label: string }[]; children?: Node[] };

/** What the recordings pin (scripts/fixture-refs.mjs): one note on the set, one on Circle's icon sublayer. */
const SET_NOTE: Annotation = {
    nodeId: '20:0',
    path: [],
    variant: null,
    label: 'Icons come from the Icons library.\nNever recolour them in code.',
};
const SHAPE_NOTE: Annotation = {
    nodeId: 'I20:2;30:2;31:1',
    path: ['Icon=Circle', 'Circle', 'Shape'],
    variant: '20:2',
    label: 'Corner radius follows the icon size.',
};

function findNode(node: Node, id: string): Node | null {
    if (node.id === id) {
        return node;
    }
    for (const child of node.children ?? []) {
        const found = findNode(child, id);
        if (found) {
            return found;
        }
    }

    return null;
}

describe.each(FIXTURES)('designer notes in fixtures/%s', (fixture) => {
    const root = fixtureDir(fixture);
    let stub: FigmaStub;
    let backup: string;
    let token: Record<string, string>;

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

    it('syncs a note-only edit without /images and puts each note on its cell or block', async () => {
        const committed = JSON.parse(await readFile(path.join(root, MANIFEST), 'utf8')) as { annotations: Annotation[] };
        expect(committed.annotations).toEqual([SET_NOTE, SHAPE_NOTE]);

        // The designer rewords one note: a new file version, the same images.
        const set = (stub.nodes.nodes['20:0'] as { document: Node }).document;
        const shape = findNode(set, SHAPE_NOTE.nodeId);
        const edited = 'Corner radius follows the icon size.\nRound it to whole pixels.';
        shape!.annotations = [{ label: edited }];
        stub.version = '2';

        const { code, stderr, summary } = await report(fixture, ['Glyph.figma', '--refresh'], token);

        // Glyph fails with the default `icons` glob (Glyph.figma.stories.tsx): a design verdict, notes aside.
        expect(code, stderr).toBe(1);
        expect(stub.routes()).toEqual(['meta', 'nodes']);
        expect(summary.warnings).toEqual([HOST_WARNING]);
        const shapeNote = { ...SHAPE_NOTE, label: edited };
        const manifest = JSON.parse(await readFile(path.join(root, MANIFEST), 'utf8')) as { annotations: Annotation[] };
        expect(manifest.annotations).toEqual([SET_NOTE, shapeNote]);

        const story = summary.stories[0]!;
        // Listed by block and variant name, as the human output names cells.
        const { variant: _set, ...setListed } = SET_NOTE;
        const { variant: _shape, ...shapeListed } = shapeNote;
        expect(story.annotations).toEqual([
            { ...setListed, block: 'glyph', variant: null },
            { ...shapeListed, block: 'glyph', variant: 'Icon=Circle' },
        ]);
        const result = await storyResult(fixture, story.results);
        const [block] = result.blocks;
        expect(block?.annotations).toEqual([SET_NOTE]);
        expect(
            block?.cells.map((cell) => {
                return [cell.variant.name, cell.annotations];
            })
        ).toEqual([
            ['Icon=Square', []],
            ['Icon=Circle', [shapeNote]],
        ]);

        // Same version again, the notes dropped from the manifest: rebuilt from the kept raw `/nodes` JSON, with no
        // Figma call but /meta.
        const { annotations: _dropped, ...without } = manifest;
        await writeFile(path.join(root, MANIFEST), JSON.stringify(without));
        stub.requests = [];
        const rebuilt = await report(fixture, ['Glyph.figma', '--refresh'], token);
        expect(rebuilt.code, rebuilt.stderr).toBe(1);
        expect(stub.routes()).toEqual(['meta']);
        const again = JSON.parse(await readFile(path.join(root, MANIFEST), 'utf8')) as { annotations: Annotation[] };
        expect(again.annotations).toEqual([SET_NOTE, shapeNote]);
    });

    it('prints one count line per block with notes, not their text', async () => {
        const { code, stdout } = await runCli(fixture, ['report', 'Glyph.figma', '--host-browser', '--no-open']);

        expect(code).toBe(1);
        expect(stdout).toMatch(/^ {6}glyph · notes: 2$/m);
        expect(stdout).not.toContain('Never recolour');
    });

    it('reads a manifest without notes as not synced: same verdict, a --refresh hint', async () => {
        const noted = await report(fixture, ['Glyph.figma']);
        const file = path.join(root, MANIFEST);
        const { annotations: _annotations, ...old } = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
        await writeFile(file, `${JSON.stringify(old, null, 4)}\n`);

        const { code, stderr, summary } = await report(fixture, ['Glyph.figma']);

        expect(code, stderr).toBe(noted.code);
        expect(summary.stories.map((story) => {
            return [story.verdict, story.cells];
        })).toEqual(noted.summary.stories.map((story) => {
            return [story.verdict, story.cells];
        }));
        expect(summary.warnings).toEqual([HOST_WARNING, expect.stringContaining('figma-qa report --refresh')]);
        expect(summary.warnings[1]).toContain('Designer notes');
        const result = await storyResult(fixture, summary.stories[0]?.results ?? null);
        expect(result.blocks[0]?.annotations).toBeNull();
    });
});
