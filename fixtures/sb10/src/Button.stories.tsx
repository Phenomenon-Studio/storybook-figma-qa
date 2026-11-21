import preview from '../.storybook/preview.ts';
import { Button } from './Button.tsx';

const meta = preview.meta({
    title: 'Button',
    component: Button,
    args: { children: 'Button' },
});

export const Default = meta.story();
