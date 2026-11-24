// Seam 1: `figma-qa init` run the way a consumer runs it. Set-up flows run in clean copies of both fixtures (the kit
// wiring stripped, node_modules linked); refusals and plans run the kit's build in throwaway projects.
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { glob } from 'tinyglobby';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { VITEST_SNIPPET } from '../src/node/merge.ts';
import { REGISTRY_LINE, RULES_BLOCK } from '../src/node/project-text.ts';
import { type Fixture, fixtureDir, FIXTURES, KIT_BIN, runIn } from './cli.ts';

const KIT = '@phenomenon-studio/storybook-figma-qa';
const SKILLS_ADD = `npx -y skills@1.9.0 add ./node_modules/${KIT}/skills --copy -y -a claude-code codex`;
/** The skills CLI fetches from npm on first install. */
const INSTALL_TIMEOUT = 300_000;

async function snapshot(dir: string): Promise<Record<string, string>> {
    const files = await glob('**/*', { cwd: dir, dot: true, ignore: ['node_modules', 'node_modules/**'] });
    const entries = await Promise.all(
        files.map(async (file) => {
            const hash = createHash('sha1')
                .update(await readFile(path.join(dir, file)))
                .digest('hex');

            return [file, hash] as const;
        })
    );

    return Object.fromEntries(entries);
}

function changedFiles(before: Record<string, string>, after: Record<string, string>): string[] {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
        .filter((file) => {
            return before[file] !== after[file];
        })
        .sort();
}

async function writeFiles(dir: string, files: Record<string, string>) {
    for (const [file, content] of Object.entries(files)) {
        await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
        await writeFile(path.join(dir, file), content);
    }
}

/**
 * The fixture as `storybook init` + `storybook add @storybook/addon-vitest` leave it: no kit in main, preview or the
 * addon-vitest Vitest template, no report script, no rules, `.npmrc` with an unrelated line.
 */
