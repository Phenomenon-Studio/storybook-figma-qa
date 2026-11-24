// `figma-qa report --changed [base]` and `--ci`, through the real CLI in each fixture. `--changed` runs against a
// throwaway git repository over the fixture (`GIT_DIR` + `GIT_WORK_TREE`), so the kit repo's own history and a
// developer's uncommitted work never decide what a test runs.
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CI_SUMMARY_FILE, REPORT_DIR } from '../src/figma/types.ts';
import { CI_MARKER } from '../src/node/ci-summary.ts';
import { fixtureDir, FIXTURES, inTerminal, report, runCli } from './cli.ts';

const execFileAsync = promisify(execFile);
const FAKE_DOCKER = fileURLToPath(new URL('./fake-docker', import.meta.url));
const FIGMA_FILES = [
    'src/Glyph.figma.stories.tsx',
    'src/Misconfigured.figma.stories.tsx',
    'src/Swatch.figma.stories.tsx',
    'src/SwatchDrift.figma.stories.tsx',
    'src/SwatchToken.figma.stories.tsx',
    'src/SwatchTriage.figma.stories.tsx',
];

describe.each(FIXTURES)('figma-qa report --changed in fixtures/%s', (fixture) => {
    let dir = '';
    let gitEnv: Record<string, string> = {};

    async function git(args: string[]) {
        const identity = ['-c', 'user.name=figma-qa', '-c', 'user.email=figma-qa@example.test', '-c', 'commit.gpgsign=false'];
        const { stdout } = await execFileAsync('git', [...identity, ...args], {
            cwd: fixtureDir(fixture),
            env: { ...process.env, ...gitEnv },
        });

        return stdout;
    }

    beforeAll(async () => {
        dir = await mkdtemp(path.join(tmpdir(), `figma-qa-changed-${fixture}-`));
        gitEnv = { GIT_DIR: path.join(dir, 'git'), GIT_WORK_TREE: fixtureDir(fixture) };
        await git(['init', '-q']);
        await writeFile(
            path.join(dir, 'git/info/exclude'),
            ['node_modules/', 'storybook-static/', 'figma-qa/.results/', '*.log', ''].join('\n')
        );
        // Each commit adds one file the base lacks: HEAD~1 differs by Glyph's cell renderer alone, HEAD~2 also by a
        // committed ref, which no story imports.
        await git(['add', '-A', '--', '.', ':!src/glyph-cell.tsx', ':!figma-qa/__refs__/variables.json']);
        await git(['commit', '-q', '-m', 'base']);
        await git(['add', 'figma-qa/__refs__/variables.json']);
        await git(['commit', '-q', '-m', 'change refs']);
        await git(['add', 'src/glyph-cell.tsx']);
        await git(['commit', '-q', '-m', 'change Glyph']);
        expect(await git(['status', '--porcelain'])).toBe('');
    });

    afterAll(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it('runs only the Figma stories whose imports changed since the base', async () => {
        const { code, stderr, summary } = await report(fixture, ['--changed', 'HEAD~1'], gitEnv);

        expect(summary.errors, stderr).toEqual([]);
        expect(summary.files).toEqual(['src/Glyph.figma.stories.tsx']);
        expect(summary.stories.length).toBeGreaterThan(0);
        expect(
            summary.stories.every((story) => {
                return story.storyId.startsWith('glyph-');
            })
        ).toBe(true);
        expect(code).toBe(summary.exitCode);
    });

    it('runs every Figma story when the committed refs changed', async () => {
        const { stderr, summary } = await report(fixture, ['--changed', 'HEAD~2'], gitEnv);

        expect(summary.files, stderr).toEqual(FIGMA_FILES);
    });

    it('exits 2 naming git\'s cause when the base is not a revision', async () => {
        const { code, summary } = await report(fixture, ['--changed', 'no-such-base'], gitEnv);

        expect(code).toBe(2);
        expect(summary.stories).toEqual([]);
        expect(summary.errors[0]).toContain('no-such-base');
    });

    it('starts no browser image when nothing is affected', async () => {
        const log = path.join(dir, 'docker.jsonl');
        const { code, stderr } = await runCli(fixture, ['report', '--changed', '--ci', '--json'], {
            ...gitEnv,
            PATH: `${FAKE_DOCKER}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_DOCKER_LOG: log,
        });

        expect(code, stderr).toBe(0);
        expect(await readFile(log, 'utf8').catch(() => {
                return '';
            })).toBe('');
    });

    it('exits 0 with "no Figma stories affected" when nothing changed, in the --ci summary too', async () => {
        const { code, summary } = await report(fixture, ['--changed', '--ci'], gitEnv);

        expect(code).toBe(0);
        expect(summary.files).toEqual([]);
        expect(summary.stories).toEqual([]);
        expect(summary.warnings).toContain('No Figma stories affected.');
        const markdown = await readFile(path.join(fixtureDir(fixture), CI_SUMMARY_FILE), 'utf8');
        expect(markdown).toContain('No Figma stories affected.');
    });
});

describe.skipIf(process.platform === 'win32').each(FIXTURES)('figma-qa report --ci in fixtures/%s', (fixture) => {
    let dir = '';
    let env: Record<string, string> = {};

    beforeAll(async () => {
        dir = await mkdtemp(path.join(tmpdir(), 'figma-qa-ci-'));
        const opener = path.join(dir, 'open');
        await writeFile(opener, '#!/bin/sh\nprintf %s "$1" > "$OPENED"\n');
        await chmod(opener, 0o755);
        env = {
            // A stopped Docker: the pinned image is `local-report.test.ts`'s, this run is about the summary.
            PATH: `${FAKE_DOCKER}${path.delimiter}${process.env.PATH ?? ''}`,
            FAKE_DOCKER: 'down',
            BROWSER: opener,
            OPENED: path.join(dir, 'opened'),
            CI: '',
        };
    });

    afterAll(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it('opens nothing and writes the markdown summary beside the HTML report', async () => {
        // Triage covers every category; Misconfigured is a harness error.
        const stdout = await inTerminal(fixture, ['report', 'SwatchTriage', 'Misconfigured', '--ci'], env);
        const root = fixtureDir(fixture);

        expect(stdout).toContain(`Markdown summary: ${CI_SUMMARY_FILE}`);
        expect(stdout).toContain('WARN  Host Chromium (Docker is not running): pixels are not comparable to CI.');
        await new Promise((resolve) => {
            setTimeout(resolve, 1000);
        });
        expect(await readFile(env.OPENED ?? '', 'utf8').catch(() => {
                return null;
            })).toBeNull();
        expect(await readFile(path.join(root, REPORT_DIR, 'index.html'), 'utf8')).toContain('<html');

        const markdown = await readFile(path.join(root, CI_SUMMARY_FILE), 'utf8');
        expect(markdown.startsWith(`${CI_MARKER}\n`)).toBe(true);
        expect(markdown).toContain('## Figma QA: harness or setup error (not a design verdict)');
        expect(markdown).toContain('token 1 · value 1 · uncategorised 2');
        expect(markdown).toMatch(/harness \d+ \(not a design verdict\)/);
        expect(markdown).toMatch(/\| error \| – \| – \| – \| – \| not a design verdict \|/);
        expect(markdown).toContain('### Errors (not a design verdict)');
    });
});
