// `figma-qa doctor`: setup checks, one line each. Exit 2 when a check blocks a run; warnings keep exit 0.
import { glob } from 'tinyglobby';
import { CONFIG_FILE } from '../figma/config.ts';
import { loadProjectConfig } from '../node/config.ts';

export async function doctor(): Promise<number> {
    const root = process.cwd();
    let loaded;
    try {
        loaded = await loadProjectConfig(root);
    } catch (error) {
        console.error(`figma-qa doctor: ${error instanceof Error ? error.message : String(error)}`);

        return 2;
    }
    const { file, config } = loaded;
    console.log(`ok    config: ${file ? CONFIG_FILE : `no ${CONFIG_FILE}, defaults apply`}`);
    // Same glob syntax Vite's `import.meta.glob` serves the preview (both use tinyglobby).
    const icons = await glob(config.icons.glob, { cwd: root });
    if (icons.length > 0) {
        console.log(`ok    icons: ${icons.length} match ${config.icons.glob}`);
    } else {
        console.log(`warn  icons: none match ${config.icons.glob}; Figma cells render without glyphs (set icons.glob)`);
    }
    console.log('figma-qa doctor: done');

    return 0;
}
