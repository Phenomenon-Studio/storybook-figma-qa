// The "Figma diff" panel's content for each kind of result. The panel itself only fetches (manager.tsx).
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { PanelView } from '../src/ui/panel-view.tsx';
import { APPROVED, FAIL, FIGMA_CHANGED, fileUrl, HARNESS_ERROR, PASS, RENDER_FAILED, runOf } from './results.ts';

const meta = {
    title: 'Panel',
    component: PanelView,
    args: { figmaStory: true, run: runOf([PASS]), fileUrl, reloading: false, onReload: fn() },
} satisfies Meta<typeof PanelView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Pass: Story = {
    args: { storyId: PASS.storyId, result: PASS },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.getByText('Matches Figma')).toBeVisible();
        await expect(canvas.getByText('Figma draws this variant; the code has no equivalent.')).toBeInTheDocument();
        await expect(canvas.queryByRole('note')).toBeNull();
    },
};

export const Fail: Story = {
    args: { storyId: FAIL.storyId, result: FAIL },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.getByText('Differs from Figma')).toBeVisible();
        // A failing cell opens on its evidence: the three images, the diff map's reading and the property table.
        await expect(canvas.getByRole('img', { name: 'What differs' })).toBeVisible();
        await expect(canvas.getByText(/yellow: same shape, other colour on 558 px \(Figma #adb5bd → story #868e96\)/)).toBeVisible();
        await expect(canvas.getByRole('table', { name: 'Properties that differ' })).toBeVisible();
        await expect(canvas.getByRole('cell', { name: 'hsl(210 10.8% 71%)' })).toBeVisible();
    },
};

export const Approved: Story = {
    args: { storyId: APPROVED.storyId, result: APPROVED },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.getByText('Matches Figma')).toBeVisible();
        // Approved cells stay closed; their evidence is one click away.
        await userEvent.click(canvas.getByText('Size=Small, Tone=Neutral'));
        await expect(canvas.getByText(/WCAG 1\.4\.11/)).toBeVisible();
    },
};

export const HarnessError: Story = {
    args: { storyId: HARNESS_ERROR.storyId, result: HARNESS_ERROR },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.getByText('Harness error')).toBeVisible();
        await expect(canvas.getByRole('alert')).toHaveTextContent(/not a design verdict.*no `parameters\.figmaMatrix\.blocks`/);
    },
};

export const HostBrowser: Story = {
    args: { storyId: PASS.storyId, result: PASS, run: runOf([PASS], true) },
    play: async ({ canvasElement }) => {
        await expect(within(canvasElement).getByRole('note')).toHaveTextContent(/pixels are not comparable to CI/);
    },
};

export const FigmaChanged: Story = {
    args: { storyId: FIGMA_CHANGED.storyId, result: FIGMA_CHANGED },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        // A warning, never a verdict.
        await expect(canvas.getByText('Matches Figma')).toBeVisible();
        await expect(canvas.getByRole('note')).toHaveTextContent(/Figma changed since .* was synced/);
    },
};

/** The story wrote no results: the run summary says why, with the CLI's verdict. */
export const RenderFailed: Story = {
    args: { storyId: RENDER_FAILED.storyId ?? '', result: null, run: runOf([PASS], false, [RENDER_FAILED]) },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.getByText('Harness error')).toBeVisible();
        await expect(canvas.getByRole('alert')).toHaveTextContent(/Story failed before the Figma checks/);
    },
};

export const NoResults: Story = {
    args: { storyId: 'swatch--never-run', result: null, run: null },
    play: async ({ canvasElement, args }) => {
        const canvas = within(canvasElement);
        await expect(canvas.getByText(/No Figma results for this story yet/)).toBeVisible();
        await userEvent.click(canvas.getByRole('button', { name: 'Reload results' }));
        await expect(args.onReload).toHaveBeenCalledOnce();
    },
};

export const NotAFigmaStory: Story = {
    args: { storyId: 'button--default', figmaStory: false, result: undefined, run: undefined },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.getByText(/Not a Figma story/)).toBeVisible();
        await expect(canvas.queryByRole('button')).toBeNull();
    },
};
