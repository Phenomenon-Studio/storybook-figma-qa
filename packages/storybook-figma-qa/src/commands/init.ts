// `figma-qa init`: installs the kit into a React + Vite project on Storybook 10.6+. Every step detects before it acts,
// so a re-run on a set-up project changes nothing, and `--dry-run` prints the plan without writing or running anything.
// Exit 2: a refused project, a failed install, or a config shape the user must edit by hand (snippet printed).
// It never touches stories, components, tokens, the manager theme, other Vitest projects, git or CI files.
// It ends with the first-run wizard: doctor's human checks, a prompt only for a missing or rejected Figma token and an
// unpulled browser image (never under `--yes`, `--dry-run` or without a terminal), then the checklist and PR caller.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'tinyglobby';
import { PACKAGE_NAME } from '../constants.ts';
import { resolveConfig } from '../figma/config.ts';
import { pullImage } from '../node/browser.ts';
import { type Check, fileAccessChecks, humanChecks, printCheck, SEAT_NOTE } from '../node/checks.ts';
import { loadProjectConfig } from '../node/config.ts';
import { ENV_FILE, FigmaTokenError, figmaGet } from '../node/figma-api.ts';
import { MAIN_FILES } from '../node/figma-project.ts';
import { type MergeResult, mergeMain, mergePreview, mergeVitest, VITEST_SNIPPET } from '../node/merge.ts';
import { ask, confirm, interactive } from '../node/prompt.ts';
import { callerWorkflow, REGISTRY_LINE, usesKitWorkflow, withRegistryLine, withRulesBlock } from '../node/project-text.ts';

/** `ask`: the wizard may prompt (a terminal, no `--yes`, no `--dry-run`). */
type Options = { dryRun: boolean; next: boolean; ask: boolean };

type PackageJson = {
    packageManager?: string;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
};

const USAGE = 'Usage: figma-qa init [--yes] [--dry-run] [--next]';

/** Pinned: the version spike 02 verified; the CLI changes how it picks agent dirs between releases. */
const SKILLS_CLI = 'skills@1.9.0';
const SKILL_AGENTS = ['claude-code', 'codex'];
/** Where `skills add -a claude-code codex` copies the kit's skills. */
const SKILL_DIRS = ['.agents/skills', '.claude/skills'];
const ADDON_VITEST = '@storybook/addon-vitest';
const REPORT_SCRIPT = 'figma-report';
const PREVIEW_FILES = ['preview.tsx', 'preview.ts', 'preview.jsx', 'preview.js', 'preview.mts', 'preview.mjs'];
const VITEST_FILES = ['vitest', 'vite'].flatMap((name) => {
    return ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs'].map((extension) => {
        return `${name}.config.${extension}`;
    });
});

/** A project init won't set up, or a step that failed: exit 2 with the reason. */
class SetupError extends Error {}

export async function init(args: string[]): Promise<number> {
    const unknown = args.filter((arg) => {
        return !['--yes', '-y', '--dry-run', '--next'].includes(arg);
    });
    if (unknown.length > 0) {
        console.error(`figma-qa init: unknown option ${unknown.join(' ')}\n${USAGE}`);

        return 2;
    }
    const dryRun = args.includes('--dry-run');
    const yes = args.includes('--yes') || args.includes('-y');
    const options = { dryRun, next: args.includes('--next'), ask: !yes && !dryRun && interactive() };
    try {
        return await run(process.cwd(), options);
    } catch (error) {
        if (error instanceof SetupError) {
            console.error(`figma-qa init: ${error.message}`);

            return 2;
        }
        throw error;
    }
}

function line(status: 'ok' | 'write' | 'run' | 'edit' | 'plan' | 'todo', text: string) {
    console.log(`${status.padEnd(5)} ${text}`);
}

async function readText(file: string): Promise<string | null> {
    return await readFile(file, 'utf8').catch(() => {
        return null;
    });
}

