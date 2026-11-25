// The setup checks for what only a human can provide, in the order a first run needs them: registry → Figma token →
// file access → Docker / image → variable names → Figma MCP. `doctor` prints them; `init`'s wizard prompts for the
// items marked with an `action`, then prints them as its closing checklist. Every check reads; none writes.
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { glob } from 'tinyglobby';
import { scanStoryFile } from '../figma/story-scan.ts';
import { dockerRunning, imagePulled, PLAYWRIGHT_MISSING, pinnedImage } from './browser.ts';
import { ENV_FILE, FigmaTokenError, figmaGet, figmaToken } from './figma-api.ts';
import { REGISTRY_LINE, withRegistryLine } from './project-text.ts';
import { countIds, readManifests, unnamedVariables, VARIABLES_FILE } from './variables.ts';
import { print } from './output.ts';

/** ok; todo = missing, a human fixes it; block = a report exits 2; warn and info never change an exit code. */
export type CheckStatus = 'ok' | 'todo' | 'block' | 'warn' | 'info';

export type Check = {
    name: string;
    status: CheckStatus;
    text: string;
    /** The human fix, one line each. */
    fix?: string[];
    /** What init's wizard may do about it. */
    action?: { kind: 'token' } | { kind: 'pull'; image: string };
};

const REGISTRY_HOST = '//npm.pkg.github.com/:_authToken=';

/** The registry token's documented setup: the user `~/.npmrc`, never the project's. */
export const REGISTRY_FIX = [
    'gh auth refresh -s read:packages',
    `echo "${REGISTRY_HOST}$(gh auth token)" >> ~/.npmrc`,
    `no gh: a classic personal access token with read:packages in that line (${REGISTRY_HOST}<token>)`,
];

/** Who can use the REST API on the UI kit without the low rate limit: one line, printed wherever a token is set up. */
export const SEAT_NOTE =
    "the token's owner needs a Dev or Full seat on the plan that owns the UI kit file (View/Collab seats get 429s)";

const TOKEN_FIX = [
    'create a personal access token (scope: File content, read-only) in Figma → Settings → Security',
    `run \`figma-qa init\` in a terminal to paste it, or put FIGMA_TOKEN=<token> in ${ENV_FILE} (gitignored)`,
    SEAT_NOTE,
];

