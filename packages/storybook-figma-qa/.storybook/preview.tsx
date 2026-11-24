import type { Preview } from '@storybook/react-vite';
import { FIGMA_QA_CSS } from '../src/ui/theme.ts';

const preview: Preview = {
    // Every story is an axe check: a violation fails the test run.
    parameters: { a11y: { test: 'error' }, layout: 'fullscreen' },
    decorators: [
        (Story) => {
            return (
                <>
                    <style>{FIGMA_QA_CSS}</style>
                    <Story />
                </>
            );
        },
    ],
};

export default preview;
