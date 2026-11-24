// Serves the project's config and icons to the preview as virtual modules. Added by the Storybook preset's
// `viteFinal`; addon-vitest applies `viteFinal` too, so Storybook and `figma-qa report` see the same modules.
import type { Plugin } from 'vite';
import path from 'node:path';
import { CONFIG_FILE, iconsGlob } from '../figma/config.ts';
import { configFile, forgetProjectConfig, loadProjectConfig } from './config.ts';

export const CONFIG_MODULE = 'virtual:figma-qa/config';
export const ICONS_MODULE = 'virtual:figma-qa/icons';

const MODULES = [CONFIG_MODULE, ICONS_MODULE];
const CONFIG_ENTRY = '@phenomenon-studio/storybook-figma-qa/config';

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
