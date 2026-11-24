// Serves the project's config and icons to the preview as virtual modules. Added by the Storybook preset's
// `viteFinal`; addon-vitest applies `viteFinal` too, so Storybook and `figma-qa report` see the same modules.
import type { Plugin } from 'vite';
import { loadProjectConfig } from './config.ts';

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
        resolveId(id) {
            return MODULES.includes(id) ? `\0${id}` : null;
        },
        async load(id) {
            if (id === `\0${CONFIG_MODULE}`) {
                // The file itself, not a serialized copy: `tokenName` and `icons.name` are functions that run in the
                // preview. Validation happens where it's read (figma/project.ts) and, before a run, in the CLI.
                const { file } = await loadProjectConfig(root);

                return file ? `export { default } from ${JSON.stringify(file)};` : 'export default undefined;';
            }
            if (id === `\0${ICONS_MODULE}`) {
                const { config } = await loadProjectConfig(root);
                // Root-relative, so Vite resolves the glob against the project, not this virtual module.
                const glob = `/${config.icons.glob.replace(/^\.?\//, '')}`;

                return `export default import.meta.glob(${JSON.stringify(glob)}, { query: '?raw', import: 'default', eager: true });`;
            }

            return null;
        },
    };
}
