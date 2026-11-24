// Serves the project's config and icons to the preview as virtual modules, and the dev route (DEV_ROUTE) a running
// Storybook reads results and refs from. Added by the Storybook preset's `viteFinal`; addon-vitest applies
// `viteFinal` too, so Storybook and `figma-qa report` see the same modules.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DEV_ROUTE } from '../constants.ts';
import { CONFIG_FILE, iconsGlob } from '../figma/config.ts';
import { RESULTS_DIR } from '../figma/types.ts';
import { configFile, forgetProjectConfig, loadProjectConfig } from './config.ts';
import { loadSets } from './sets.ts';
import { FigmaSync } from './sync.ts';

export const CONFIG_MODULE = 'virtual:figma-qa/config';
export const ICONS_MODULE = 'virtual:figma-qa/icons';

const MODULES = [CONFIG_MODULE, ICONS_MODULE];
const CONFIG_ENTRY = '@phenomenon-studio/storybook-figma-qa/config';

const CONTENT_TYPES: Record<string, string> = { '.png': 'image/png', '.json': 'application/json' };

function send(response: ServerResponse, status: number, type: string, body: string | Buffer) {
    response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    response.end(body);
}

async function readBody(request: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
        chunks.push(chunk as Buffer);
    }

    return Buffer.concat(chunks).toString('utf8');
}

/** `GET files/<project path>`: a PNG or JSON under the refs or results dir, nothing else in the project. */
async function serveFile(root: string, pathname: string, response: ServerResponse) {
    const { config } = await loadProjectConfig(root);
    const file = path.resolve(root, `.${decodeURIComponent(pathname)}`);
    const type = CONTENT_TYPES[path.extname(file)];
    const inside = [config.refsDir, RESULTS_DIR].some((dir) => {
        return file.startsWith(path.resolve(root, dir) + path.sep);
    });
    if (!type || !inside) {
        send(response, 404, 'text/plain', 'Not a Figma QA file.');

        return;
    }
    try {
        send(response, 200, type, await readFile(file));
    } catch {
        send(response, 404, 'text/plain', 'Not found: run `figma-qa report`.');
    }
}

/**
 * `POST sets` with the set URLs: what the preview loader gets in a Vitest run, from the committed refs only. Syncing
 * with Figma (network calls, writes to the refs dir) is a report run's job; reading fresh per request lets a running
 * Storybook see refs a report just updated.
 */
async function serveSets(root: string, request: IncomingMessage, response: ServerResponse) {
    const urls = JSON.parse(await readBody(request)) as unknown;
    if (
        !Array.isArray(urls) ||
        !urls.every((url) => {
            return typeof url === 'string';
        })
    ) {
        send(response, 400, 'text/plain', 'Expected a JSON array of Figma set URLs.');

        return;
    }
    const { config } = await loadProjectConfig(root);
    const loaded = await loadSets(root, config.refsDir, new FigmaSync({ root, refsDir: config.refsDir, offline: true }), urls);
    send(response, 200, 'application/json', JSON.stringify(loaded));
}

export function figmaQaVitePlugin(): Plugin {
    let root = process.cwd();

    return {
        name: 'figma-qa:virtual-modules',
        config() {
            // The config file imports `defineConfig` from here. Found mid-run, a prebundled dep makes Vite re-optimize
            // and reload, failing that run's story files; the module is plain ESM with no dependencies, so serve it as is.
            return { optimizeDeps: { exclude: [CONFIG_ENTRY] } };
        },
        configResolved(config) {
            root = config.root;
        },
        configureServer(server) {
            server.middlewares.use(DEV_ROUTE, (request, response, next) => {
                const { pathname } = new URL(request.url ?? '/', 'http://localhost');
                let handled: Promise<void> | null = null;
                if (request.method === 'GET' && pathname.startsWith('/files/')) {
                    handled = serveFile(root, pathname.slice('/files'.length), response);
                } else if (request.method === 'POST' && pathname === '/sets') {
                    handled = serveSets(root, request, response);
                }
                if (!handled) {
                    next();

                    return;
                }
                handled.catch((error: unknown) => {
                    send(response, 500, 'text/plain', error instanceof Error ? error.message : String(error));
                });
            });
            // A running Storybook picks up an added, edited or deleted config (and a changed icons glob) on reload.
            const file = path.join(root, CONFIG_FILE);
            server.watcher.add(file);
            server.watcher.on('all', (_event, changed) => {
                if (changed !== file) {
                    return;
                }
                forgetProjectConfig(root);
                const graph = server.environments.client.moduleGraph;
                for (const id of MODULES) {
                    const module = graph.getModuleById(`\0${id}`);
                    if (module) {
                        graph.invalidateModule(module);
                    }
                }
                server.environments.client.hot.send({ type: 'full-reload' });
            });
        },
        resolveId(id) {
            return MODULES.includes(id) ? `\0${id}` : null;
        },
        async load(id) {
            if (id === `\0${CONFIG_MODULE}`) {
                // The file itself, not a serialized copy: `tokenName` and `icons.name` are functions that run in the
                // preview. Not validated here: a broken config must fail the Figma stories that read it
                // (figma/project.ts), not the whole preview; the CLI rejects it before a run.
                const file = configFile(root);

                return file ? `export { default } from ${JSON.stringify(file)};` : 'export default undefined;';
            }
            if (id === `\0${ICONS_MODULE}`) {
                // A broken config serves no icons: the stories that read the config report it.
                const glob = await loadProjectConfig(root).then(
                    ({ config }) => {
                        return iconsGlob(config);
                    },
                    () => {
                        return null;
                    }
                );
                if (!glob) {
                    return 'export default {};';
                }

                return `export default import.meta.glob(${JSON.stringify(glob)}, { query: '?raw', import: 'default', eager: true });`;
            }

            return null;
        },
    };
}
