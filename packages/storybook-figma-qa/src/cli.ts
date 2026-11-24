#!/usr/bin/env node
// `figma-qa` CLI. Commands load lazily so heavy dependencies only cost the command that needs them.
// Exit codes: 0 ok, 1 design failure (report), 2 harness or setup error.

const COMMANDS = {
    report: 'Run the Figma report (default)',
    doctor: 'Check setup: registry, Figma token, file access, browser',
    init: 'Install the kit into this project',
    variables: 'Print the variable naming script / merge its output',
    scaffold: 'Write a starter Figma story from a UI-kit URL',
    migrate: 'Migrate committed config and refs after an upgrade',
} as const;

type Command = keyof typeof COMMANDS;

const USAGE = [
    'Usage: figma-qa <command> [options]',
    '',
    'Commands:',
    ...Object.entries(COMMANDS).map(([name, help]) => {
        return `  ${name.padEnd(10)} ${help}`;
    }),
    '',
    'report [filters...] [--json] [--refresh] [--host-browser] [--no-open]',
    '  filters: component names, or story-id globs (`*`, `?`, `--`)',
    'init [--yes] [--dry-run] [--next]',
    '  --next: bootstrap Storybook 11 beta when the project has no Storybook',
].join('\n');

function isCommand(name: string): name is Command {
    return Object.hasOwn(COMMANDS, name);
}

async function main(argv: string[]): Promise<number> {
    if (argv[0] === '--help' || argv[0] === '-h') {
        console.log(USAGE);

        return 0;
    }

    // Bare options (`figma-qa --json`) belong to the default command.
    const [name = 'report', ...rest] = argv[0]?.startsWith('-') ? ['report', ...argv] : argv;

    if (!isCommand(name)) {
        console.error(`figma-qa: unknown command "${name}"\n\n${USAGE}`);

        return 2;
    }

    if (name === 'report') {
        const { report } = await import('./commands/report.ts');

        return report(rest);
    }

    if (name === 'doctor') {
        const { doctor } = await import('./commands/doctor.ts');

        return await doctor();
    }

    if (name === 'init') {
        const { init } = await import('./commands/init.ts');

        return await init(rest);
    }

    console.error(`figma-qa ${name}: not implemented yet`);

    return 2;
}

process.exitCode = await main(process.argv.slice(2));
