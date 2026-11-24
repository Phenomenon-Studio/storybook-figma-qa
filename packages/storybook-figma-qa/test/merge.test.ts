// Pure logic: `figma-qa init`'s config merges on source text. Safe and unsafe shapes: ticket 02 `## Answer`.
import type { MergeResult } from '../src/node/merge.ts';
import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME as KIT } from '../src/constants.ts';
import { mergeMain, mergePreview, mergeVitest } from '../src/node/merge.ts';

function merged(result: MergeResult): string {
    if (result.status !== 'merged') {
        throw new Error(`Expected a merge, got ${JSON.stringify(result)}`);
    }

    return result.code;
}

/** A merge result merged again is a no-op: re-running init changes nothing. */
function mergedOnce(merge: (source: string) => MergeResult, source: string): string {
    const code = merged(merge(source));
    expect(merge(code)).toEqual({ status: 'present' });

    return code;
}

describe('mergeMain', () => {
    it('appends the kit to a typed config const', () => {
        const code = mergedOnce(
            mergeMain,
            [
                "import type { StorybookConfig } from '@storybook/react-vite';",
                '',
                'const config: StorybookConfig = {',
                "    framework: '@storybook/react-vite',",
                "    addons: ['@storybook/addon-vitest'],",
                '};',
                '',
                'export default config;',
            ].join('\n')
        );

        // recast may break the touched array over lines; init does not format.
        expect(code).toMatch(/addons: \[\s*'@storybook\/addon-vitest',\s*'@phenomenon-studio\/storybook-figma-qa',?\s*\]/);
    });

    it.each([
        ['export default { addons: [] };'],
        ["export default { addons: [] } satisfies StorybookConfig;"],
        ['export default defineMain({ addons: [] });'],
    ])('appends to %s', (source) => {
        expect(mergedOnce(mergeMain, source)).toContain(`'${KIT}'`);
    });

    it('adds an addons key when there is none', () => {
        expect(mergedOnce(mergeMain, "export default { framework: '@storybook/react-vite' };")).toMatch(
            /addons: \['@phenomenon-studio\/storybook-figma-qa'\]/
        );
    });

    it('keeps a double-quoted file double-quoted', () => {
        expect(mergedOnce(mergeMain, 'export default { framework: "@storybook/react-vite", addons: [] };')).toContain(
            `"${KIT}"`
        );
    });

    it.each([
        [`export default { addons: [{ name: '${KIT}' }] };`],
        [`export default { addons: [getAbsolutePath('${KIT}')] };`],
        [`export default { addons: [{ name: '${KIT}', options: {} }] };`],
    ])('sees the kit already present in %s', (source) => {
        expect(mergeMain(source)).toEqual({ status: 'present' });
    });

    it('appends after entries of other shapes', () => {
        const code = mergedOnce(
            mergeMain,
            "export default { addons: [{ name: '@storybook/addon-docs', options: {} }, getAbsolutePath('@storybook/addon-a11y')] };"
        );

        expect(code).toContain(`'${KIT}'`);
    });

    it.each([
        ['addons is a variable', 'const addons = []; export default { addons };'],
        ['addons holds a spread', 'export default { addons: [...base.addons] };'],
        ['the object spreads with no addons key', 'export default { ...base };'],
        ['the export is a function', 'export default async function main() { return {}; }'],
        ['main is CommonJS', 'module.exports = { addons: [] };'],
    ])('refuses when %s', (_shape, source) => {
        const result = mergeMain(source);

        expect(result.status).toBe('unsafe');
        expect(result.status === 'unsafe' && result.snippet).toContain(`'${KIT}'`);
    });
});

