// `figma-qa.config.ts`: the project's optional overrides, `export default defineConfig({ … })`. Every key has a
// default, so most projects have no file. Read by the CLI (Node, through Vite) and by the preview (a virtual module),
// so the hooks run where the comparison does. Browser-safe: no Node imports.
import type { FigmaVariable } from './figma/variables.ts';

export type { FigmaVariable } from './figma/variables.ts';

export type FigmaQaConfig = {
    tokens?: {
        /** Custom properties read as colour tokens from the preview's stylesheets. Default `--color-`. */
        prefix?: string;
    };
    /** The CSS token a Figma colour variable is expected as. Default: the full path kebab-cased, after the prefix. */
    tokenName?: (variable: FigmaVariable) => string;
    icons?: {
        /** Project SVG icons, relative to the project root. Default `src/assets/icons/*.svg`. */
        glob?: string;
        /** Figma glyph component name → icon file name without `.svg`. Default: last path segment kebab-cased. */
        name?: (figmaName: string) => string;
    };
    /** Committed Figma refs, relative to the project root. Default `figma-qa/__refs__`. */
    refsDir?: string;
    /**
     * Share of differing pixels a cell may have. Default 0.05: text anti-aliasing alone differs on ~3 % of pixels
     * (Figma's text renderer ≠ Chromium's). A story's `figmaMatrix.maxDiffRatio` wins.
     */
    maxDiffRatio?: number;
};

export type ResolvedConfig = {
    tokens: { prefix: string };
    tokenName: (variable: FigmaVariable) => string;
    icons: { glob: string; name: (figmaName: string) => string };
    refsDir: string;
    maxDiffRatio: number;
};

/** Types the config file: `export default defineConfig({ … })`. */
export function defineConfig(config: FigmaQaConfig): FigmaQaConfig {
    return config;
}

/** The config file's name, at the project root. */
export const CONFIG_FILE = 'figma-qa.config.ts';

/** A config the kit can't use: a setup error (exit 2). */
export class FigmaQaConfigError extends Error {
    override name = 'FigmaQaConfigError';
}

function kebab(text: string): string {
    return text
        .replaceAll('%', '')
        .replaceAll(/([a-z\d])([A-Z])/g, '$1-$2')
        .replaceAll(/[^A-Za-z\d]+/g, '-')
        .replaceAll(/^-|-$/g, '')
        .toLowerCase();
}

/** Default icon name: `Icons/Chevron Down` → `chevron-down`, `StarFour` → `star-four`. */
export function iconName(figmaName: string): string {
    return kebab(figmaName.split('/').pop() ?? figmaName);
}

/** Default token name: `Surface/control` → `--color-surface-control`; `%` dropped. */
function defaultTokenName(prefix: string): (variable: FigmaVariable) => string {
    return (variable) => {
        return `${prefix}${kebab(variable.name.toLowerCase())}`;
    };
}

const KEYS = ['tokens', 'tokenName', 'icons', 'refsDir', 'maxDiffRatio'];
const TOKENS_KEYS = ['prefix'];
const ICONS_KEYS = ['glob', 'name'];

function fail(message: string): never {
    throw new FigmaQaConfigError(`${CONFIG_FILE}: ${message}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Typos must not silently do nothing. */
function onlyKeys(value: Record<string, unknown>, allowed: string[], path: string): void {
    for (const key of Object.keys(value)) {
        if (!allowed.includes(key)) {
            fail(`unknown key "${path}${key}" (allowed: ${allowed.join(', ')}).`);
        }
    }
}

function section(value: unknown, name: string, allowed: string[]): Record<string, unknown> {
    if (value === undefined) {
        return {};
    }
    if (!isObject(value)) {
        fail(`"${name}" must be an object.`);
    }
    onlyKeys(value, allowed, `${name}.`);

    return value;
}

function text(value: unknown, name: string, fallback: string): string {
    if (value === undefined) {
        return fallback;
    }
    if (typeof value !== 'string' || value === '') {
        fail(`"${name}" must be a non-empty string.`);
    }

    return value;
}

function hook<T>(value: unknown, name: string, fallback: T): T {
    if (value === undefined) {
        return fallback;
    }
    if (typeof value !== 'function') {
        fail(`"${name}" must be a function.`);
    }

    return value as T;
}

/** The config file's default export, validated, with every default filled in. Throws FigmaQaConfigError. */
export function resolveConfig(raw: unknown): ResolvedConfig {
    if (raw === undefined) {
        raw = {};
    }
    if (!isObject(raw)) {
        fail('must export an object: `export default defineConfig({ … })`.');
    }
    onlyKeys(raw, KEYS, '');
    const tokens = section(raw.tokens, 'tokens', TOKENS_KEYS);
    const icons = section(raw.icons, 'icons', ICONS_KEYS);
    const prefix = tokens.prefix ?? '--color-';
    if (typeof prefix !== 'string' || !prefix.startsWith('--')) {
        fail('"tokens.prefix" must be a string starting with "--".');
    }
    const maxDiffRatio = raw.maxDiffRatio ?? 0.05;
    if (typeof maxDiffRatio !== 'number' || !(maxDiffRatio >= 0 && maxDiffRatio <= 1)) {
        fail('"maxDiffRatio" must be a number from 0 to 1.');
    }

    return {
        tokens: { prefix },
        tokenName: hook(raw.tokenName, 'tokenName', defaultTokenName(prefix)),
        icons: {
            glob: text(icons.glob, 'icons.glob', 'src/assets/icons/*.svg'),
            name: hook(icons.name, 'icons.name', iconName),
        },
        refsDir: text(raw.refsDir, 'refsDir', 'figma-qa/__refs__'),
        maxDiffRatio,
    };
}
