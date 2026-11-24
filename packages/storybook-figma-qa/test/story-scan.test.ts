// Pure logic: which story files a run collects, and which stories a filter selects. The CLI proves the same rules end
// to end in the fixtures (local-report.test.ts).
import { describe, expect, it } from 'vitest';
import { parseFilters, scanStoryFile, selectStories, storyNameFromExport } from '../src/figma/story-scan.ts';

const SWATCH = `
import preview from '../.storybook/preview.ts';
import { Swatch } from './Swatch.tsx';

const meta = preview.meta({
    title: 'Swatch/Figma',
    component: Swatch,
    tags: ['figma', '!autodocs'],
});

export const Matrix = meta.story({});
export const NoDesignEntry = meta.story({});
`;

describe('scanStoryFile', () => {
    it('reads a literal figma tag, the title, the component and the story ids', () => {
        expect(scanStoryFile('src/Swatch.figma.stories.tsx', SWATCH)).toEqual({
            file: 'src/Swatch.figma.stories.tsx',
            figma: true,
            title: 'Swatch/Figma',
            component: 'Swatch',
            storyIds: ['swatch-figma--matrix', 'swatch-figma--no-design-entry'],
        });
    });

    it('skips files whose tags are all literals without figma, or that have no tags', () => {
        expect(scanStoryFile('a.stories.tsx', `const meta = { tags: ['autodocs', "!figma"] };`).figma).toBe(false);
        expect(scanStoryFile('b.stories.tsx', `export default { title: 'B' };`).figma).toBe(false);
    });

    it('includes files with a tag it cannot read statically', () => {
        expect(scanStoryFile('a.stories.tsx', `const meta = { tags: FIGMA_TAGS };`).figma).toBe(true);
        expect(scanStoryFile('b.stories.tsx', `const meta = { tags: [...base, 'x'] };`).figma).toBe(true);
        expect(scanStoryFile('c.stories.tsx', `const meta = { tags: [TAG] };`).figma).toBe(true);
    });

    it('finds figma in any tags array, double-quoted or templated, across lines', () => {
        const source = `const meta = { tags: ['autodocs'] };\nexport const A = { tags: [\n    "x",\n    \`figma\`,\n] };`;

        expect(scanStoryFile('a.stories.tsx', source).figma).toBe(true);
    });

    it('has no ids when the title is not a literal', () => {
        const scanned = scanStoryFile('src/Auto.figma.stories.tsx', `const meta = { tags: ['figma'] };\nexport const A = {};`);

        expect(scanned.title).toBeNull();
        expect(scanned.storyIds).toBeNull();
    });
});

describe('selectStories', () => {
    const files = [
        scanStoryFile('src/Swatch.figma.stories.tsx', SWATCH),
        scanStoryFile(
            'src/Odd.figma.stories.tsx',
            `const meta = { title: 'Swatch/Figma misconfigured', tags: ['figma'] };\nexport const NoMatrix = {};`
        ),
        scanStoryFile('src/Glyph.figma.stories.tsx', `const meta = { title: 'Glyph/Figma', component: Glyph, tags: T };`),
        scanStoryFile('src/Auto.figma.stories.tsx', `const meta = { tags: ['figma'] };\nexport const A = {};`),
    ];

    function selected(filters: string[]) {
        const selection = selectStories(files, parseFilters(filters));

        return { files: selection.files.map((file) => {
            return file.file;
        }), ids: selection.ids };
    }

    it('keeps every Figma story file without filters', () => {
        expect(selected([])).toEqual({ files: files.map((file) => {
            return file.file;
        }), ids: null });
    });

    it('matches a component name against the component, the title or a segment, or the file name, any case', () => {
        expect(selected(['swatch']).files).toEqual(['src/Swatch.figma.stories.tsx', 'src/Odd.figma.stories.tsx']);
        expect(selected(['Glyph']).files).toEqual(['src/Glyph.figma.stories.tsx']);
        expect(selected(['Auto']).files).toEqual(['src/Auto.figma.stories.tsx']);
        expect(selected(['Odd.figma']).files).toEqual(['src/Odd.figma.stories.tsx']);
    });

    it('matches a story-id glob against static ids and keeps files it cannot read', () => {
        expect(selected(['swatch-figma--matrix'])).toEqual({
            files: ['src/Swatch.figma.stories.tsx', 'src/Auto.figma.stories.tsx'],
            ids: { globs: ['swatch-figma--matrix'], files: [] },
        });
        expect(selected(['*--no-matrix']).files).toEqual(['src/Odd.figma.stories.tsx', 'src/Auto.figma.stories.tsx']);
    });

    it('runs whole files a component name matched beside an id glob', () => {
        expect(selected(['Glyph', 'swatch-figma--matrix']).ids).toEqual({
            globs: ['swatch-figma--matrix'],
            files: ['src/Glyph.figma.stories.tsx'],
        });
    });

    it('selects nothing when no file matches', () => {
        expect(selected(['Nope']).files).toEqual([]);
    });
});

describe('storyNameFromExport', () => {
    it('splits export names the way Storybook names stories', () => {
        expect(storyNameFromExport('NoDesignEntry')).toBe('No Design Entry');
        expect(storyNameFromExport('size_2XL')).toBe('Size 2 XL');
        expect(storyNameFromExport('HTMLButton')).toBe('HTML Button');
    });
});

describe('parseFilters', () => {
    it('treats a filter with *, ? or -- as a story-id glob, the rest as component names', () => {
        expect(parseFilters(['Swatch', 'swatch-figma--*', 'a?b', 'x--y'])).toEqual({
            components: ['Swatch'],
            globs: ['swatch-figma--*', 'a?b', 'x--y'],
        });
    });
});
