// `figma-qa init`'s edits to plain-text project files: the agent rules block and the registry scope line.
import { PACKAGE_NAME } from '../constants.ts';
import { FIGMA_TAG } from '../figma/types.ts';

export const RULES_START = '<!-- figma-qa:start -->';
export const RULES_END = '<!-- figma-qa:end -->';

export const RULES_BLOCK = [
    RULES_START,
    '## Figma QA',
    '',
    'Written by `figma-qa init`, which rewrites everything between these markers.',
    '',
    `- Figma stories (\`${FIGMA_TAG}\` tag, \`<Component>.figma.stories.tsx\`) hold components to the Figma UI kit; each links its component sets once, in \`parameters.design\`.`,
    '- Check them with `pnpm figma-report [Component]` (`figma-qa report`): exit 0 pass, 1 differs from Figma, 2 setup error.',
    '- Agent skills: `figma-qa` runs the report and triages failing cells; `figma-qa-scaffold` finishes a story `figma-qa scaffold` wrote; `figma-qa-variables` names the Figma variables the report calls unnamed.',
    '- Setup problems: `figma-qa doctor`. Refs under `figma-qa/__refs__` are committed and written by the CLI, never by hand.',
    RULES_END,
].join('\n');

/** `source` with the rules block: only text between the markers is replaced; without markers the block is appended. */
export function withRulesBlock(source: string | null): string {
    if (source === null || source.trim() === '') {
        return `${RULES_BLOCK}\n`;
    }
    const start = source.indexOf(RULES_START);
    const end = start === -1 ? -1 : source.indexOf(RULES_END, start);
    if (end !== -1) {
        return source.slice(0, start) + RULES_BLOCK + source.slice(end + RULES_END.length);
    }

    return `${source.trimEnd()}\n\n${RULES_BLOCK}\n`;
}

const REGISTRY_SCOPE = `${PACKAGE_NAME.split('/')[0]}:registry=`;
/** The only line init writes to the project `.npmrc`: the registry token stays in the user's `~/.npmrc`. */
export const REGISTRY_LINE = `${REGISTRY_SCOPE}https://npm.pkg.github.com`;

/** `source` with the scope line, replacing another registry for the scope and leaving every other line alone. */
export function withRegistryLine(source: string | null): string {
    const lines = source ? source.split('\n') : [];
    const index = lines.findIndex((line) => {
        return line.trim().startsWith(REGISTRY_SCOPE);
    });
    if (index !== -1) {
        // Keep a CRLF file's `\r` on the replaced line.
        lines[index] = lines[index]?.endsWith('\r') ? `${REGISTRY_LINE}\r` : REGISTRY_LINE;

        return lines.join('\n');
    }
    if (lines.at(-1) === '') {
        lines.pop();
    }

    return `${[...lines, REGISTRY_LINE].join('\n')}\n`;
}
