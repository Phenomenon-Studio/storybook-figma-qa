// Lazy Figma sync: each Figma story asks for its sets (`figmaEnsureSets`) and gets them from the committed refs,
// fetching from Figma only what is missing or, with `--refresh`, what changed. The `/meta` version is the cache key:
// a set synced at the current version costs no `/nodes` or `/images` call. Requests for sets of one file are
// coalesced over a short window, so a run makes about one `/nodes` and one `/images` call per file.
import type { FigmaSetManifest } from '../figma/types.ts';
import type { NodesEntry, NodesResponse } from './set-manifest.ts';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { REFRESH_ENV } from '../constants.ts';
import { FIGMA_SCALE, figmaSlug, parseFigmaUrl, REFS_DIR, variantSlug } from '../figma/types.ts';
import { download, figmaGet, figmaToken, FigmaTokenError } from './figma-api.ts';
import { readJson } from './json.ts';
import { setManifest } from './set-manifest.ts';

/** Raw `/nodes` entries per set, relative to the project root: gitignored, lets `--refresh` rebuild offline. */
export const NODES_CACHE_DIR = 'node_modules/.cache/figma-qa/nodes';

/** How long the first request for a file waits for other stories' requests for the same file. */
const COALESCE_MS = 100;

export type SyncedSet = { manifest: FigmaSetManifest; warning: string | null };

type RawSet = { version: string; lastModified: string; entry: NodesEntry };

type Local = {
    url: string;
    nodeId: string;
    slug: string;
    dir: string;
    /** Raw `/nodes` JSON of the set, in the local cache. */
    rawFile: string;
    manifest: FigmaSetManifest | null;
    /** Manifest plus every variant PNG on disk. */
    complete: boolean;
};

async function pngsComplete(dir: string, manifest: FigmaSetManifest | null): Promise<boolean> {
    if (!manifest) {
        return false;
    }
    const present = await Promise.all(
        manifest.variants.map((variant) => {
            return readFile(path.join(dir, `${variantSlug(variant.id)}.png`)).then(
                () => {
                    return true;
                },
                () => {
                    return false;
                }
            );
        })
    );

    return present.every(Boolean);
}

async function readLocal(root: string, url: string): Promise<Local> {
    const { fileKey, nodeId } = parseFigmaUrl(url);
    const slug = figmaSlug(fileKey, nodeId);
    const dir = path.join(root, REFS_DIR, slug);
    const manifest = await readJson<FigmaSetManifest>(path.join(dir, 'manifest.json'));

    return {
        url,
        nodeId,
        slug,
        dir,
        rawFile: path.join(root, NODES_CACHE_DIR, `${slug}.json`),
        manifest,
        complete: await pngsComplete(dir, manifest),
    };
}

function staleWarning(local: Local, version: string): string | null {
    const synced = local.manifest?.source.version;

    return synced === undefined || synced === version
        ? null
        : `Figma changed since ${local.url} was synced (version ${synced} → ${version}): run \`figma-qa report --refresh\` to adopt it.`;
}

