// Pure logic: `figma-qa init`'s rules block, registry scope line and PR workflow caller.
import { describe, expect, it } from 'vitest';
import {
    callerWorkflow,
    REGISTRY_LINE,
    RULES_BLOCK,
    usesKitWorkflow,
    withRegistryLine,
    withRulesBlock,
} from '../src/node/project-text.ts';

describe('withRulesBlock', () => {
    it('writes the block alone into a missing or empty file', () => {
        expect(withRulesBlock(null)).toBe(`${RULES_BLOCK}\n`);
        expect(withRulesBlock('\n')).toBe(`${RULES_BLOCK}\n`);
    });

    it('appends after existing rules, once', () => {
        const once = withRulesBlock('# Rules\n\nBe kind.\n');

        expect(once).toBe(`# Rules\n\nBe kind.\n\n${RULES_BLOCK}\n`);
        expect(withRulesBlock(once)).toBe(once);
    });

    it('rewrites only between the markers', () => {
        const stale = '# Rules\n<!-- figma-qa:start -->\nold\n<!-- figma-qa:end -->\nAfter.\n';

        expect(withRulesBlock(stale)).toBe(`# Rules\n${RULES_BLOCK}\nAfter.\n`);
    });
});

describe('withRegistryLine', () => {
    it('adds the scope line, keeping other lines', () => {
        expect(withRegistryLine(null)).toBe(`${REGISTRY_LINE}\n`);
        expect(withRegistryLine('auto-install-peers=true\n')).toBe(`auto-install-peers=true\n${REGISTRY_LINE}\n`);
    });

    it('is a no-op when present and replaces another registry for the scope', () => {
        const present = `a=1\n${REGISTRY_LINE}\nb=2\n`;

        expect(withRegistryLine(present)).toBe(present);
        expect(withRegistryLine('@phenomenon-studio:registry=https://registry.npmjs.org\n')).toBe(`${REGISTRY_LINE}\n`);
        expect(withRegistryLine('a=1\r\n@phenomenon-studio:registry=x\r\n')).toBe(`a=1\r\n${REGISTRY_LINE}\r\n`);
    });
});

describe('callerWorkflow', () => {
    it('pins the kit major and passes FIGMA_TOKEN explicitly', () => {
        const caller = callerWorkflow({ kitVersion: '1.4.2', workingDirectory: '.' });

        expect(caller).toContain('uses: Phenomenon-Studio/storybook-figma-qa/.github/workflows/figma-qa.yml@v1\n');
        expect(caller).toContain('FIGMA_TOKEN: ${{ secrets.FIGMA_TOKEN }}');
        expect(caller).toContain('pull-requests: write');
        expect(caller).not.toContain('working-directory');
        expect(usesKitWorkflow(caller)).toBe(true);
    });

    it('names the project when it is not the repo root', () => {
        const caller = callerWorkflow({ kitVersion: '0.3.0-next.1', workingDirectory: 'apps/web' });

        expect(caller).toContain('figma-qa.yml@v0\n');
        expect(caller).toMatch(/with:\n {12}working-directory: apps\/web\n/);
    });

    it('tells a caller of the kit workflow from other workflows', () => {
        expect(usesKitWorkflow('jobs:\n  ci:\n    runs-on: ubuntu-latest\n')).toBe(false);
        expect(usesKitWorkflow("uses: 'Phenomenon-Studio/storybook-figma-qa/.github/workflows/figma-qa.yml@main'")).toBe(true);
    });
});
