// Seam 1: `figma-qa init` run the way a consumer runs it. Set-up flows run in clean copies of both fixtures (the kit
// wiring stripped, node_modules linked); refusals and plans run the kit's build in throwaway projects.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { glob } from 'tinyglobby';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { VITEST_SNIPPET } from '../src/node/merge.ts';
import { REGISTRY_LINE, RULES_BLOCK } from '../src/node/project-text.ts';
import { answering, type Fixture, fixtureDir, FIXTURES, KIT_BIN, runIn } from './cli.ts';
import { type FigmaStub, startFigmaStub } from './figma-stub.ts';

const KIT = '@phenomenon-studio/storybook-figma-qa';
const SKILLS_ADD = `npx -y skills@1.9.0 add ./node_modules/${KIT}/skills --copy -y -a claude-code codex`;
const SKILLS_SOURCE = path.join(import.meta.dirname, '../skills');
/** Every file the kit ships under `skills/`, sorted as `changedFiles` sorts. */
const SKILL_FILES = (await glob('**/*', { cwd: SKILLS_SOURCE, dot: true })).sort();
const FAKE_DOCKER = fileURLToPath(new URL('./fake-docker', import.meta.url));
/** The prompts a wizard run in a terminal may show. */
const PROMPTS = /FIGMA_TOKEN \(hidden|Pull the pinned browser image/;
/** The skills CLI fetches from npm on first install. */
const INSTALL_TIMEOUT = 300_000;

async function snapshot(dir: string): Promise<Record<string, string>> {
    const files = await glob('**/*', { cwd: dir, dot: true, ignore: ['node_modules', 'node_modules/**', '.git/**'] });
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
        return await figmaQaWith(args, {});
    }

    async function figmaQaWith(args: string[], env: Record<string, string>) {
        return await runIn(dir, [path.join(dir, 'node_modules/.bin/figma-qa'), ...args], env);
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
        expect(result.stdout).toContain('ok    figma-qa/__refs__: refs format 1, up to date');
        expect(result.stdout).not.toContain('figma-qa migrate:');
        expect(result.stdout).toContain(`run   ${SKILLS_ADD}`);
        // The PR check is the repo's choice: init prints the caller, never writes it.
        expect(result.stdout).toContain('todo  PR workflow: add .github/workflows/figma-qa.yml');
        expect(result.stdout).toContain('uses: Phenomenon-Studio/storybook-figma-qa/.github/workflows/figma-qa.yml@v');
        expect(await snapshot(dir)).toEqual(before);
    });

    it(
        '--yes wires the kit, rules, registry line and skills, and touches nothing else',
        async () => {
            const before = await snapshot(dir);

            const result = await figmaQa(['init', '--yes']);

            expect(result.code, result.stderr).toBe(0);
            expect(changedFiles(before, await snapshot(dir))).toEqual([
                ...['.agents', '.claude'].flatMap((agent) => {
                    return SKILL_FILES.map((file) => {
                        return `${agent}/skills/${file}`;
                    });
                }),
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
            for (const file of SKILL_FILES) {
                const kit = await readFile(path.join(SKILLS_SOURCE, file), 'utf8');
                expect(await read(`.agents/skills/${file}`)).toBe(kit);
                expect(await read(`.claude/skills/${file}`)).toBe(kit);
            }
            const fromKit = { source: `./node_modules/${KIT}/skills` };
            expect(JSON.parse(await read('skills-lock.json'))).toMatchObject({
                skills: { 'figma-qa': fromKit, 'figma-qa-scaffold': fromKit, 'figma-qa-variables': fromKit },
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

    it(
        'removes what a newer kit dropped from its skills, and leaves the project\'s own skills alone',
        async () => {
            const lockFile = path.join(dir, 'skills-lock.json');
            const lock = JSON.parse(await readFile(lockFile, 'utf8')) as { skills: Record<string, unknown> };
            const committedLock = await readFile(lockFile, 'utf8');
            // A skill an older kit shipped and this one doesn't, a file this kit dropped, and a skill of the project's.
            lock.skills['figma-qa-old'] = lock.skills['figma-qa'];
            lock.skills['own-skill'] = { source: 'someone/skills', sourceType: 'github' };
            // A lock entry is never an option to `skills remove`, and a symlink is never followed to delete.
            lock.skills['--all'] = lock.skills['figma-qa'];
            const outside = await mkdtemp(path.join(tmpdir(), 'figma-qa-outside-'));
            await writeFile(path.join(outside, 'keep.md'), 'Not the kit\'s.\n');
            await symlink(outside, path.join(dir, '.agents/skills/figma-qa/linked'), 'dir');
            await writeFile(lockFile, `${JSON.stringify(lock, null, 2)}\n`);
            for (const agent of ['.agents', '.claude']) {
                await writeFiles(dir, {
                    [`${agent}/skills/figma-qa-old/SKILL.md`]: '---\nname: figma-qa-old\ndescription: Old.\n---\n',
                    [`${agent}/skills/figma-qa/OLD.md`]: 'Dropped reference.\n',
                    [`${agent}/skills/own-skill/SKILL.md`]: '---\nname: own-skill\ndescription: Own.\n---\n',
                });
            }

            const result = await figmaQa(['init', '--yes']);

            expect(result.code, result.stderr).toBe(0);
            expect(result.stdout).toContain(`run   npx -y skills@1.9.0 remove figma-qa-old -y`);
            expect(await readFile(path.join(outside, 'keep.md'), 'utf8')).toBe('Not the kit\'s.\n');
            await rm(outside, { recursive: true, force: true });
            expect(result.stdout).toContain(`run   ${SKILLS_ADD}`);
            const files = await glob('{.agents,.claude}/skills/**/*', { cwd: dir, dot: true });
            expect(files.sort()).toEqual(
                ['.agents', '.claude']
                    .flatMap((agent) => {
                        return [
                            ...SKILL_FILES.map((file) => {
                                return `${agent}/skills/${file}`;
                            }),
                            `${agent}/skills/own-skill/SKILL.md`,
                        ];
                    })
                    .sort()
            );
            const after = JSON.parse(await readFile(lockFile, 'utf8')) as { skills: Record<string, unknown> };
            expect(Object.keys(after.skills).sort()).toEqual(['--all', 'figma-qa', 'figma-qa-scaffold', 'figma-qa-variables', 'own-skill']);

            for (const agent of ['.agents', '.claude']) {
                await rm(path.join(dir, agent, 'skills/own-skill'), { recursive: true });
            }
            await writeFile(lockFile, committedLock);
            const rerun = await figmaQa(['init', '--yes']);

            expect(rerun.stdout, rerun.stderr).not.toMatch(/^(write|run|edit) /m);
        },
        INSTALL_TIMEOUT
    );

    it('runs the installed kit\'s migrate: stamps refs from before the stamp, refuses refs from a newer kit', async () => {
        const stamp = path.join(dir, 'figma-qa/__refs__/format.json');
        const committed = await readFile(stamp, 'utf8');
        await rm(stamp);

        const result = await figmaQa(['init', '--yes']);

        expect(result.code, result.stderr).toBe(0);
        expect(result.stdout).toMatch(/^write figma-qa\/__refs__\/format\.json: refs format 1\nok    skills: /m);
        expect(await readFile(stamp, 'utf8')).toBe(committed);

        await writeFile(stamp, '{ "format": 2 }\n');
        const newer = await figmaQa(['init', '--yes']);
        await writeFile(stamp, committed);

        expect(newer.code).toBe(2);
        expect(newer.stderr).toContain('figma-qa migrate: figma-qa/__refs__ is refs format 2; this kit reads format 1: upgrade the kit.');
        expect(newer.stderr).toContain('figma-qa init: figma-qa migrate failed (exit 2): fix what it names, then re-run init.');
        expect(newer.stdout).not.toContain('ok    skills: ');
    });

    it('finds a caller of the kit workflow under any name', async () => {
        const workflows = path.join(dir, '.github/workflows');
        await mkdir(workflows, { recursive: true });
        await writeFile(
            path.join(workflows, 'design.yaml'),
            'jobs:\n    figma-qa:\n        uses: Phenomenon-Studio/storybook-figma-qa/.github/workflows/figma-qa.yml@v1\n'
        );

        const result = await figmaQa(['init', '--dry-run']);

        expect(result.code, result.stderr).toBe(0);
        expect(result.stdout).toContain('ok    PR workflow: .github/workflows/design.yaml');
        expect(result.stdout).not.toContain('todo  PR workflow');
    });

    describe('first-run wizard', () => {
        let stub: FigmaStub;
        let home = '';
        let env: Record<string, string> = {};

        beforeAll(async () => {
            stub = await startFigmaStub('FIXTUREKIT');
            stub.token = 'figd_good';
            home = await mkdtemp(path.join(tmpdir(), 'figma-qa-home-'));
            await writeFile(path.join(home, '.npmrc'), '');
            env = {
                FIGMA_API_URL: stub.url,
                PATH: `${FAKE_DOCKER}${path.delimiter}${process.env.PATH ?? ''}`,
                FAKE_DOCKER_LOG: path.join(home, 'docker.jsonl'),
                // The registry token's user config: empty until the complete-setup case writes the line.
                NPM_CONFIG_USERCONFIG: path.join(home, '.npmrc'),
                npm_config_userconfig: path.join(home, '.npmrc'),
            };
        });

        afterAll(async () => {
            await stub.close();
            await rm(home, { recursive: true, force: true });
        });

        async function dockerCalls(): Promise<string[][]> {
            const text = await readFile(env.FAKE_DOCKER_LOG ?? '', 'utf8').catch(() => {
                return '';
            });

            return text
                .split('\n')
                .filter(Boolean)
                .map((line) => {
                    return JSON.parse(line) as string[];
                })
                .filter(Array.isArray);
        }

        const TOKEN_PROMPT = 'FIGMA_TOKEN (hidden; empty to skip): ';
        const PULL_PROMPT = '[Y/n] ';

        /** `init` in a terminal, answering its prompts. */
        async function wizard(args: string[], answers: [string, string][], extra: Record<string, string> = {}) {
            const command = [path.join(dir, 'node_modules/.bin/figma-qa'), 'init', ...args];
            const { code, output } = await answering(dir, command, answers, { ...env, ...extra });
            expect(code, output).toBe(0);

            return output;
        }

        it('--yes prints the checklist in order and prompts, writes and pulls nothing', async () => {
            const before = await snapshot(dir);

            const output = await wizard(['--yes'], []);

            expect(output).not.toMatch(PROMPTS);
            const checklist = output.slice(output.indexOf('figma-qa init: checklist'));
            const names = [...checklist.matchAll(/^(\w+) +([\w ]+):/gm)].map((match) => {
                return `${match[1]} ${match[2]}`;
            });
            expect(names.slice(0, 6)).toEqual([
                'todo registry',
                'todo figma token',
                'info file access',
                'todo browser',
                'ok variables',
                'info figma mcp',
            ]);
            expect(checklist).toContain('fix: gh auth refresh -s read:packages');
            expect(checklist).toContain('Dev or Full seat');
            expect(checklist).toMatch(/fix: docker pull mcr\.microsoft\.com\/playwright:v[\d.]+-noble/);
            expect(output).toContain('figma-qa init: done');
            expect(await snapshot(dir)).toEqual(before);
            expect(await dockerCalls()).not.toContainEqual(expect.arrayContaining(['pull']));
        });

        it('without a terminal: no prompt, exit 0', async () => {
            const result = await figmaQaWith(['init'], env);

            expect(result.code, result.stderr).toBe(0);
            expect(result.stdout).toContain('todo  figma token: FIGMA_TOKEN not set');
            expect(result.stdout).not.toMatch(PROMPTS);
        });

        it('refuses to write the token where git would commit it, printing the line', async () => {
            const output = await wizard([], [[TOKEN_PROMPT, 'figd_good'], [PULL_PROMPT, 'n']]);

            expect(output).toContain('ok    figma token: Fixture Dev');
            expect(output).toContain('todo  .env.local: not gitignored, so the token is not written');
            expect(output).toContain('FIGMA_TOKEN=figd_good');
            await expect(readFile(path.join(dir, '.env.local'), 'utf8')).rejects.toThrow();
            expect(await dockerCalls()).not.toContainEqual(expect.arrayContaining(['pull']));
        });

        it('validates the token, saves it to the ignored .env.local, checks file access and pulls on yes', async () => {
            spawnSync('git', ['init', '-q'], { cwd: dir });
            await writeFile(path.join(dir, '.gitignore'), 'node_modules\n.env.local\n');
            stub.requests = [];

            const output = await wizard([], [
                [TOKEN_PROMPT, 'figd_bad'],
                [TOKEN_PROMPT, 'figd_good'],
                [PULL_PROMPT, 'y'],
            ]);

            expect(output).toContain('todo  figma token: Figma rejected it; paste another');
            // Typed in raw mode: the terminal never shows a token.
            expect(output).not.toContain('figd_');
            expect(output).toContain('ok    figma token: Fixture Dev');
            expect(output).toContain('write .env.local: FIGMA_TOKEN');
            expect(await readFile(path.join(dir, '.env.local'), 'utf8')).toBe('FIGMA_TOKEN=figd_good\n');
            expect(output).toMatch(/run   docker pull mcr\.microsoft\.com\/playwright:v[\d.]+-noble/);
            expect(await dockerCalls()).toContainEqual(expect.arrayContaining(['pull']));
            const checklist = output.slice(output.indexOf('figma-qa init: checklist'));
            expect(checklist).toContain('ok    figma token: Fixture Dev (FIGMA_TOKEN from .env.local)');
            expect(checklist).toContain('ok    file access: FIXTUREKIT "Fixture UI kit", version 1');
            expect(checklist).toMatch(/ok    browser: Docker runs; pinned image .+ pulled/);
            expect(stub.routes()).toEqual(expect.arrayContaining(['me', 'meta']));
            expect(stub.routes()).not.toContain('nodes');
        });

        it('complete setup: all green, no prompts, no changes', async () => {
            await writeFile(path.join(home, '.npmrc'), '//npm.pkg.github.com/:_authToken=ghp_test\n');
            const before = await snapshot(dir);

            const output = await wizard([], [], { FAKE_DOCKER_IMAGE: 'present' });

            expect(output).not.toMatch(PROMPTS);
            expect(output).not.toMatch(/^(todo|block|warn|write|run|edit) /m);
            expect(output).toContain('ok    registry: ');
            expect(output).toMatch(/ok    browser: Docker runs; pinned image .+ pulled/);
            expect(await snapshot(dir)).toEqual(before);
        });

        it('doctor blocks on a token Figma rejects', async () => {
            stub.token = 'figd_rotated';
            try {
                const result = await figmaQaWith(['doctor'], { ...env, FAKE_DOCKER_IMAGE: 'present' });

                expect(result.code, result.stdout + result.stderr).toBe(2);
                expect(result.stdout).toContain('block figma token: Figma rejected FIGMA_TOKEN from .env.local');
                expect(result.stdout).toContain('info  file access: not checked: needs a working FIGMA_TOKEN');
            } finally {
                stub.token = 'figd_good';
            }
        });

        it('a rejected token from the env is not prompted for: .env.local would never be read', async () => {
            const before = await snapshot(dir);

            const output = await wizard([], [], { FIGMA_TOKEN: 'figd_rotated', FAKE_DOCKER_IMAGE: 'present' });

            expect(output).not.toMatch(PROMPTS);
            expect(output).toContain('block figma token: Figma rejected FIGMA_TOKEN from env');
            expect(output).toContain('fix: replace FIGMA_TOKEN where your environment sets it');
            expect(await snapshot(dir)).toEqual(before);
        });
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
