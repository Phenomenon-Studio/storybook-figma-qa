// The HTML report's body (node/html-report.ts renders the same tree to static markup), and its agreement with the
// panel: for the same results both show the same verdict per story.
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { PanelView } from '../src/ui/panel-view.tsx';
import { ReportBody } from '../src/ui/report-page.tsx';
import { ALL, FAIL, FIGMA_CHANGED, fileUrl, PASS, RENDER_FAILED, runOf, TRIAGED } from './results.ts';

const meta = {
    title: 'Report',
    component: ReportBody,
    args: { run: runOf(ALL, false, [RENDER_FAILED]), results: ALL, fileUrl },
    decorators: [
        (Story) => {
            return (
                <div className="fqa" style={{ minHeight: '100vh' }}>
                    <Story />
                </div>
            );
        },
    ],
} satisfies Meta<typeof ReportBody>;

export default meta;

type Story = StoryObj<typeof meta>;

function verdicts(root: Element): Record<string, string | null> {
    return Object.fromEntries(
        [...root.querySelectorAll('[data-story-id]')].map((section) => {
            return [section.getAttribute('data-story-id'), section.getAttribute('data-verdict')];
        })
    );
}

/** Pass, fail, approved, harness error, render failure and Figma-changed stories in one run: exit 2. */
export const EveryCase: Story = {
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.getByRole('heading', { level: 1, name: 'Figma report' })).toBeVisible();
        await expect(canvas.getByText(/harness or setup error stopped some checks/)).toBeVisible();
        await expect(verdicts(canvasElement)).toEqual({
            'swatch--pass': 'pass',
            'swatch--fail': 'fail',
            'swatch--approved': 'pass',
            'swatch--harness-error': 'error',
            'swatch--figma-changed': 'pass',
            'swatch--render-failed': 'error',
        });
        await expect(canvas.getAllByRole('alert')).toHaveLength(2);
        await expect(canvas.getByRole('note')).toHaveTextContent(/Figma changed since/);
    },
};

export const HostBrowser: Story = {
    args: { run: runOf([PASS], true), results: [PASS] },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.getByText(/Every cell matches Figma/)).toBeVisible();
        await expect(canvas.getByRole('note')).toHaveTextContent(/pixels are not comparable to CI/);
    },
};

/** Phase timings, in run order, as the CLI measured them. */
export const Timings: Story = {
    args: { run: runOf([PASS]), results: [PASS] },
    play: async ({ canvasElement }) => {
        const timings = within(canvasElement).getByRole('list', { name: 'Timings' });
        await expect(
            [...timings.querySelectorAll('li')].map((item) => {
                return item.textContent;
            })
        ).toEqual(['doctor 0.0 s', 'browser 1.2 s', 'collect 0.9 s', 'tests 14.3 s']);
    },
};

export const Fails: Story = {
    args: { run: runOf([PASS, FAIL, FIGMA_CHANGED]), results: [PASS, FAIL, FIGMA_CHANGED] },
    play: async ({ canvasElement }) => {
        await expect(within(canvasElement).getByText('Some cells differ from Figma.')).toBeVisible();
    },
};

/** The report shows the same triage categories as the panel. */
export const Triaged: Story = {
    args: { run: runOf([TRIAGED]), results: [TRIAGED] },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.getByText('Harness: not a design diff')).toBeVisible();
        await expect(canvas.getByText('Token: another kit token')).toBeVisible();
        await expect(canvas.getByText('Value: spec number off')).toBeVisible();
    },
};

/** The report and the panel, side by side, for the same results: every story's verdict agrees. */
export const SameVerdictsAsPanel: Story = {
    render: (args) => {
        return (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                <div data-testid="report">
                    <ReportBody {...args} />
                </div>
                <div data-testid="panels">
                    {args.run.stories.map((story) => {
                        const result = args.results.find((candidate) => {
                            return candidate.storyId === story.storyId;
                        });

                        return (
                            <PanelView
                                key={story.storyId}
                                storyId={story.storyId ?? ''}
                                figmaStory
                                result={result ?? null}
                                run={args.run}
                                fileUrl={args.fileUrl}
                                reloading={false}
                                onReload={() => {}}
                            />
                        );
                    })}
                </div>
            </div>
        );
    },
    play: async ({ canvas }) => {
        const report = verdicts(canvas.getByTestId('report'));
        await expect(Object.keys(report)).toHaveLength(ALL.length + 1);
        await expect(verdicts(canvas.getByTestId('panels'))).toEqual(report);
    },
};
