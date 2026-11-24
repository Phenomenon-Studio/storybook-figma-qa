// `figma-qa scaffold` through the real CLI against the Figma REST stub: a page URL becomes a kit-owned
// `<Component>.figma.stories.tsx` beside the component's story, re-runs only append, and the first report after it
// reads the scaffold's warmed cache instead of calling `/nodes`. Each test leaves the fixture as committed.
import type { FigmaStub } from './figma-stub.ts';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixtureDir, FIXTURES, report, runCli } from './cli.ts';
import { startFigmaStub } from './figma-stub.ts';

const REFS = 'figma-qa/__refs__';
const NODES_CACHE = 'node_modules/.cache/figma-qa';
const KIT = 'https://www.figma.com/design/FIXTUREKIT/Fixture-UI-kit';
const PAGE = `${KIT}?node-id=1-0&t=share`;
const STORY = 'src/Button.stories.tsx';
const TARGET = 'src/Button.figma.stories.tsx';

type Node = { id: string; name: string; type: string; children?: Node[] };
type Entry = { document: Node; components?: Record<string, unknown>; componentSets?: Record<string, unknown> };

describe.each(FIXTURES)('figma-qa scaffold in fixtures/%s', (fixture) => {
    const root = fixtureDir(fixture);
    const target = path.join(root, TARGET);
    let stub: FigmaStub;
    let backup: string;
    let token: Record<string, string>;

    /** Adds page `id` to what the stub serves: a section holding `sets`, as a UI-kit page does. */
    function page(id: string, sets: Entry[]) {
        stub.nodes.nodes[id] = {
            document: {
                id,
                name: 'Components',
                type: 'CANVAS',
                children: [
                    {
                        id: `${id.split(':')[0]}:9`,
                        name: 'Kit',
                        type: 'SECTION',
                        children: sets.map((set) => {
                            return set.document;
                        }),
                    },
                ],
            },
            components: Object.assign(
                {},
                ...sets.map((set) => {
                    return set.components ?? {};
                })
            ),
            componentSets: {},
        };
    }

    function set(id: string): Entry {
        return structuredClone(stub.nodes.nodes[id]) as Entry;
    }

    async function scaffold(args: string[], env = token) {
        return await runCli(fixture, ['scaffold', ...args], env);
    }

    beforeEach(async () => {
        backup = await mkdtemp(path.join(tmpdir(), 'figma-qa-refs-'));
        await cp(path.join(root, REFS), backup, { recursive: true });
        await rm(path.join(root, NODES_CACHE), { recursive: true, force: true });
        stub = await startFigmaStub('FIXTUREKIT');
        token = { FIGMA_TOKEN: 'stub-token', FIGMA_API_URL: stub.url };
        page('1:0', [set('10:0'), set('20:0')]);
    });

    afterEach(async () => {
        await stub.close();
        await rm(target, { force: true });
        await rm(path.join(root, REFS), { recursive: true, force: true });
        await cp(backup, path.join(root, REFS), { recursive: true });
        await rm(backup, { recursive: true, force: true });
        await rm(path.join(root, NODES_CACHE), { recursive: true, force: true });
    });

    it('writes a Figma story for every set on a page, which reports all-missing from the warmed cache', async () => {
        const { code, stdout, stderr } = await scaffold([PAGE, '--story', STORY]);

        expect(code, stderr).toBe(0);
        // One `/nodes` for the page; the version comes with it.
        expect(stub.routes()).toEqual(['nodes']);
        expect(stdout).toContain(`figma-qa scaffold: wrote ${TARGET} (2 sets added)`);
        expect(stdout).toMatch(/\+ swatch +Swatch \(10:0\) +columns Tone, sections Size/);
        expect(stdout).toMatch(/\+ glyph +Glyph \(20:0\) +columns Icon, no sections/);
        const written = await readFile(target, 'utf8');
        expect(written).toContain("import preview from '../.storybook/preview.ts';");
        expect(written).toContain("import { Button } from './Button.tsx';");
        expect(written).toContain("title: 'Button/Figma',");
        expect(written).toContain('component: Button,');
        expect(written).toContain("tags: ['figma', '!autodocs'],");
        expect(written).toContain(`{ name: 'swatch', type: 'figma', url: '${KIT}?node-id=10-0' },`);
        expect(written).toContain(`{ name: 'glyph', type: 'figma', url: '${KIT}?node-id=20-0' },`);
        expect(written).toContain("{ name: 'swatch', layout: { sections: 'Size', columns: 'Tone' } },");
        expect(written).toContain("{ name: 'glyph', layout: { sections: null, columns: 'Icon' } },");
        expect(written).toContain('TODO(figma-qa)');

        // The first report syncs the sets from the scaffold's raw cache: `/images`, never `/nodes`.
        await rm(path.join(root, REFS, 'FIXTUREKIT-10-0'), { recursive: true });
        await rm(path.join(root, REFS, 'FIXTUREKIT-20-0'), { recursive: true });
        stub.requests = [];
        const run = await report(fixture, ['Button.figma'], token);

        expect(run.code, run.stderr).toBe(0);
        expect(run.summary.cells).toEqual({ pass: 0, fail: 0, approved: 0, missing: 8 });
        expect(stub.routes()).not.toContain('nodes');
        expect(stub.routes()).toContain('images');
    });

    it('re-runs append only unlinked sets, keeping renames and order', async () => {
        let run = await scaffold([`${KIT}?node-id=10-0`, '--story', STORY]);
        expect(run.code, run.stderr).toBe(0);
        // The author renames the entry to the code's variant.
        const renamed = (await readFile(target, 'utf8'))
            .replaceAll("name: 'swatch'", "name: 'tone-chip'")
            .replace('    swatch: () => {', "    'tone-chip': () => {");
        await writeFile(target, renamed);

        run = await scaffold([PAGE, '--story', STORY]);

        expect(run.code, run.stderr).toBe(0);
        expect(run.stdout).toContain(`figma-qa scaffold: wrote ${TARGET} (1 set added)`);
        const appended = await readFile(target, 'utf8');
        expect(appended).not.toContain("'swatch'");
        expect(appended.indexOf("name: 'tone-chip'")).toBeLessThan(appended.indexOf("name: 'glyph'"));
        expect(appended).toContain(`{ name: 'glyph', type: 'figma', url: '${KIT}?node-id=20-0' }`);
        expect(appended).toContain("{ name: 'glyph', layout: { sections: null, columns: 'Icon' } }");
        expect(appended).toMatch(/\/\/ TODO\(figma-qa\)[^\n]*Glyph[^\n]*\n\s+glyph: \(\) => \{\n\s+return null;/);

        run = await scaffold([PAGE, '--story', STORY]);

        expect(run.code, run.stderr).toBe(0);
        expect(run.stdout).toContain(`figma-qa scaffold: ${TARGET} already links every set; nothing to add`);
        expect(await readFile(target, 'utf8')).toBe(appended);
    });

    it('names a new entry apart from a renderer key left behind by a rename', async () => {
        await scaffold([`${KIT}?node-id=10-0`, '--story', STORY]);
        // The entry is renamed; its renderer keeps the old key.
        await writeFile(target, (await readFile(target, 'utf8')).replaceAll("name: 'swatch'", "name: 'tone-chip'"));
        const copy = set('10:0');
        copy.document = { ...copy.document, id: '30:0', name: 'Kit/Swatch' };
        page('2:0', [copy]);

        const { code, stdout, stderr } = await scaffold([`${KIT}?node-id=2-0`, '--story', STORY, '--dry-run']);

        expect(code, stderr).toBe(0);
        expect(stdout).toContain(`+            { name: 'swatch-2', type: 'figma', url: '${KIT}?node-id=30-0' },`);
        expect(stdout).toContain("+    'swatch-2': () => {");
    });

    it('warns about a linked set Figma no longer has, and keeps it', async () => {
        await scaffold([`${KIT}?node-id=10-0`, '--story', STORY]);
        const linked = await readFile(target, 'utf8');
        stub.nodes.nodes['10:0'] = null;

        const { code, stdout, stderr } = await scaffold([`${KIT}?node-id=20-0`, '--story', STORY]);

        expect(code, stderr).toBe(0);
        expect(stdout).toContain(`warn  swatch: ${KIT}?node-id=10-0 is no longer a component set in Figma; delete the entry if it is gone for good`);
        const appended = await readFile(target, 'utf8');
        expect(appended).toContain(`url: '${KIT}?node-id=10-0'`);
        expect(appended.length).toBeGreaterThan(linked.length);
    });

    it('--dry-run prints the diff and writes nothing; name collisions get a suffix and a warning', async () => {
        const copy = set('10:0');
        copy.document = { ...copy.document, id: '30:0', name: 'Kit/Swatch' };
        page('2:0', [set('10:0'), copy]);

        const { code, stdout, stderr } = await scaffold([`${KIT}?node-id=2-0`, '--story', STORY, '--dry-run']);

        expect(code, stderr).toBe(0);
        expect(stdout).toContain(`--- /dev/null\n+++ b/${TARGET}\n@@ -0,0 +1,`);
        expect(stdout).toContain(`+            { name: 'swatch', type: 'figma', url: '${KIT}?node-id=10-0' },`);
        expect(stdout).toContain(`+            { name: 'swatch-2', type: 'figma', url: '${KIT}?node-id=30-0' },`);
        expect(stdout).toContain('warn  swatch-2: Kit/Swatch (30:0) would also be named swatch; renamed swatch-2');
        expect(stdout).toContain(`figma-qa scaffold: dry run, ${TARGET} not written (2 sets to add)`);
        await expect(readFile(target)).rejects.toThrow();
        await expect(readFile(path.join(root, NODES_CACHE, 'nodes', 'FIXTUREKIT-10-0.json'))).rejects.toThrow();
    });

    it('titles a story with no sibling from its path and imports the CSF Next preview', async () => {
        const { code, stdout, stderr } = await scaffold([PAGE, '--story', 'src/Card.stories.tsx', '--dry-run']);

        expect(code, stderr).toBe(0);
        expect(stdout).toContain('+++ b/src/Card.figma.stories.tsx');
        expect(stdout).toContain("+import preview from '../.storybook/preview.ts';");
        expect(stdout).toContain("+    title: 'Card/Figma',");
        expect(stdout).not.toContain('component:');
    });

    it('prints the snippet and exits 2 for a Figma story it cannot edit', async () => {
        const before = await readFile(path.join(root, 'src/Swatch.figma.stories.tsx'), 'utf8');

        // Its design entry's url is an imported const: scaffold can't tell what it links.
        const { code, stdout, stderr } = await scaffold([PAGE, '--story', 'src/Swatch.stories.tsx']);

        expect(code).toBe(2);
        expect(stderr).toContain('figma-qa scaffold: cannot edit src/Swatch.figma.stories.tsx');
        expect(stderr).toContain('has no string literal `name` and `url`');
        expect(stdout).toContain(`{ name: 'swatch', type: 'figma', url: '${KIT}?node-id=10-0' },`);
        expect(await readFile(path.join(root, 'src/Swatch.figma.stories.tsx'), 'utf8')).toBe(before);
    });

    it('exits 2 with the setup hint when there is no FIGMA_TOKEN', async () => {
        const { code, stderr } = await scaffold([PAGE, '--story', STORY], {});

        expect(code).toBe(2);
        expect(stderr).toContain('FIGMA_TOKEN');
        expect(stderr).toContain('figma-qa init');
        expect(stub.requests).toEqual([]);
    });
});
