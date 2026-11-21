import { definePreview } from '@storybook/react-vite';
import figmaQa from '@phenomenon-studio/storybook-figma-qa/preview';

// CSF Next ignores preset `previewAnnotations`: the kit's preview side must be listed here.
export default definePreview({
    addons: [figmaQa()],
});
