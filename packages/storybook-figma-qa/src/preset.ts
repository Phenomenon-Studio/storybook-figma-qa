// Storybook preset (Node). Storybook finds `./manager` and `./preview` through the package exports itself; this
// preset adds the config and icons virtual modules (and, later, the results dev route).
import type { InlineConfig } from 'vite';
import { figmaQaVitePlugin } from './node/vite-plugin.ts';

export function viteFinal(config: InlineConfig): InlineConfig {
    return { ...config, plugins: [...(config.plugins ?? []), figmaQaVitePlugin()] };
}
