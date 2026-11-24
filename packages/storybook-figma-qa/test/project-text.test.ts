// Pure logic: `figma-qa init`'s rules block and registry scope line.
import { describe, expect, it } from 'vitest';
import { REGISTRY_LINE, RULES_BLOCK, withRegistryLine, withRulesBlock } from '../src/node/project-text.ts';

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