async function readPackageJson(root: string): Promise<{ text: string; json: PackageJson }> {
    const text = await readText(path.join(root, 'package.json'));
    if (text === null) {
        throw new SetupError('no package.json here: run init in the project root.');
    }

    return { text, json: JSON.parse(text) as PackageJson };
}

function dependencies(json: PackageJson): Record<string, string> {
    return { ...json.dependencies, ...json.devDependencies };
}

/** The installed package directory, as Node resolves it from `root` (symlinks kept: skills record a relative path). */
function packageDir(root: string, name: string): string | null {
    for (let dir = root; ; dir = path.dirname(dir)) {
        const candidate = path.join(dir, 'node_modules', name);
        if (existsSync(path.join(candidate, 'package.json'))) {
            return candidate;
        }
        if (path.dirname(dir) === dir) {
            return null;
        }
    }
}

async function installedVersion(root: string, name: string): Promise<string | null> {
    const dir = packageDir(root, name);
    if (!dir) {
        return null;
    }

    return (JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')) as { version: string }).version;
}

/** 10.6 or later, prereleases of a later major included (11.0.0-beta.3). */
function supportedStorybook(version: string): boolean {
    const [major = 0, minor = 0] = version.split(/[.-]/).map(Number);

    return major > 10 || (major === 10 && minor >= 6);
}

/** `framework: 'x'`, `framework: { name: 'x' }` and `framework: getAbsolutePath('x')`, read as text. */
function framework(main: string): string | null {
    return /framework\s*:\s*(?:\{\s*name\s*:\s*)?(?:[\w.]+\(\s*)?['"`]([^'"`]+)['"`]/.exec(main)?.[1] ?? null;
}

type SourceFile = { file: string; source: string };

async function firstFile(dir: string, names: string[]): Promise<SourceFile | null> {
    for (const name of names) {
        const source = await readText(path.join(dir, name));
        if (source !== null) {
            return { file: path.join(dir, name), source };
        }
    }

    return null;
}

function packageManager(root: string, json: PackageJson): string {
    const declared = json.packageManager?.split('@')[0];
    if (declared && ['pnpm', 'yarn', 'npm', 'bun'].includes(declared)) {
        return declared;
    }
    const lockfiles: [string, string][] = [
        ['pnpm-lock.yaml', 'pnpm'],
        ['yarn.lock', 'yarn'],
        ['bun.lock', 'bun'],
        ['bun.lockb', 'bun'],
        ['package-lock.json', 'npm'],
    ];
    for (let dir = root; ; dir = path.dirname(dir)) {
        for (const [lockfile, manager] of lockfiles) {
            if (existsSync(path.join(dir, lockfile))) {
                return manager;
            }
        }
        if (path.dirname(dir) === dir) {
            break;
        }
    }

    // `pnpm dlx` / `npx` say which manager launched init.
    const agent = process.env.npm_config_user_agent?.split('/')[0];

    return agent && ['pnpm', 'yarn', 'npm', 'bun'].includes(agent) ? agent : 'npm';
}

function addDevCommand(manager: string, spec: string): string[] {
    if (manager === 'npm') {
        return ['npm', 'install', '-D', spec];
    }

    return [manager, 'add', manager === 'bun' ? '-d' : '-D', spec];
}

async function kitVersion(): Promise<string> {
    const json = await readFile(new URL('../../package.json', import.meta.url), 'utf8');

    return (JSON.parse(json) as { version: string }).version;
}

function runCommand(root: string, options: Options, command: string[], env: Record<string, string> = {}) {
    line('run', command.join(' '));
    if (options.dryRun) {
        return;
    }
    const [bin = '', ...args] = command;
    const result = spawnSync(bin, args, {
        cwd: root,
        stdio: 'inherit',
        env: { ...process.env, ...env },
        shell: process.platform === 'win32',
    });
    if (result.status !== 0) {
        throw new SetupError(`\`${command.join(' ')}\` failed (${result.error?.message ?? `exit ${result.status}`}).`);
    }
}

async function write(options: Options, file: string, code: string, what: string) {
    line('write', `${what}`);
    if (!options.dryRun) {
        await writeFile(file, code);
    }
}

/** Storybook for React + Vite, bootstrapped with the official init when the project has none. */
async function ensureStorybook(root: string, options: Options): Promise<'ready' | 'planned'> {
    const deps = dependencies((await readPackageJson(root)).json);
    const storybookDeps = Object.keys(deps).filter((name) => {
        return name === 'storybook' || name.startsWith('@storybook/');
    });
    if (storybookDeps.length === 0) {
        const missing = ['react', 'vite'].filter((name) => {
            return !deps[name];
        });
        if (missing.length > 0) {
            const found = ['react', 'vite'].filter((name) => {
                return deps[name];
            });
            throw new SetupError(
                `the kit needs a React + Vite project; package.json has ${found.length > 0 ? found.join(' and ') : 'neither'}${found.length > 0 ? ` but no ${missing.join(' or ')}` : ''} (and no Storybook).`
            );
        }
        // Latest 10 unless asked for the 11 beta; the rest of init then merges into what it wrote.
        runCommand(root, options, [
            'npx',
            '-y',
            `storybook@${options.next ? 'next' : '^10'}`,
            'init',
            '--type',
            'react',
            '--builder',
            'vite',
            '--yes',
            '--no-dev',
            '--disable-telemetry',
        ]);
        if (options.dryRun) {
            return 'planned';
        }
    }
    const version = await installedVersion(root, 'storybook');
    if (!version) {
        // Storybook before 7 ships no `storybook` package.
        throw new SetupError(
            deps.storybook
                ? 'storybook is in package.json but not installed: install dependencies, then re-run init.'
                : `found ${storybookDeps.join(', ')} without the storybook package; the kit needs Storybook 10.6+: run \`npx storybook@latest upgrade\`.`
        );
    }
    if (!supportedStorybook(version)) {
        throw new SetupError(`found Storybook ${version}; the kit needs 10.6 or later: run \`npx storybook@latest upgrade\`.`);
    }
    const main = await firstFile(path.join(root, '.storybook'), MAIN_FILES);
    if (!main) {
        throw new SetupError(`found Storybook ${version} but no .storybook/main.`);
    }
    const found = framework(main.source);
    if (!found?.includes('@storybook/react-vite')) {
        throw new SetupError(
            `the kit needs Storybook for React + Vite (@storybook/react-vite); .storybook/${path.basename(main.file)} uses ${found ?? 'no framework it names literally'}.`
        );
    }
    line('ok', `storybook: ${version} with @storybook/react-vite`);

    return 'ready';
}

/** The scope line goes first: installing the kit from GitHub Packages needs it. */
async function ensureRegistry(root: string, options: Options) {
    const file = path.join(root, '.npmrc');
    const source = await readText(file);
    const next = withRegistryLine(source);
    if (next === source) {
        line('ok', `.npmrc: ${REGISTRY_LINE}`);
    } else {
        await write(options, file, next, `.npmrc: ${REGISTRY_LINE}`);
    }
}

async function ensurePackages(root: string, options: Options): Promise<{ kitPending: boolean; vitestPending: boolean }> {
    const { json } = await readPackageJson(root);
    const deps = dependencies(json);
    const kitPending = !deps[PACKAGE_NAME];
    if (kitPending) {
        runCommand(root, options, addDevCommand(packageManager(root, json), `${PACKAGE_NAME}@${await kitVersion()}`));
    } else {
        line('ok', `package: ${PACKAGE_NAME}`);
    }
    // Its postinstall writes the Vitest config the kit project joins.
    const vitestPending = !deps[ADDON_VITEST];
    if (vitestPending) {
        runCommand(root, options, ['npx', 'storybook', 'add', ADDON_VITEST, '--yes', '--disable-telemetry']);
    } else {
        line('ok', `package: ${ADDON_VITEST}`);
    }

    return { kitPending, vitestPending };
}

/** Applies a merge; an unsafe shape adds its manual edit (file + snippet) to `manual` instead. */
async function applyMerge(
    root: string,
    options: Options,
    found: SourceFile,
    result: MergeResult,
    what: string,
    manual: string[]
) {
    const name = path.relative(root, found.file);
    if (result.status === 'present') {
        line('ok', `${name}: ${what}`);
    } else if (result.status === 'classic') {
        line('ok', `${name}: classic preview, the kit's preset adds its preview side`);
    } else if (result.status === 'merged') {
        await write(options, found.file, result.code, `${name}: ${what}`);
    } else {
        line('edit', `${name}: ${result.reason}; add by hand`);
        manual.push(`${name}:\n${result.snippet}`);
    }
}

/** Config merges. Returns the snippets of files the user must edit by hand. */
async function mergeConfigs(root: string, options: Options, vitestPending: boolean): Promise<string[]> {
    const manual: string[] = [];
    const storybookDir = path.join(root, '.storybook');
    const main = await firstFile(storybookDir, MAIN_FILES);
    if (main) {
        await applyMerge(root, options, main, mergeMain(main.source), 'kit in addons', manual);
    }
    const preview = await firstFile(storybookDir, PREVIEW_FILES);
    if (preview) {
        await applyMerge(root, options, preview, mergePreview(preview.source), 'kit in definePreview addons', manual);
    } else {
        line('ok', '.storybook/preview: none, the kit\'s preset adds its preview side');
    }
    if (vitestPending && options.dryRun) {
        line('plan', `Vitest config: figmaQa() in test.projects, after \`storybook add ${ADDON_VITEST}\``);

        return manual;
    }
    const vitest = await firstFile(root, VITEST_FILES);
    if (vitest) {
        await applyMerge(root, options, vitest, mergeVitest(vitest.source), 'figmaQa() in test.projects', manual);
    } else {
        line('edit', 'no vitest.config or vite.config; add by hand');
        manual.push(`vitest.config.ts:\n${VITEST_SNIPPET}`);
    }

    return manual;
}

/** `pnpm figma-report`: the alias the docs and skills use. An existing script of that name is the user's. */
async function ensureScript(root: string, options: Options) {
    const { text, json } = await readPackageJson(root);
    if (json.scripts?.[REPORT_SCRIPT] !== undefined) {
        line('ok', `package.json: "${REPORT_SCRIPT}" script`);

        return;
    }
    json.scripts = { ...json.scripts, [REPORT_SCRIPT]: 'figma-qa report' };
    const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? '  ';
    const code = `${JSON.stringify(json, null, indent)}${text.endsWith('\n') ? '\n' : ''}`;
    await write(options, path.join(root, 'package.json'), code, `package.json: "${REPORT_SCRIPT}": "figma-qa report"`);
}

/** `AGENTS.md` always; `CLAUDE.md` only when it exists and doesn't already import `AGENTS.md`. */
async function ensureRules(root: string, options: Options) {
    for (const name of ['AGENTS.md', 'CLAUDE.md']) {
        const file = path.join(root, name);
        const source = await readText(file);
        if (name === 'CLAUDE.md' && (source === null || source.includes('@AGENTS.md'))) {
            continue;
        }
        const next = withRulesBlock(source);
        if (next === source) {
            line('ok', `${name}: figma-qa rules block`);
        } else {
            await write(options, file, next, `${name}: figma-qa rules block`);
        }
    }
}

async function sameFile(a: string, b: string): Promise<boolean> {
    const [left, right] = await Promise.all([readText(a), readText(b)]);

    return left !== null && left === right;
}

/**
 * The kit's skills, copied by the skills CLI. Skipped when every copy already matches the installed kit, so a re-run
 * needs no network; a kit upgrade that changes a skill re-runs the CLI, which updates the copies and `skills-lock.json`.
 */
async function ensureSkills(root: string, options: Options, kitPending: boolean) {
    if (options.dryRun && kitPending) {
        line('plan', `npx -y ${SKILLS_CLI} add <kit>/skills, after installing the kit`);

        return;
    }
    const kit = packageDir(root, PACKAGE_NAME);
    if (!kit) {
        throw new SetupError(`${PACKAGE_NAME} is in package.json but not installed: install dependencies, then re-run init.`);
    }
    const source = path.join(kit, 'skills');
    const files = await glob('**/*', { cwd: source, dot: true });
    const checks = await Promise.all(
        files.flatMap((file) => {
            return SKILL_DIRS.map((dir) => {
                return sameFile(path.join(source, file), path.join(root, dir, file));
            });
        })
    );
    if (checks.every(Boolean)) {
        line('ok', `skills: ${SKILL_DIRS.join(', ')}`);

        return;
    }
    // Relative, so `skills-lock.json` records a path every clone resolves.
    const relative = `./${path.relative(root, source).split(path.sep).join('/')}`;
    runCommand(root, options, ['npx', '-y', SKILLS_CLI, 'add', relative, '--copy', '-y', '-a', ...SKILL_AGENTS], {
        DISABLE_TELEMETRY: '1',
    });
}

/** The repo root, where GitHub reads workflows; the project itself outside a git repository. */
function repoRoot(root: string): string {
    const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' });

    return result.status === 0 ? result.stdout.trim() : root;
}

/**
 * The PR check runs a token-holding job on every PR, so adding it is the repo's call: init only reports a caller it
 * finds, or prints one to add.
 */
async function ensureWorkflow(root: string) {
    const repo = repoRoot(root);
    const files = await glob('.github/workflows/*.{yml,yaml}', { cwd: repo });
    for (const file of files.sort()) {
        if (usesKitWorkflow((await readText(path.join(repo, file))) ?? '')) {
            line('ok', `PR workflow: ${file}`);

            return;
        }
    }
    const workingDirectory = path.relative(repo, root).split(path.sep).join('/') || '.';
    line('todo', 'PR workflow: add .github/workflows/figma-qa.yml at the repo root, and a FIGMA_TOKEN repository secret:');
    console.log(`\n${callerWorkflow({ kitVersion: await kitVersion(), workingDirectory })}`);
}

/** Whether git ignores `file`: the only condition under which init writes a secret into the project. */
function gitIgnored(root: string, file: string): boolean {
    return spawnSync('git', ['check-ignore', '-q', file], { cwd: root }).status === 0;
}

/** `source` with its FIGMA_TOKEN line set to `token`, every other line kept. */
function withToken(source: string | null, token: string): string {
    const lines = (source ?? '').split('\n').filter((line) => {
        return !/^\s*(export\s+)?FIGMA_TOKEN\s*=/.test(line);
    });
    if (lines.at(-1) === '') {
        lines.pop();
    }

    return `${[...lines, `FIGMA_TOKEN=${token}`].join('\n')}\n`;
}

/**
 * Asks for a token until Figma takes one (`/v1/me`, then `/meta` on each file the Figma stories link) or the answer is
 * empty, then saves it if `.env.local` is ignored.
 */
async function promptToken(root: string, refsDir: string) {
    console.log(`\nFigma token: create one (scope: File content, read-only) in Figma → Settings → Security.\nSeat: ${SEAT_NOTE}.`);
    for (;;) {
        const token = await ask('FIGMA_TOKEN (hidden; empty to skip): ', { hidden: true });
        if (!token) {
            return;
        }
        try {
            const me = await figmaGet<{ handle?: string; email?: string }>('/me', token);
            line('ok', `figma token: ${me.handle ?? me.email ?? 'valid'}`);
        } catch (error) {
            if (error instanceof FigmaTokenError) {
                line('todo', 'figma token: Figma rejected it; paste another');
                continue;
            }
            line('todo', `figma token: not verified (${error instanceof Error ? error.message : String(error)}); not saved`);

            return;
        }
        const files = await fileAccessChecks(root, refsDir, token);
        const blocked = files.find((check) => {
            return check.status === 'block';
        });
        if (blocked) {
            line('todo', `${blocked.text}; paste a token whose owner can`);
            continue;
        }
        const file = path.join(root, ENV_FILE);
        if (!gitIgnored(root, ENV_FILE)) {
            // A secret in a file git would commit: the human decides where it goes.
            line('todo', `${ENV_FILE}: not gitignored, so the token is not written. Ignore it, then add this line:`);
            console.log(`\n    FIGMA_TOKEN=${token}\n`);

            return;
        }
        line('write', `${ENV_FILE}: FIGMA_TOKEN`);
        const existing = await readText(file);
        await writeFile(file, withToken(existing, token), existing === null ? { mode: 0o600 } : {});

        return;
    }
}

/**
 * The first-run wizard: doctor's human checks, a prompt for each one init can act on, then the remaining checklist.
 * Without `ask` it only prints the checklist: no prompt, no secret written, no pull. A dry run plans it.
 */
async function wizard(root: string, options: Options) {
    if (options.dryRun) {
        // The checks call Figma and Docker: a dry run runs nothing.
        line('plan', 'first-run wizard: doctor\'s human checks, then the checklist');

        return;
    }
    const refsDir = await loadProjectConfig(root)
        .then(({ config }) => {
            return config.refsDir;
        })
        .catch(() => {
            // A broken config is doctor's and report's error to name; the checks still read the default refs dir.
            return resolveConfig(undefined).refsDir;
        });
    let checks = await humanChecks(root, refsDir);
    const act = (kind: string): Check | undefined => {
        return checks.find((check) => {
            return check.action?.kind === kind;
        });
    };
    if (options.ask && (act('token') || act('pull'))) {
        if (act('token')) {
            await promptToken(root, refsDir);
        }
        const pull = act('pull')?.action;
        if (pull?.kind === 'pull' && (await confirm(`\nPull the pinned browser image ${pull.image}?`))) {
            line('run', `docker pull ${pull.image}`);
            if (!(await pullImage(pull.image))) {
                line('todo', `docker pull ${pull.image} failed; the first report pulls it`);
            }
        }
        checks = await humanChecks(root, refsDir);
    }
    console.log('\nfigma-qa init: checklist');
    for (const check of checks) {
        printCheck(check);
    }
}

async function run(root: string, options: Options): Promise<number> {
    if (options.dryRun) {
        console.log('figma-qa init --dry-run: the plan; nothing is written or run');
    }
    if ((await ensureStorybook(root, options)) === 'planned') {
        // Nothing to read yet: the rest merges into what `storybook init` writes.
        line('plan', 'then: the kit package, config merges, rules block, .npmrc scope line and skills');

        return 0;
    }
    await ensureRegistry(root, options);
    const { kitPending, vitestPending } = await ensurePackages(root, options);
    const manual = await mergeConfigs(root, options, vitestPending);
    await ensureScript(root, options);
    await ensureRules(root, options);
    await ensureSkills(root, options, kitPending);
    await wizard(root, options);
    await ensureWorkflow(root);
    if (manual.length > 0) {
        console.error(
            [
                `figma-qa init: ${manual.length === 1 ? 'one file needs' : `${manual.length} files need`} this edit by hand, then re-run init:`,
                ...manual.map((edit) => {
                    return `\n${edit}`;
                }),
            ].join('\n')
        );

        return 2;
    }
    console.log(options.dryRun ? 'figma-qa init: dry run, nothing written' : 'figma-qa init: done');

    return 0;
}
