// Pure logic: `figma-qa.config.ts` defaults and validation. Behaviour of each key is proven through the CLI
// (config-cli.test.ts).
import { describe, expect, it } from 'vitest';
import { defineConfig, iconName, resolveConfig } from '../src/figma/config.ts';

describe('resolveConfig', () => {
    it('applies every default when there is no config', () => {
        const config = resolveConfig(undefined);

        expect(config.tokens.prefix).toBe('--color-');
        expect(config.refsDir).toBe('figma-qa/__refs__');
        expect(config.maxDiffRatio).toBe(0.05);
        expect(config.icons.glob).toBe('src/assets/icons/*.svg');
        expect(config.icons.name('Icons/Chevron Down')).toBe('chevron-down');
        expect(config.tokenName({ collection: 'c', type: 'COLOR', name: 'Surface/control 50%' })).toBe(
            '--color-surface-control-50'
        );
    });

    it('builds the default token name with the configured prefix', () => {
        const config = resolveConfig(defineConfig({ tokens: { prefix: '--ui-' } }));

        expect(config.tokenName({ collection: 'c', type: 'COLOR', name: 'Surface/control' })).toBe(
            '--ui-surface-control'
        );
    });

    it('keeps project hooks and partial nested keys', () => {
        const tokenName = () => {
            return '--x';
        };
        const config = resolveConfig(
            defineConfig({ tokenName, icons: { glob: 'icons/*.svg' }, refsDir: 'refs', maxDiffRatio: 0 })
        );

        expect(config.tokenName).toBe(tokenName);
        expect(config.icons.glob).toBe('icons/*.svg');
        expect(config.icons.name('StarFour')).toBe('star-four');
        expect(config.refsDir).toBe('refs');
        expect(config.maxDiffRatio).toBe(0);
    });

    it.each([
        [{ tokenPrefix: '--x-' }, 'unknown key "tokenPrefix"'],
        [{ tokens: { prefx: '--x-' } }, 'unknown key "tokens.prefx"'],
        [{ icons: { glob: 'a', names: () => {} } }, 'unknown key "icons.names"'],
        [{ tokens: { prefix: 'color-' } }, '"tokens.prefix" must be a string starting with "--"'],
        [{ tokens: '--x-' }, '"tokens" must be an object'],
        [{ tokenName: '--x' }, '"tokenName" must be a function'],
        [{ icons: { name: 'x' } }, '"icons.name" must be a function'],
        [{ icons: { glob: '' } }, '"icons.glob" must be a non-empty string'],
        [{ icons: { glob: '../icons/*.svg' } }, '"icons.glob" must be relative to the project root'],
        [{ icons: { glob: '/src/*.svg' } }, '"icons.glob" must be relative to the project root'],
        [{ refsDir: 3 }, '"refsDir" must be a non-empty string'],
        [{ maxDiffRatio: 2 }, '"maxDiffRatio" must be a number from 0 to 1'],
        [{ maxDiffRatio: '0.1' }, '"maxDiffRatio" must be a number from 0 to 1'],
        ['nope', 'must export an object'],
    ])('rejects %j', (raw, message) => {
        expect(() => {
            return resolveConfig(raw);
        }).toThrow(message);
    });
});

describe('iconName', () => {
    it.each([
        ['Icons/Chevron Down', 'chevron-down'],
        ['StarFour', 'star-four'],
        ['icon / arrow_left 24', 'arrow-left-24'],
    ])('%s → %s', (figma, file) => {
        expect(iconName(figma)).toBe(file);
    });
});
