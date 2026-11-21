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
    ...Object.entries(COMMANDS).map(([name, help]) => `  ${name.padEnd(10)} ${help}`),
].join('\n');

function isCommand(name: string): name is Command {
    return Object.hasOwn(COMMANDS, name);
}

async function main(argv: string[]): Promise<number> {
    const [name = 'report'] = argv;

    if (name === '--help' || name === '-h') {
        console.log(USAGE);

        return 0;
    }

    if (!isCommand(name)) {
        console.error(`figma-qa: unknown command "${name}"\n\n${USAGE}`);

        return 2;
    }

    if (name === 'doctor') {
        const { doctor } = await import('./commands/doctor.ts');

        return doctor();
    }

    console.error(`figma-qa ${name}: not implemented yet`);

    return 2;
}

process.exitCode = await main(process.argv.slice(2));