export function printCheck(check: Check) {
    print(`${check.status.padEnd(5)} ${check.name}: ${check.text}`);
    for (const fix of check.fix ?? []) {
        print(`      fix: ${fix}`);
    }
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function readText(file: string): Promise<string | null> {
    return await readFile(file, 'utf8').catch(() => {
        return null;
    });
}

/** The user config npm and pnpm read: setup-node points CI at its own through NPM_CONFIG_USERCONFIG. */
function userNpmrc(): string {
    return process.env.npm_config_userconfig || process.env.NPM_CONFIG_USERCONFIG || path.join(homedir(), '.npmrc');
}

/** Never prompted: the project gets the scope line from init, the token stays user-level. */
export async function registryCheck(root: string): Promise<Check> {
    const project = await readText(path.join(root, '.npmrc'));
    if (withRegistryLine(project) !== project) {
        return {
            name: 'registry',
            status: 'todo',
            text: `.npmrc lacks ${REGISTRY_LINE}`,
            fix: ['run `figma-qa init`: it writes only that line'],
        };
    }
    const user = (await readText(userNpmrc())) ?? '';
    if (!user.split('\n').some((line) => {
        return line.trim().startsWith(REGISTRY_HOST);
    })) {
        return {
            name: 'registry',
            status: 'todo',
            text: `no GitHub Packages token in ${userNpmrc()}; installs of the kit fail without one`,
            fix: REGISTRY_FIX,
        };
    }

    return { name: 'registry', status: 'ok', text: `${REGISTRY_LINE}, token in ${userNpmrc()}` };
}

/** `/v1/me`: the token works at all. */
export async function tokenCheck(root: string): Promise<Check> {
    const token = figmaToken(root);
    if (!token) {
        return {
            name: 'figma token',
            status: 'todo',
            text: 'FIGMA_TOKEN not set; reports run offline from committed refs, new sets and --refresh need it',
            fix: TOKEN_FIX,
            action: { kind: 'token' },
        };
    }
    const source = process.env.FIGMA_TOKEN ? 'env' : ENV_FILE;
    try {
        const me = await figmaGet<{ handle?: string; email?: string }>('/me', token);

        return { name: 'figma token', status: 'ok', text: `${me.handle ?? me.email ?? 'valid'} (FIGMA_TOKEN from ${source})` };
    } catch (error) {
        if (error instanceof FigmaTokenError) {
            // The env wins over `.env.local`: a token init saved there would never be read.
            return process.env.FIGMA_TOKEN
                ? {
                      name: 'figma token',
                      status: 'block',
                      text: 'Figma rejected FIGMA_TOKEN from env',
                      fix: ['replace FIGMA_TOKEN where your environment sets it, or unset it to use .env.local', SEAT_NOTE],
                  }
                : {
                      name: 'figma token',
                      status: 'block',
                      text: `Figma rejected FIGMA_TOKEN from ${ENV_FILE}`,
                      fix: TOKEN_FIX,
                      action: { kind: 'token' },
                  };
        }

        return { name: 'figma token', status: 'warn', text: `not verified: ${message(error)}` };
    }
}

/**
 * The Figma files the project's Figma stories link: from the committed refs, then from URLs written in story files
 * that may hold a Figma story (a URL kept in another module is found once its set is synced).
 */
async function figmaFiles(root: string, refsDir: string): Promise<{ stories: boolean; fileKeys: string[] }> {
    const keys = new Set<string>();
    const manifests = await readManifests(root, refsDir);
    for (const manifest of manifests) {
        keys.add(manifest.source.fileKey);
    }
    const files = await glob('**/*.stories.{ts,tsx,js,jsx,mts,mjs}', { cwd: root, ignore: ['**/node_modules/**'] });
    let stories = manifests.length > 0;
    for (const file of files.sort()) {
        const source = (await readText(path.join(root, file))) ?? '';
        if (!scanStoryFile(file, source).figma) {
            continue;
        }
        for (const match of source.matchAll(/figma\.com\/(?:design|file)\/(\w+)/g)) {
            stories = true;
            keys.add(match[1] as string);
        }
    }

    return { stories, fileKeys: [...keys] };
}

/** `/meta` on each linked file: the token's owner can open it. `token`: one `/v1/me` took, else null. */
export async function fileAccessChecks(root: string, refsDir: string, token: string | null): Promise<Check[]> {
    const { stories, fileKeys } = await figmaFiles(root, refsDir);
    if (!stories) {
        return [{ name: 'file access', status: 'info', text: 'no Figma story yet; checked once one links a set' }];
    }
    if (!token) {
        return [{ name: 'file access', status: 'info', text: `not checked: needs a working FIGMA_TOKEN (${fileKeys.join(', ')})` }];
    }
    return await Promise.all(
        fileKeys.map(async (fileKey): Promise<Check> => {
            try {
                const meta = await figmaGet<{ file: { name: string; version: string } }>(`/files/${fileKey}/meta`, token);

                return { name: 'file access', status: 'ok', text: `${fileKey} "${meta.file.name}", version ${meta.file.version}` };
            } catch (error) {
                if (error instanceof FigmaTokenError) {
                    return {
                        name: 'file access',
                        status: 'block',
                        text: `the token's owner cannot open ${fileKey}`,
                        fix: ['ask the UI kit owner to share the file with the token\'s owner', SEAT_NOTE],
                    };
                }

                // As in a report: a /meta failure that isn't the token is a warning, cached refs still serve.
                return { name: 'file access', status: 'warn', text: `${fileKey}: ${message(error)}` };
            }
        })
    );
}

/** Detect only: the wizard offers the pull, a report starts the image. */
export async function dockerCheck(root: string): Promise<Check> {
    if (!(await dockerRunning())) {
        return {
            name: 'browser',
            status: 'info',
            text: 'Docker is not running; reports use host Chromium (pixels not comparable to CI)',
        };
    }
    const pinned = pinnedImage(root);
    if (!pinned) {
        return { name: 'browser', status: 'block', text: PLAYWRIGHT_MISSING };
    }
    if (await imagePulled(pinned.image)) {
        return { name: 'browser', status: 'ok', text: `Docker runs; pinned image ${pinned.image} pulled` };
    }

    return {
        name: 'browser',
        status: 'todo',
        text: `pinned image ${pinned.image} not pulled; the first report pulls it`,
        fix: [`docker pull ${pinned.image}`],
        action: { kind: 'pull', image: pinned.image },
    };
}

/** Info only: unnamed ids fall back to value matching, and naming them is an agent's in-session step. */
export async function variablesCheck(root: string, refsDir: string): Promise<Check> {
    const count = countIds(await unnamedVariables(root, refsDir));
    if (count === 0) {
        return { name: 'variables', status: 'ok', text: `every bound variable is named in ${refsDir}/${VARIABLES_FILE}` };
    }

    return {
        name: 'variables',
        status: 'info',
        text: `${count} bound variable${count === 1 ? ' is' : 's are'} unnamed; their rows are matched by value`,
        fix: ['ask an agent to name them (figma-qa-variables skill, via the Figma MCP), or run `figma-qa variables`'],
    };
}

export const MCP_CHECK: Check = {
    name: 'figma mcp',
    status: 'info',
    text: "agents name variables and read annotations through the Figma MCP server's use_figma; add it to your agent",
};

export async function humanChecks(root: string, refsDir: string): Promise<Check[]> {
    const registry = await registryCheck(root);
    const token = await tokenCheck(root);
    const files = await fileAccessChecks(root, refsDir, token.status === 'ok' ? figmaToken(root) : null);

    return [registry, token, ...files, await dockerCheck(root), await variablesCheck(root, refsDir), MCP_CHECK];
}