describe('mergePreview', () => {
    it('imports the kit preview and appends it to definePreview addons', () => {
        const code = mergedOnce(
            mergePreview,
            [
                "import { definePreview } from '@storybook/react-vite';",
                "import addonA11y from '@storybook/addon-a11y';",
                '',
                'export default definePreview({',
                '    addons: [addonA11y()],',
                '});',
            ].join('\n')
        );

        expect(code).toContain(`import figmaQa from '${KIT}/preview';`);
        expect(code).toContain('addons: [addonA11y(), figmaQa()]');
    });

    it.each([
        ['export default definePreview({});'],
        ['export default definePreview({ parameters: {} });'],
        ['const preview = definePreview({ addons: [] });\nexport default preview;'],
    ])('adds the kit to %s', (source) => {
        expect(mergedOnce(mergePreview, source)).toContain('figmaQa()');
    });

    it('sees the kit imported under another local name', () => {
        const source = `import qa from '${KIT}/preview';\nexport default definePreview({ addons: [qa()] });`;

        expect(mergePreview(source)).toEqual({ status: 'present' });
    });

    it('calls an existing kit import that addons lacks', () => {
        const source = `import qa from '${KIT}/preview';\nexport default definePreview({ addons: [] });`;
        const code = mergedOnce(mergePreview, source);

        expect(code).toContain('addons: [qa()]');
        expect(code.match(/storybook-figma-qa\/preview/g)).toHaveLength(1);
    });

    it('picks a free local name when figmaQa is taken', () => {
        const source = "import figmaQa from 'elsewhere';\nexport default definePreview({ addons: [] });";
        const code = mergedOnce(mergePreview, source);

        expect(code).toContain(`import figmaQa2 from '${KIT}/preview';`);
        expect(code).toContain('addons: [figmaQa2()]');
    });

    it('leaves a classic preview to the preset', () => {
        const source = "import type { Preview } from '@storybook/react-vite';\nconst preview: Preview = {};\nexport default preview;";

        expect(mergePreview(source)).toEqual({ status: 'classic' });
    });

    it.each([
        ['definePreview takes a variable', 'export default definePreview(config);'],
        ['addons holds a spread', 'export default definePreview({ addons: [...base] });'],
    ])('refuses when %s', (_shape, source) => {
        const result = mergePreview(source);

        expect(result.status).toBe('unsafe');
        expect(result.status === 'unsafe' && result.snippet).toContain(`import figmaQa from '${KIT}/preview';`);
    });
});

describe('mergeVitest', () => {
    const template = [
        "import path from 'node:path';",
        "import { defineConfig } from 'vitest/config';",
        "import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';",
        '',
        'export default defineConfig({',
        '  test: {',
        '    projects: [',
        '      {',
        "        plugins: [storybookTest({ configDir: path.join(import.meta.dirname, '.storybook') })],",
        "        test: { name: 'storybook' },",
        '      },',
        '    ],',
        '  },',
        '});',
    ].join('\n');

    it('appends the kit project to the addon-vitest template, leaving its project untouched', () => {
        const code = mergedOnce(mergeVitest, template);

        expect(code).toContain(`import { figmaQa } from '${KIT}/vitest';`);
        expect(code).toMatch(/figmaQa\(\)\]/);
        expect(code).toContain("plugins: [storybookTest({ configDir: path.join(import.meta.dirname, '.storybook') })],");
    });

    it.each([
        ['export default defineConfig({ plugins: [], test: { projects: [] } });'],
        ['export default mergeConfig(viteConfig, defineConfig({ test: { projects: [] } }));'],
        ["export default defineConfig({ test: { projects: ['packages/*'] } });"],
    ])('appends to %s', (source) => {
        expect(mergedOnce(mergeVitest, source)).toContain('figmaQa()');
    });

    it.each([
        ['the config is a function', 'export default defineConfig(({ mode }) => { return { test: { projects: [] } }; });'],
        ['test has no projects', "export default defineConfig({ test: { browser: { enabled: true } } });"],
        ['there is no test block', 'export default defineConfig({ plugins: [] });'],
        ['projects is a variable', 'export default defineConfig({ test: { projects } });'],
    ])('refuses when %s', (_shape, source) => {
        const result = mergeVitest(source);

        expect(result.status).toBe('unsafe');
        expect(result.status === 'unsafe' && result.snippet).toContain(`import { figmaQa } from '${KIT}/vitest';`);
    });
});
