// Storybook preset (Node). Storybook finds `./manager` and `./preview` through the package exports itself; this
// preset adds the config and icons virtual modules and the results dev route, and records where `storybook dev` serves.
import type { InlineConfig } from 'vite';
import { figmaQaVitePlugin } from './node/vite-plugin.ts';

/** The preset options this reads; Storybook sets `localAddress` for `storybook dev` once its port is final. */
type PresetOptions = { configType?: string; localAddress?: string };

export function viteFinal(config: InlineConfig, options: PresetOptions = {}): InlineConfig {
    const storybookUrl = options.configType === 'DEVELOPMENT' ? options.localAddress : undefined;

    return { ...config, plugins: [...(config.plugins ?? []), figmaQaVitePlugin({ storybookUrl })] };
}
