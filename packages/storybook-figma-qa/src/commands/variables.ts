// `figma-qa variables`: names the variable ids the committed refs bind, in one in-session step for an agent.
// No argument: prints the read-only Plugin API script for the unnamed ids only (per Figma file), to run with
// `use_figma`. `<file>` or `-` (stdin): merges that script's output into the committed `variables.json`.
import { readFile } from 'node:fs/promises';
import { text } from 'node:stream/consumers';
import { loadProjectConfig } from '../node/config.ts';
import { refsFormatBlocked } from '../node/migrate.ts';
import {
    mergeVariables,
    namingScript,
    parseNamingOutput,
    unnamedVariables,
    VARIABLES_FILE,
} from '../node/variables.ts';
import { print } from '../node/output.ts';

const USAGE = 'usage: figma-qa variables [<file> | -]';

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function printScripts(root: string, refsDir: string): Promise<number> {
    const unnamed = await unnamedVariables(root, refsDir);
    if (unnamed.size === 0) {
        console.error(`figma-qa variables: every bound variable is named in ${refsDir}/${VARIABLES_FILE}.`);

        return 0;
    }
    // stdout holds only runnable script: the guidance is a comment, so a whole block can be pasted into `use_figma`.
    const blocks = [...unnamed].map(([fileKey, ids]) => {
        return [
            `// Figma file ${fileKey}: ${ids.length} unnamed. Run with use_figma (fileKey "${fileKey}"), then pass the`,
            '// returned JSON to `figma-qa variables -` (stdin) or `figma-qa variables <file>`.',
            namingScript(ids),
        ].join('\n');
    });
    print(blocks.join('\n\n'));

    return 0;
}

async function merge(root: string, refsDir: string, source: string): Promise<number> {
    const input = source === '-' ? await text(process.stdin) : await readFile(source, 'utf8');
    const output = parseNamingOutput(input);
    const added = await mergeVariables(root, refsDir, output.variables);
    const left = [...(await unnamedVariables(root, refsDir)).values()].flat();
    const named = added.length === 0 ? 'nothing new to name' : `named ${added.length}: ${added.join(', ')}`;
    const rest =
        left.length === 0 ? 'every bound variable is named' : `${left.length} still unnamed: ${left.join(', ')}`;
    print(`figma-qa variables: ${named}; ${rest}.`);
    if (output.missing.length > 0) {
        // They stay unnamed: the script ran in a file that doesn't have them (deleted, or another file's).
        print(`figma-qa variables: not found in the file the script ran in: ${output.missing.join(', ')}.`);
    }

    return 0;
}

export async function variables(argv: string[]): Promise<number> {
    if (argv.length > 1 || (argv[0]?.startsWith('-') && argv[0] !== '-')) {
        console.error(`figma-qa variables: ${USAGE}`);

        return 2;
    }
    const root = process.cwd();
    try {
        const { refsDir } = (await loadProjectConfig(root)).config;
        // It reads the manifests and writes into the refs dir: only refs in the kit's format.
        const wrongFormat = await refsFormatBlocked({ root, refsDir });
        if (wrongFormat) {
            console.error(`figma-qa variables: ${wrongFormat}`);

            return 2;
        }

        return argv[0] === undefined ? await printScripts(root, refsDir) : await merge(root, refsDir, argv[0]);
    } catch (error) {
        console.error(`figma-qa variables: ${message(error)}`);

        return 2;
    }
}
