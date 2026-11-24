// `figma-qa scaffold <url...> --story <path> [--dry-run]`: every component set under the URLs (page, section, frame or
// one set) becomes a design entry, matrix block and stubbed renderer in the kit-owned `<Component>.figma.stories.tsx`
// beside `<path>`. A re-run appends only sets the file doesn't link yet. The one `/nodes` call per file warms the raw
// cache, so the first report after it syncs without `/nodes`.
import type { NodesResponse } from '../node/set-manifest.ts';
import type { ImportSpec, LinkedEntry, ScaffoldSet } from '../node/scaffold.ts';
import type { RawSet } from '../node/sync.ts';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'tinyglobby';
import { parseFigmaUrl } from '../figma/types.ts';
import { Unsafe } from '../node/ast.ts';
import { figmaGet, figmaToken } from '../node/figma-api.ts';
import {
    appendSets,
    componentSets,
    linkedEntries,
    newFigmaStory,
    readSibling,
    scaffoldSet,
    scaffoldSnippet,
} from '../node/scaffold.ts';
import { writeRawSet } from '../node/sync.ts';
import { unifiedDiff } from '../node/text-diff.ts';

const USAGE = 'usage: figma-qa scaffold <figma-url...> --story <path/Component.stories.tsx> [--dry-run]';

/** A design entry the story links, with the set its URL names. */
type Link = LinkedEntry & { fileKey: string; nodeId: string };

/** One component set's identity across files: file key and node id. */
function setKey(set: { fileKey: string; nodeId: string }): string {
    return `${set.fileKey} ${set.nodeId}`;
}

/** Thrown for a setup error: printed as is, exit 2. */
class SetupError extends Error {}

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function parseArgs(argv: string[]): { urls: string[]; story: string; dryRun: boolean } | null {
    const urls: string[] = [];
    let story: string | null = null;
    let dryRun = false;
    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index] as string;
        if (arg === '--dry-run') {
            dryRun = true;
        } else if (arg === '--story') {
            story = argv[++index] ?? null;
        } else if (arg.startsWith('--story=')) {
            story = arg.slice('--story='.length);
        } else if (arg.startsWith('-')) {
            return null;
        } else {
            urls.push(arg);
        }
    }

    return urls.length > 0 && story ? { urls, story, dryRun } : null;
}

/** `Button.stories.tsx` → `Button.figma.stories.tsx` beside it; a `.figma.stories` path is the target itself. */
function storyFiles(root: string, story: string) {
    const absolute = path.resolve(root, story);
    const dir = path.dirname(absolute);
    const match = /^(.+?)(\.figma)?\.stories\.([cm]?[jt]sx?)$/.exec(path.basename(absolute));
    if (!match) {
        throw new SetupError(`--story ${story} is not a story file (<Component>.stories.tsx)`);
    }
    const [, base = '', , ext = 'tsx'] = match;

    return {
        component: base.split('.')[0] ?? base,
        sibling: path.join(dir, `${base}.stories.${ext}`),
        target: path.join(dir, `${base}.figma.stories.${ext}`),
    };
}

async function readText(file: string): Promise<string | null> {
    return readFile(file, 'utf8').catch(() => {
        return null;
    });
}

/** Storybook's auto title, roughly: the path under `src/` without the extension, a repeated last segment dropped. */
function pathTitle(root: string, sibling: string): string {
    const segments = path
        .relative(root, sibling)
        .replace(/\.stories\.[^.]+$/, '')
        .split(path.sep)
        .filter((segment, index) => {
            return !(index === 0 && segment === 'src');
        });
    if (segments.length > 1 && segments.at(-1) === segments.at(-2)) {
        segments.pop();
    }

    return segments.join('/');
}

/** The project's CSF Next `.storybook/preview`, imported relative to `dir`: the head for a story with no sibling. */
async function previewImport(root: string, dir: string): Promise<ImportSpec> {
    const [file] = await glob('.storybook/preview.{ts,tsx,js,jsx,mts,mjs}', { cwd: root });
    const source = file ? await readText(path.join(root, file)) : null;
    if (!file || !source?.includes('definePreview')) {
        throw new SetupError(
            'scaffold writes CSF Next stories: .storybook/preview must export `definePreview({…})` (or pass --story a story built with `preview.meta`)'
        );
    }
    const relative = path.relative(dir, path.join(root, file)).split(path.sep).join('/');

    return { source: relative.startsWith('.') ? relative : `./${relative}`, local: 'preview', imported: 'default' };
}