/** Syncs one file's batch of sets. Every set in the batch settles to its manifest or the batch's error. */
async function syncFile(root: string, fileKey: string, urls: string[], meta: Meta): Promise<Map<string, SyncedSet>> {
    const token = figmaToken();
    const refresh = process.env[REFRESH_ENV] === '1';
    const locals = await Promise.all(
        urls.map((url) => {
            return readLocal(root, url);
        })
    );
    const served = new Map<string, SyncedSet>();
    const serve = (local: Local, warning: string | null) => {
        served.set(local.url, { manifest: local.manifest as FigmaSetManifest, warning });
    };
    const needed = locals.filter((local) => {
        return refresh || !local.complete;
    });

    if (!token) {
        for (const local of locals) {
            if (!local.complete) {
                throw new Error(`Figma set ${local.url} not cached; run with FIGMA_TOKEN to sync it.`);
            }
            serve(local, null);
        }

        return served;
    }

    if (needed.length === 0) {
        // Everything is cached: `/meta` only tells whether Figma moved on, so its failure is a warning, not an error.
        let version: string;
        try {
            version = await meta(fileKey, token);
        } catch (error) {
            if (error instanceof FigmaTokenError) {
                throw error;
            }
            const reason = error instanceof Error ? error.message : String(error);
            for (const local of locals) {
                serve(local, `Could not check Figma for changes; using cached refs. ${reason}`);
            }

            return served;
        }
        for (const local of locals) {
            serve(local, staleWarning(local, version));
        }

        return served;
    }

    const version = await meta(fileKey, token);
    const raws = new Map<string, RawSet>();
    const toFetch: Local[] = [];
    for (const local of locals) {
        if (!needed.includes(local)) {
            serve(local, staleWarning(local, version));
            continue;
        }
        const raw = await readJson<RawSet>(local.rawFile);
        if (raw?.version === version) {
            raws.set(local.url, raw);
        } else if (local.complete && local.manifest?.source.version === version) {
            // `--refresh` at the synced version, without raw JSON to rebuild from: nothing to adopt.
            serve(local, null);
        } else {
            toFetch.push(local);
        }
    }

    if (toFetch.length > 0) {
        // The whole subtree (no `depth`) without vector geometry, pinned to the version `/meta` reported.
        const ids = toFetch
            .map((local) => {
                return local.nodeId;
            })
            .join(',');
        const nodes = await figmaGet<NodesResponse>(
            `/files/${fileKey}/nodes?ids=${encodeURIComponent(ids)}&version=${encodeURIComponent(version)}`,
            token
        );
        for (const local of toFetch) {
            const entry = nodes.nodes[local.nodeId];
            if (!entry) {
                throw new Error(`Figma has no node ${local.nodeId} in file ${fileKey} (${local.url}).`);
            }
            const raw: RawSet = { version: nodes.version, lastModified: nodes.lastModified, entry };
            await mkdir(path.dirname(local.rawFile), { recursive: true });
            await writeFile(local.rawFile, JSON.stringify(raw));
            raws.set(local.url, raw);
        }
    }

    const built = locals.flatMap((local) => {
        const raw = raws.get(local.url);
        if (!raw) {
            return [];
        }
        const manifest = setManifest(local.url, raw.entry, raw.version, raw.lastModified);
        // Same subtree and every PNG on disk: Figma would render the same images.
        const images = !local.complete || local.manifest?.source.hash !== manifest.source.hash;

        return [{ local, manifest, images }];
    });

    const rendered = built.filter((item) => {
        return item.images;
    });
    if (rendered.length > 0) {
        // One render call for every variant of every changed set; absolute bounds crop to the node box, as an
        // element screenshot does.
        const ids = rendered.flatMap((item) => {
            return item.manifest.variants.map((variant) => {
                return variant.id;
            });
        });
        const { images } = await figmaGet<{ images: Record<string, string | null> }>(
            `/images/${fileKey}?ids=${encodeURIComponent(ids.join(','))}&format=png&scale=${FIGMA_SCALE}&use_absolute_bounds=true&version=${encodeURIComponent(version)}`,
            token
        );
        const jobs = [];
        for (const item of rendered) {
            // Fresh dir: PNGs of variants Figma removed don't linger.
            await rm(item.local.dir, { recursive: true, force: true });
            await mkdir(item.local.dir, { recursive: true });
            for (const variant of item.manifest.variants) {
                const url = images[variant.id];
                if (!url) {
                    throw new Error(`Figma could not render ${variant.name} (${variant.id}).`);
                }
                jobs.push({ url, file: path.join(item.local.dir, `${variantSlug(variant.id)}.png`) });
            }
        }
        await download(jobs);
    }

    for (const { local, manifest } of built) {
        await mkdir(local.dir, { recursive: true });
        await writeFile(path.join(local.dir, 'manifest.json'), `${JSON.stringify(manifest, null, 4)}\n`);
        served.set(local.url, { manifest, warning: null });
    }

    return served;
}

type Meta = (fileKey: string, token: string) => Promise<string>;

/** One Vitest run's sync state: `/meta` once per file, each set once, requests per file batched. */
export class FigmaSync {
    private readonly versions = new Map<string, Promise<string>>();
    private readonly sets = new Map<string, Promise<SyncedSet>>();
    private readonly batches = new Map<string, { urls: string[]; done: Promise<Map<string, SyncedSet>> }>();

    private readonly root: string;

    constructor(root: string) {
        this.root = root;
    }

    private meta: Meta = (fileKey, token) => {
        let version = this.versions.get(fileKey);
        if (!version) {
            version = figmaGet<{ file: { version: string } }>(`/files/${fileKey}/meta`, token).then((response) => {
                return response.file.version;
            });
            this.versions.set(fileKey, version);
        }

        return version;
    };

    /** The set's manifest, synced at most once per run; a failure is remembered, not retried. */
    ensure(url: string): Promise<SyncedSet> {
        let set = this.sets.get(url);
        if (!set) {
            set = this.batch(url);
            this.sets.set(url, set);
            // Rejections reach every caller through the stored promise; this one only keeps Node from flagging it.
            set.catch(() => {});
        }

        return set;
    }

    private async batch(url: string): Promise<SyncedSet> {
        const { fileKey } = parseFigmaUrl(url);
        let batch = this.batches.get(fileKey);
        if (!batch) {
            const urls: string[] = [];
            const done = new Promise<void>((resolve) => {
                setTimeout(resolve, COALESCE_MS);
            }).then(() => {
                // Later requests for this file start a new batch.
                this.batches.delete(fileKey);

                return syncFile(this.root, fileKey, urls, this.meta);
            });
            batch = { urls, done };
            this.batches.set(fileKey, batch);
        }
        batch.urls.push(url);
        const synced = (await batch.done).get(url);
        if (!synced) {
            throw new Error(`Figma set ${url} was not synced.`);
        }

        return synced;
    }
}
