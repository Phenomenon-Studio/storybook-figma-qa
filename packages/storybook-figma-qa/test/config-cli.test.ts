// `figma-qa.config.ts` through the real CLI: each fixture runs once with no config (every default) and once with a
// config that changes every key. The config is written for the test and removed after, so the committed fixtures stay
// the no-config case.
import type { Fixture, StoryResult } from './cli.ts';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fixtureDir, FIXTURES, report, runCli, storyResult } from './cli.ts';

const CONFIG = 'figma-qa.config.ts';
const DEFAULT_REFS = 'figma-qa/__refs__';
const CUSTOM_REFS = 'design/refs';

/** Every key off its default; the fixture's `--swatch-*` aliases and `src/glyphs/glyph-*.svg` exist for it. */
const CUSTOM_CONFIG = `import { defineConfig, iconName } from '@phenomenon-studio/storybook-figma-qa/config';

export default defineConfig({
    tokens: { prefix: '--swatch-' },
    tokenName: (variable) => {
        return \`--swatch-\${iconName(variable.name)}\`;
    },
    icons: {
        glob: 'src/glyphs/*.svg',
        name: (figma) => {
            return \`glyph-\${iconName(figma)}\`;
        },
    },
    refsDir: '${CUSTOM_REFS}',
    maxDiffRatio: 0.2,
});
`;

type Cell = {
    status: string;
    variant: { name: string };
    image: { maxRatio: number };
    files: { figma: string };
    spec: { mismatches: { property: string; expected: { note?: string }; actual: { note?: string } }[] };
};

function cells(result: StoryResult): Cell[] {
    return result.blocks.flatMap((block) => {
        return block.cells as unknown as Cell[];
    });
}

async function run(fixture: Fixture, story: string) {
    const { code, stderr, summary } = await report(fixture, [story]);
    const result = await storyResult(fixture, summary.stories[0]?.results ?? null);

    return { code, stderr, summary, cells: cells(result) };
}

/** Neutral's fill row: bound to `Tone/Neutral`, and the fixture's deliberate deviation. */
function neutralBackground(found: Cell[]) {
    const cell = found.find((each) => {
        return each.variant.name === 'Size=Small, Tone=Neutral';
    });

    return cell?.spec.mismatches.find((issue) => {
        return issue.property === 'Background';
    });
}

describe.each(FIXTURES)('figma-qa config in fixtures/%s', (fixture) => {
    const root = fixtureDir(fixture);

    afterEach(async () => {
        await rm(path.join(root, CONFIG), { force: true });
        await rename(path.join(root, CUSTOM_REFS), path.join(root, DEFAULT_REFS)).catch(() => {});
        await rm(path.join(root, 'design'), { recursive: true, force: true });
    });

    describe('without a config', () => {
        it('doctor reports defaults and warns that no icons are found', async () => {
            const result = await runCli(fixture, ['doctor']);

            expect(result.code, result.stderr).toBe(0);
            expect(result.stdout).toContain(`no ${CONFIG}, defaults apply`);
            expect(result.stdout).toContain('warn  icons: none match src/icons/*.svg');
        });

        it('uses the default refs dir, ratio, token prefix and token name', async () => {
            const { code, stderr, cells: found } = await run(fixture, 'SwatchDrift.figma');

            expect(code, stderr).toBe(1);
            for (const cell of found) {
                expect(cell.files.figma.startsWith(`${DEFAULT_REFS}/`)).toBe(true);
                expect(cell.image.maxRatio).toBe(0.05);
            }
            const row = neutralBackground(found);
            // Default name `--color-tone-neutral` isn't a kit token.
            expect(row?.expected.note).toContain('var Tone/Neutral · no kit token by that name');
            expect(row?.actual.note).toBe('= --color-neutral');
        });

        it('renders cells without glyphs when no icons are found', async () => {
            const { code, stderr, cells: found } = await run(fixture, 'Glyph.figma');

            expect(code, stderr).toBe(1);
            for (const cell of found) {
                expect(cell.status).toBe('fail');
                expect(
                    cell.spec.mismatches.map((issue) => {
                        return issue.property;
                    })
                ).toContain('Count');
            }
        });
    });

    describe('with a config changing every key', () => {
        async function configure() {
            await writeFile(path.join(root, CONFIG), CUSTOM_CONFIG);
            await mkdir(path.join(root, 'design'), { recursive: true });
            await rename(path.join(root, DEFAULT_REFS), path.join(root, CUSTOM_REFS));
        }

        it('doctor finds the configured icons', async () => {
            await configure();

            const result = await runCli(fixture, ['doctor']);

            expect(result.code, result.stderr).toBe(0);
            expect(result.stdout).toContain(`config: ${CONFIG}`);
            expect(result.stdout).toContain('ok    icons: 2 match src/glyphs/*.svg');
        });

        it('reads refs from refsDir, applies maxDiffRatio, the token prefix and tokenName', async () => {
            await configure();

            const { code, stderr, cells: found } = await run(fixture, 'SwatchDrift.figma');

            expect(code, stderr).toBe(1);
            for (const cell of found) {
                expect(cell.files.figma.startsWith(`${CUSTOM_REFS}/`)).toBe(true);
                expect(cell.image.maxRatio).toBe(0.2);
            }
            const row = neutralBackground(found);
            expect(row?.expected.note).toMatch(/^var Tone\/Neutral = --swatch-neutral \(kit value /);
            // `--swatch-neutral` is `var(--color-neutral)`: the alias resolves.
            expect(row?.actual.note).toBe('= --swatch-neutral');
        });

        it('renders glyphs from the icons glob, named by icons.name', async () => {
            await configure();

            const { code, stderr, cells: found } = await run(fixture, 'Glyph.figma');

            expect(code, stderr).toBe(0);
            expect(
                found.map((cell) => {
                    return cell.status;
                })
            ).toEqual(['pass', 'pass']);
        });
    });

    describe('with an invalid config', () => {
        it.each([
            ['an unknown key', '{ refDir: "refs" }', 'unknown key "refDir"'],
            ['a wrong type', '{ maxDiffRatio: "0.1" }', '"maxDiffRatio" must be a number from 0 to 1'],
        ])('report and doctor exit 2 for %s', async (_case, body, message) => {
            await writeFile(path.join(root, CONFIG), `export default ${body};\n`);

            const { code, summary } = await report(fixture, ['Swatch.figma']);
            expect(code).toBe(2);
            expect(summary.stories).toEqual([]);
            expect(summary.errors).toEqual([expect.stringContaining(message)]);

            const doctor = await runCli(fixture, ['doctor']);
            expect(doctor.code).toBe(2);
            expect(doctor.stderr).toContain(message);
        });
    });
});