type Fetched = {
    sets: ScaffoldSet[];
    /** Per file key: the version `/nodes` answered at, stamped on each set's raw cache entry. */
    versions: Map<string, Omit<RawSet, 'entry'>>;
    vanished: string[];
    warnings: string[];
};

/**
 * One `/nodes` per input file key, for the input nodes and the sets the story links there (to tell which vanished).
 * Sets are kept in URL order, then document order, each once.
 */
async function fetchSets(urls: string[], links: Link[], component: string, token: string): Promise<Fetched> {
    const fetched: Fetched = { sets: [], versions: new Map(), vanished: [], warnings: [] };
    const inputs = urls.map((url) => {
        try {
            return { url, ...parseFigmaUrl(url) };
        } catch {
            throw new SetupError(`${url} is not a Figma node URL (…/design/<file>/…?node-id=…)`);
        }
    });
    // Only the input URLs' files: a linked set in another file isn't checked, so a file this run doesn't need can't
    // fail it.
    const fileKeys = [
        ...new Set(
            inputs.map((node) => {
                return node.fileKey;
            })
        ),
    ];
    const seen = new Set<string>();
    for (const fileKey of fileKeys) {
        const ids = [
            ...new Set(
                [...inputs, ...links]
                    .filter((node) => {
                        return node.fileKey === fileKey;
                    })
                    .map((node) => {
                        return node.nodeId;
                    })
            ),
        ];
        const nodes = await figmaGet<NodesResponse>(
            `/files/${fileKey}/nodes?ids=${encodeURIComponent(ids.join(','))}`,
            token
        );
        fetched.versions.set(fileKey, { version: nodes.version, lastModified: nodes.lastModified });
        for (const input of inputs.filter((node) => {
            return node.fileKey === fileKey;
        })) {
            const entry = nodes.nodes[input.nodeId];
            if (!entry) {
                throw new SetupError(`Figma has no node ${input.nodeId} in file ${fileKey} (${input.url})`);
            }
            const found = componentSets(entry.document);
            if (found.length === 0) {
                fetched.warnings.push(`${input.url} holds no component set`);
            }
            for (const node of found) {
                const id = setKey({ fileKey, nodeId: node.id });
                if (seen.has(id)) {
                    continue;
                }
                seen.add(id);
                let set: ScaffoldSet;
                try {
                    set = scaffoldSet(input.url, fileKey, node, entry, component);
                } catch (error) {
                    throw new SetupError(`Figma set ${node.name} (${node.id}) ${message(error)}`);
                }
                fetched.sets.push(set);
            }
        }
        for (const link of links.filter((node) => {
            return node.fileKey === fileKey;
        })) {
            if (nodes.nodes[link.nodeId]?.document.type !== 'COMPONENT_SET') {
                fetched.vanished.push(
                    `${link.name}: ${link.url} is no longer a component set in Figma; delete the entry if it is gone for good`
                );
            }
        }
    }

    return fetched;
}

/** New sets only, each named apart from the linked entries, the renderer keys and each other. */
function newSets(sets: ScaffoldSet[], links: Link[], renderers: string[], warnings: string[]): ScaffoldSet[] {
    const linkedIds = new Set(links.map(setKey));
    const names = new Set([
        ...links.map((entry) => {
            return entry.name;
        }),
        ...renderers,
    ]);

    return sets
        .filter((set) => {
            return !linkedIds.has(setKey(set));
        })
        .map((set) => {
            let name = set.name;
            for (let index = 2; names.has(name); index++) {
                name = `${set.name}-${index}`;
            }
            if (name !== set.name) {
                warnings.push(`${name}: ${set.set} (${set.nodeId}) would also be named ${set.name}; renamed ${name}`);
            }
            names.add(name);

            return { ...set, name };
        });
}

