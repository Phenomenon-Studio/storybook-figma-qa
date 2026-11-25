// `figma-qa migrate`: carries the committed refs and config to this kit's format after an upgrade. `init` runs it
// through the installed kit's bin. A no-op when up to date; `--dry-run` lists the steps and writes nothing.
// Exit 2: a config the kit can't load, a stamp it can't read, or refs from a newer kit.
import { FigmaQaConfigError } from '../figma/config.ts';
import { loadProjectConfig } from '../node/config.ts';
import { MigrateError, migrate as runSteps } from '../node/migrate.ts';

const USAGE = 'Usage: figma-qa migrate [--dry-run]';

export async function migrate(args: string[]): Promise<number> {
    const unknown = args.filter((arg) => {
        return arg !== '--dry-run';
    });
    if (unknown.length > 0) {
        console.error(`figma-qa migrate: unknown option ${unknown.join(' ')}\n${USAGE}`);

        return 2;
    }
    const dryRun = args.includes('--dry-run');
    const root = process.cwd();
    try {
        const { refsDir } = (await loadProjectConfig(root)).config;
        await runSteps(
            { root, refsDir },
            {
                dryRun,
                line: (status, text) => {
                    console.log(`${status.padEnd(5)} ${text}`);
                },
            }
        );
    } catch (error) {
        if (error instanceof MigrateError || error instanceof FigmaQaConfigError) {
            console.error(`figma-qa migrate: ${error.message}`);

            return 2;
        }
        throw error;
    }
    console.log(dryRun ? 'figma-qa migrate: dry run, nothing written' : 'figma-qa migrate: done');

    return 0;
}