async function cleanCopy(fixture: Fixture): Promise<string> {
    const source = fixtureDir(fixture);
    const dir = await mkdtemp(path.join(tmpdir(), `figma-qa-init-${fixture}-`));
    await cp(source, dir, {
        recursive: true,
        filter: (file) => {
            return !/^(node_modules|storybook-static|figma-qa\/\.results)(\/|$)/.test(path.relative(source, file));
        },
    });
    await symlink(path.join(source, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
    const main = await readFile(path.join(dir, '.storybook/main.ts'), 'utf8');
    const template = await readFile(
        path.join(source, 'node_modules/@storybook/addon-vitest/templates/vitest.config.4.template.ts'),
        'utf8'
    );
    const packageJson = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')) as {
        scripts: Record<string, string>;
    };
    delete packageJson.scripts['figma-report'];
    await writeFiles(dir, {
        '.storybook/main.ts': main
            .replace(/^.*`figma-qa init`.*\n/m, '')
            .replace(`addons: ['${KIT}']`, "addons: ['@storybook/addon-vitest']"),
        '.storybook/preview.ts': [
            "import { definePreview } from '@storybook/react-vite';",
            "import '../src/tokens.css';",
            '',
            'export default definePreview({});',
            '',
        ].join('\n'),
        'vitest.config.ts': template.replace('CONFIG_DIR', '.storybook'),
        'package.json': `${JSON.stringify(packageJson, null, 4)}\n`,
        'AGENTS.md': '# Fixture\n\nProject rules.\n',
        'CLAUDE.md': '# Claude\n\nOwn rules, no AGENTS.md import.\n',
        '.npmrc': 'auto-install-peers=true\n',
    });

    return dir;
}

describe.each(FIXTURES)('figma-qa init on a clean copy of fixtures/%s', (fixture) => {
    let dir = '';

    /**
     * The copy's `figma-qa` bin, as `pnpm exec` would run it: pnpm itself, outside this workspace, would first try
     * to install the copy's `workspace:*` dependency.
     */
    async function figmaQa(args: string[]) {
        return await runIn(dir, [path.join(dir, 'node_modules/.bin/figma-qa'), ...args]);
    }

    beforeAll(async () => {
        dir = await cleanCopy(fixture);
    });

    afterAll(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it('--dry-run prints the plan and writes nothing', async () => {
        const before = await snapshot(dir);

        const result = await figmaQa(['init', '--dry-run']);

        expect(result.code, result.stderr).toBe(0);
        expect(result.stdout).toContain('ok    storybook: ');
        expect(result.stdout).toContain(`write .npmrc: ${REGISTRY_LINE}`);
        expect(result.stdout).toContain('write .storybook/main.ts: kit in addons');
        expect(result.stdout).toContain('write .storybook/preview.ts: kit in definePreview addons');
        expect(result.stdout).toContain('write vitest.config.ts: figmaQa() in test.projects');
        expect(result.stdout).toContain('write package.json: "figma-report": "figma-qa report"');
        expect(result.stdout).toContain('write AGENTS.md: figma-qa rules block');
        expect(result.stdout).toContain('write CLAUDE.md: figma-qa rules block');
        expect(result.stdout).toContain(`run   ${SKILLS_ADD}`);
        expect(await snapshot(dir)).toEqual(before);
    });

    it(
        '--yes wires the kit, rules, registry line and skills, and touches nothing else',
        async () => {
            const before = await snapshot(dir);

            const result = await figmaQa(['init', '--yes']);

            expect(result.code, result.stderr).toBe(0);
            expect(changedFiles(before, await snapshot(dir))).toEqual([
                '.agents/skills/figma-qa/SKILL.md',
                '.claude/skills/figma-qa/SKILL.md',
                '.npmrc',
                '.storybook/main.ts',
                '.storybook/preview.ts',
                'AGENTS.md',
                'CLAUDE.md',
                'package.json',
                'skills-lock.json',
                'vitest.config.ts',
            ]);
            const read = async (file: string) => {
                return await readFile(path.join(dir, file), 'utf8');
            };
            expect(await read('.npmrc')).toBe(`auto-install-peers=true\n${REGISTRY_LINE}\n`);
            expect(await read('AGENTS.md')).toBe(`# Fixture\n\nProject rules.\n\n${RULES_BLOCK}\n`);
            expect(await read('CLAUDE.md')).toContain(RULES_BLOCK);
            // The addon-vitest project stays as it was, next to the kit's.
            const vitest = await read('vitest.config.ts');
            expect(vitest).toContain(`import { figmaQa } from '${KIT}/vitest';`);
            expect(vitest).toContain("name: 'storybook'");
            expect(vitest).toMatch(/figmaQa\(\)\]/);
            expect(JSON.parse(await read('package.json')).scripts['figma-report']).toBe('figma-qa report');
            expect(JSON.parse(await read('skills-lock.json'))).toMatchObject({
                skills: { 'figma-qa': { source: `./node_modules/${KIT}/skills` } },
            });

            const doctor = await figmaQa(['doctor']);

            expect(doctor.code, doctor.stdout + doctor.stderr).toBe(0);
            expect(doctor.stdout).toContain('ok    setup:');
        },
        INSTALL_TIMEOUT
    );

    it('re-run on the set-up project changes nothing', async () => {
        const before = await snapshot(dir);

        const result = await figmaQa(['init', '--yes']);

        expect(result.code, result.stderr).toBe(0);
        expect(result.stdout).not.toMatch(/^(write|run|edit) /m);
        expect(await snapshot(dir)).toEqual(before);
    });
});

describe('figma-qa init in other projects', () => {
    let dir = '';

    beforeEach(async () => {
        dir = await mkdtemp(path.join(tmpdir(), 'figma-qa-init-'));
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    async function init(args: string[]) {
        return await runIn(dir, ['node', KIT_BIN, 'init', ...args]);
    }

    function packageJson(deps: Record<string, string>) {
        return JSON.stringify({ name: 'app', private: true, type: 'module', devDependencies: deps });
    }

    const reactVite = { react: '19.3.1', vite: '8.3.8' };
    const reactViteMain = "export default { framework: '@storybook/react-vite', stories: [] };\n";

    it('bootstraps Storybook 10 with the official init when there is none', async () => {
        await writeFiles(dir, { 'package.json': packageJson(reactVite) });
        const before = await snapshot(dir);

        const latest = await init(['--dry-run']);
        const next = await init(['--dry-run', '--next']);

        expect(latest.code, latest.stderr).toBe(0);
        expect(latest.stdout).toContain(
            'run   npx -y storybook@^10 init --type react --builder vite --yes --no-dev --disable-telemetry'
        );
        expect(next.stdout).toContain('npx -y storybook@next init');
        expect(await snapshot(dir)).toEqual(before);
    });

    it('refuses a project that is not React + Vite, naming what is missing', async () => {
        await writeFiles(dir, { 'package.json': packageJson({ react: '19.3.1' }) });

        const result = await init(['--yes']);

        expect(result.code).toBe(2);
        expect(result.stderr).toContain('React + Vite project; package.json has react but no vite');
    });

    it('refuses Storybook before 10.6, pointing at storybook upgrade', async () => {
        await writeFiles(dir, {
            'package.json': packageJson({ ...reactVite, storybook: '^8.6.0', '@storybook/react-vite': '^8.6.0' }),
            'node_modules/storybook/package.json': JSON.stringify({ name: 'storybook', version: '8.6.14' }),
            '.storybook/main.ts': reactViteMain,
        });

        const result = await init(['--yes']);

        expect(result.code).toBe(2);
        expect(result.stderr).toContain('found Storybook 8.6.14; the kit needs 10.6 or later');
        expect(result.stderr).toContain('npx storybook@latest upgrade');
    });

    it('refuses another Storybook framework, naming it', async () => {
        await writeFiles(dir, {
            'package.json': packageJson({ react: '19.3.1', storybook: '10.6.8', '@storybook/nextjs-vite': '10.6.8' }),
            'node_modules/storybook/package.json': JSON.stringify({ name: 'storybook', version: '10.6.8' }),
            '.storybook/main.ts': "export default { framework: { name: '@storybook/nextjs-vite' } };\n",
        });

        const result = await init(['--yes']);

        expect(result.code).toBe(2);
        expect(result.stderr).toContain('.storybook/main.ts uses @storybook/nextjs-vite');
    });

    it('plans the kit and addon-vitest installs only when missing', async () => {
        await writeFiles(dir, {
            'package.json': packageJson({ ...reactVite, storybook: '10.6.8', '@storybook/react-vite': '10.6.8' }),
            'node_modules/storybook/package.json': JSON.stringify({ name: 'storybook', version: '10.6.8' }),
            '.storybook/main.ts': reactViteMain,
        });

        const result = await init(['--dry-run']);

        expect(result.code, result.stderr).toBe(0);
        expect(result.stdout).toMatch(new RegExp(`^run   \\w+ (add|install) -D ${KIT}@`, 'm'));
        expect(result.stdout).toContain('run   npx storybook add @storybook/addon-vitest --yes --disable-telemetry');
        expect(result.stdout).toContain('plan  npx -y skills@1.9.0 add <kit>/skills, after installing the kit');
    });

    it('prints the exact snippet and exits 2 on a config shape it must not edit', async () => {
        const skill = '---\nname: figma-qa\n---\n';
        await writeFiles(dir, {
            'package.json': JSON.stringify({
                name: 'app',
                scripts: { 'figma-report': 'figma-qa report' },
                devDependencies: {
                    ...reactVite,
                    storybook: '10.6.8',
                    '@storybook/react-vite': '10.6.8',
                    '@storybook/addon-vitest': '10.6.8',
                    [KIT]: '0.0.0',
                },
            }),
            'node_modules/storybook/package.json': JSON.stringify({ name: 'storybook', version: '10.6.8' }),
            [`node_modules/${KIT}/package.json`]: JSON.stringify({ name: KIT, version: '0.0.0' }),
            [`node_modules/${KIT}/skills/figma-qa/SKILL.md`]: skill,
            '.agents/skills/figma-qa/SKILL.md': skill,
            '.claude/skills/figma-qa/SKILL.md': skill,
            '.storybook/main.ts': `export default { framework: '@storybook/react-vite', addons: ['${KIT}'] };\n`,
            'vitest.config.ts': "export default defineConfig(({ mode }) => { return { test: { projects: [] } }; });\n",
            'AGENTS.md': `${RULES_BLOCK}\n`,
            '.npmrc': `${REGISTRY_LINE}\n`,
        });
        const before = await snapshot(dir);

        const result = await init(['--yes']);

        expect(result.code).toBe(2);
        expect(result.stdout).toContain('edit  vitest.config.ts: `defineConfig(…)` does not take an object literal');
        expect(result.stderr).toContain(`vitest.config.ts:\n${VITEST_SNIPPET}`);
        expect(await snapshot(dir)).toEqual(before);
    });
});
