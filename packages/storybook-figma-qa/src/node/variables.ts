// Node side of `variables.json`: which variable ids the committed manifests bind that the catalogue can't name yet,
// the Plugin API script that names them, and the merge of its output. The REST variables endpoint is Enterprise-only,
// so names come from the Plugin API through an agent's `use_figma`, incrementally for new ids.
import type { FigmaSetManifest, FigmaSpec } from '../figma/types.ts';
import type { FigmaVariable, FigmaVariableCatalog } from '../figma/variables.ts';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readJson } from './json.ts';

export const VARIABLES_FILE = 'variables.json';

const TYPES: readonly FigmaVariable['type'][] = ['COLOR', 'FLOAT', 'STRING', 'BOOLEAN'];

function byId(a: string, b: string): number {
    return a.localeCompare(b, 'en', { numeric: true });
}

export async function readCatalog(root: string, refsDir: string): Promise<FigmaVariableCatalog | null> {
    return await readJson<FigmaVariableCatalog>(path.join(root, refsDir, VARIABLES_FILE));
}

/** The committed manifests in the refs dir: one per synced set. */
async function manifests(root: string, refsDir: string): Promise<FigmaSetManifest[]> {
    const dir = path.join(root, refsDir);
    let entries: string[];
    try {
        entries = await readdir(dir);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        throw error;
    }
    const found = await Promise.all(
        entries.sort().map((entry) => {
            return readJson<FigmaSetManifest>(path.join(dir, entry, 'manifest.json')).catch((error: unknown) => {
                // `variables.json` and any other file beside the set dirs.
                if ((error as NodeJS.ErrnoException).code === 'ENOTDIR') {
                    return null;
                }
                throw error;
            });
        })
    );

    return found.filter((manifest): manifest is FigmaSetManifest => {
        return manifest !== null;
    });
}

function specIds(spec: FigmaSpec): string[] {
    const bound = [
        spec.root.vars,
        ...spec.texts.map((text) => {
            return text.vars;
        }),
        ...spec.icons.map((icon) => {
            return icon.vars;
        }),
    ];

    return bound.flatMap((vars) => {
        return Object.values(vars ?? {}).filter((id): id is string => {
            return typeof id === 'string';
        });
    });
}

/** Bound ids the catalogue doesn't name, per Figma file key (the file the naming script must run in), sorted. */
export async function unnamedVariables(root: string, refsDir: string): Promise<Map<string, string[]>> {
    const named = (await readCatalog(root, refsDir))?.variables ?? {};
    const byFile = new Map<string, Set<string>>();
    for (const manifest of await manifests(root, refsDir)) {
        for (const variant of manifest.variants) {
            for (const id of specIds(variant.spec)) {
                if (!Object.hasOwn(named, id)) {
                    const ids = byFile.get(manifest.source.fileKey) ?? new Set<string>();
                    ids.add(id);
                    byFile.set(manifest.source.fileKey, ids);
                }
            }
        }
    }

    return new Map(
        [...byFile].map(([fileKey, ids]) => {
            return [fileKey, [...ids].sort(byId)];
        })
    );
}

export function countIds(unnamed: Map<string, string[]>): number {
    return [...unnamed.values()].reduce((sum, ids) => {
        return sum + ids.length;
    }, 0);
}

/** The run's one warning line for unnamed ids; null when every bound id is named. */
export function unnamedWarning(count: number): string | null {
    if (count === 0) {
        return null;
    }
    const ids = count === 1 ? '1 Figma variable is' : `${count} Figma variables are`;

    return `${ids} unnamed: rows bound to them are matched by value (a guess). Name them via \`figma-qa variables\`.`;
}

/**
 * The read-only Plugin API script for `use_figma` in the file that owns `ids`. It returns
 * `{ variables: { [id]: { collection, type, name } }, missing: [id] }`, the input `mergeVariables` takes.
 */
export function namingScript(ids: readonly string[]): string {
    return `const ids = ${JSON.stringify(ids)};
const variables = {};
const missing = [];
for (const id of ids) {
    const variable = await figma.variables.getVariableByIdAsync('VariableID:' + id);
    if (!variable) {
        missing.push(id);
        continue;
    }
    const collection = await figma.variables.getVariableCollectionByIdAsync(variable.variableCollectionId);
    variables[id] = { collection: collection ? collection.name : '', type: variable.resolvedType, name: variable.name };
}
return { variables, missing };`;
}

export type NamingOutput = { variables: Record<string, FigmaVariable>; missing: string[] };

/**
 * The naming script's output, checked entry by entry: a mangled paste is refused, never half merged. `missing`: ids
 * the file doesn't have (deleted, or owned by another file), which stay unnamed.
 */
export function parseNamingOutput(text: string): NamingOutput {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        throw new Error(`not JSON: ${(error as Error).message}`);
    }
    const variables = (parsed as { variables?: unknown } | null)?.variables;
    if (typeof variables !== 'object' || variables === null || Array.isArray(variables)) {
        throw new Error('expected the naming script\'s output: { "variables": { "<id>": { ... } } }');
    }
    const out: Record<string, FigmaVariable> = {};
    for (const [id, entry] of Object.entries(variables)) {
        const { collection, type, name } = (entry ?? {}) as Record<string, unknown>;
        if (
            id.startsWith('VariableID:') ||
            typeof collection !== 'string' ||
            !TYPES.includes(type as FigmaVariable['type']) ||
            typeof name !== 'string' ||
            name === ''
        ) {
            throw new Error(`variable "${id}": expected { collection, type, name } from the script`);
        }
        out[id] = { collection, type: type as FigmaVariable['type'], name };
    }
    const missing = (parsed as { missing?: unknown }).missing;

    return {
        variables: out,
        missing: Array.isArray(missing)
            ? missing.filter((id): id is string => {
                  return typeof id === 'string';
              })
            : [],
    };
}

/**
 * Adds the names the catalogue lacks; names already committed are never changed. Returns the ids added: none means
 * nothing was written, so a repeated merge leaves the file byte for byte.
 */
export async function mergeVariables(
    root: string,
    refsDir: string,
    named: Record<string, FigmaVariable>
): Promise<string[]> {
    const catalog = await readCatalog(root, refsDir);
    const current = catalog?.variables ?? {};
    const added = Object.keys(named)
        .filter((id) => {
            return !Object.hasOwn(current, id);
        })
        .sort(byId);
    if (added.length === 0) {
        return [];
    }
    const merged: Record<string, FigmaVariable> = { ...current };
    for (const id of added) {
        merged[id] = named[id] as FigmaVariable;
    }
    const variables = Object.fromEntries(
        Object.entries(merged).sort(([a], [b]) => {
            return byId(a, b);
        })
    );
    const fileKeys = [...(await unnamedVariables(root, refsDir)).keys()];
    const next: FigmaVariableCatalog = {
        source: {
            fileKey: catalog?.source.fileKey ?? fileKeys.join(','),
            via: 'figma-qa variables (Plugin API through use_figma)',
            updatedAt: new Date().toISOString().slice(0, 10),
        },
        variables,
    };
    await writeFile(path.join(root, refsDir, VARIABLES_FILE), `${JSON.stringify(next, null, 4)}\n`);

    return added;
}
