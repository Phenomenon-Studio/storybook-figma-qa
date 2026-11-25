// The cause a story's own failure (render, play function, axe) is reported with: the summary prints it on the story's
// `ERROR` line, so it must start with what failed, not with terminal colours or Storybook's debug link.
import { describe, expect, it } from 'vitest';
import { storyFailureCause } from '../src/figma/story.ts';

describe('storyFailureCause', () => {
    it('drops colours and the debug link Storybook puts first', () => {
        const message = [
            '',
            '\u001B[34mClick to debug the error directly in Storybook: http://localhost:6006/?path=/story/ui-badge--figma-matrix\u001B[39m',
            '',
            '\u001B[2mexpect(\u001B[22m\u001B[31mreceived\u001B[39m\u001B[2m).toHaveNoViolations(\u001B[22m\u001B[32mexpected\u001B[39m\u001B[2m)\u001B[22m',
            '',
            '\u001B[31m"Table header text should not be empty (empty-table-header)"\u001B[39m',
        ].join('\n');

        expect(storyFailureCause(message)).toBe(
            'expect(received).toHaveNoViolations(expected)\n\n"Table header text should not be empty (empty-table-header)"'
        );
    });

    it('keeps a plain message as it is', () => {
        expect(storyFailureCause('Cannot read properties of undefined')).toBe('Cannot read properties of undefined');
    });

    it('names an empty message', () => {
        expect(storyFailureCause(' \n')).toBe('unknown error');
    });
});
