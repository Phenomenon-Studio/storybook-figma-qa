import { definePreviewAddon } from 'storybook/internal/csf';
import { COMPARE_GLOBAL } from './constants.ts';

/** CSF Next preview addon: `definePreview({ addons: [figmaQa()] })`. */
export default function figmaQa() {
    return definePreviewAddon({
        // Storybook drops undeclared globals, so the panel can only set the compare mode once it's declared.
        initialGlobals: { [COMPARE_GLOBAL]: 'off' },
    });
}
