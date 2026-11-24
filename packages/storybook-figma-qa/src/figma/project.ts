// The project's config and icons in the preview, from the kit's virtual modules. Resolved on first use, not on import:
// a broken config fails the Figma stories that read it (the CLI rejects it before a run), not the whole preview.
import type { ResolvedConfig } from '../config.ts';
import rawConfig from 'virtual:figma-qa/config';
import iconFiles from 'virtual:figma-qa/icons';
import { resolveConfig } from '../config.ts';

let config: ResolvedConfig | null = null;

export function projectConfig(): ResolvedConfig {
    config ??= resolveConfig(rawConfig);

    return config;
}

/** Raw SVG per icon file name without `.svg` (`chevron-down`). */
export const projectIcons: ReadonlyMap<string, string> = new Map(
    Object.entries(iconFiles).map(([file, svg]) => {
        return [file.slice(file.lastIndexOf('/') + 1).replace(/\.svg$/, ''), svg];
    })
);