function setLine(set: ScaffoldSet, width: number): string {
    const sections = set.layout.sections === null ? 'no sections' : `sections ${set.layout.sections}`;

    return `+ ${set.name.padEnd(width)}  ${set.set} (${set.nodeId})  columns ${set.layout.columns}, ${sections}`;
}

function count(sets: readonly unknown[]): string {
    return `${sets.length} set${sets.length === 1 ? '' : 's'}`;
}

async function run(argv: string[]): Promise<number> {
    const args = parseArgs(argv);
    if (!args) {
        console.error(`figma-qa scaffold: ${USAGE}`);

        return 2;
    }
    const token = figmaToken();
    if (!token) {
        console.error(
            'figma-qa scaffold: needs FIGMA_TOKEN, as it reads the UI kit live from Figma. Run `figma-qa init` to set it up, or export FIGMA_TOKEN.'
        );

        return 2;
    }
    const root = process.cwd();
    const files = storyFiles(root, args.story);
    const relative = path.relative(root, files.target).split(path.sep).join('/');
    const existing = await readText(files.target);
    let linked: LinkedEntry[] = [];
    let renderers: string[] = [];
    let unsafe: string | null = null;
    if (existing !== null) {
        try {
            ({ linked, renderers } = linkedEntries(existing));
        } catch (error) {
            if (!(error instanceof Unsafe)) {
                throw new SetupError(`cannot read ${relative}: ${message(error)}`);
            }
            unsafe = error.message;
        }
    }

    const links = linked.flatMap((entry) => {
        try {
            return [{ ...entry, ...parseFigmaUrl(entry.url) }];
        } catch {
            // An entry that isn't a node URL links no set scaffold could find again.
            return [];
        }
    });
    const fetched = await fetchSets(args.urls, links, files.component, token);
    const warnings = [...fetched.warnings, ...fetched.vanished];
    const added = newSets(fetched.sets, links, renderers, warnings);
    if (unsafe !== null) {
        console.error(`figma-qa scaffold: cannot edit ${relative}: ${unsafe}. Add each set by hand:`);
        console.log(scaffoldSnippet(added));

        return 2;
    }
    for (const warning of warnings) {
        console.log(`warn  ${warning}`);
    }
    if (added.length === 0) {
        console.log(`figma-qa scaffold: ${relative} already links every set; nothing to add`);

        return 0;
    }

    let next: string;
    if (existing === null) {
        const siblingSource = await readText(files.sibling);
        const sibling = siblingSource === null ? null : readSibling(files.sibling, siblingSource);
        next = newFigmaStory(
            {
                title: `${sibling?.title ?? pathTitle(root, files.sibling)}/Figma`,
                preview: sibling?.preview ?? (await previewImport(root, path.dirname(files.target))),
                component: sibling?.component ?? null,
            },
            added
        );
    } else {
        next = appendSets(existing, added);
    }

    const width = Math.max(
        ...added.map((set) => {
            return set.name.length;
        })
    );
    const lines = added.map((set) => {
        return setLine(set, width);
    });
    if (args.dryRun) {
        process.stdout.write(unifiedDiff(existing ?? '', next, relative));
        console.log(`figma-qa scaffold: dry run, ${relative} not written (${count(added)} to add)`);
        console.log(lines.join('\n'));

        return 0;
    }

    await writeFile(files.target, next);
    // The first sync of these sets builds them from here, skipping `/nodes`.
    for (const set of added) {
        const raw: RawSet = { ...(fetched.versions.get(set.fileKey) as Omit<RawSet, 'entry'>), entry: set.entry };
        await writeRawSet(root, set.fileKey, set.nodeId, raw);
    }
    console.log(`figma-qa scaffold: wrote ${relative} (${count(added)} added)`);
    console.log(lines.join('\n'));
    console.log(
        `next: rename each entry to the code's variant and write its renderCell; until then \`figma-qa report ${files.component}\` reports its cells missing`
    );

    return 0;
}

export async function scaffold(argv: string[]): Promise<number> {
    try {
        return await run(argv);
    } catch (error) {
        console.error(`figma-qa scaffold: ${message(error)}`);

        return 2;
    }
}
