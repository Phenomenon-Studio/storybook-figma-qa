/** @jsxRuntime classic */
// Classic JSX: these render in Storybook 10's manager, which shares `react` but not `react/jsx-runtime`.
// What the panel and the HTML report both show for a story's results. Static markup (no state, no effects), so the
// report renders it on the server with the same components; the verdict comes from verdict.ts in both.
import type {
    CellCounts,
    CellStatus,
    FigmaBlockResult,
    FigmaCellResult,
    FigmaIssue,
    StoryVerdict,
    TriageCategory,
} from '../figma/types.ts';
import React from 'react';
import { countCells, storyVerdict } from '../figma/verdict.ts';
import { diffSummary } from './diff-summary.ts';

/** Maps a project-relative file (`files` of a cell result) to a URL the page can load. */
export type FileUrl = (projectPath: string) => string;

const VERDICT_LABEL: Record<StoryVerdict, string> = {
    pass: 'Matches Figma',
    fail: 'Differs from Figma',
    error: 'Harness error',
};

const STATUS_LABEL: Record<CellStatus, string> = {
    pass: 'Pass',
    fail: 'Fail',
    approved: 'Approved',
    missing: 'No code',
};

const TRIAGE_LABEL: Record<TriageCategory, string> = {
    harness: 'Harness: not a design diff',
    token: 'Token: another kit token',
    value: 'Value: spec number off',
};

export function VerdictBadge({ verdict }: { verdict: StoryVerdict }) {
    return (
        <span className="fqa-badge" data-tone={verdict}>
            {VERDICT_LABEL[verdict]}
        </span>
    );
}

export function Counts({ cells }: { cells: CellCounts }) {
    const order = ['pass', 'fail', 'approved', 'missing'] as const;

    return (
        <ul className="fqa-counts" aria-label="Cells">
            {order.map((status) => {
                return (
                    <li key={status} data-tone={status}>
                        <b>{cells[status]}</b> {STATUS_LABEL[status].toLowerCase()}
                    </li>
                );
            })}
        </ul>
    );
}

function ErrorNotice({ error }: { error: string }) {
    return (
        <p className="fqa-notice" data-kind="error" role="alert">
            <strong>Harness error, not a design verdict.</strong> {error}
        </p>
    );
}

/** Run-wide notices: the host-browser banner and errors no story owns. */
export function RunNotices({ hostBrowser, errors }: { hostBrowser: boolean; errors: readonly string[] }) {
    return (
        <>
            {hostBrowser && (
                <p className="fqa-notice" data-kind="warning" role="note">
                    <strong>Host browser.</strong> These screenshots come from this machine's Chromium, not the pinned
                    CI browser: pixels are not comparable to CI. A warning, not a verdict.
                </p>
            )}
            {errors.map((error) => {
                return <ErrorNotice key={error} error={error} />;
            })}
        </>
    );
}

function percent(ratio: number): string {
    return `${(ratio * 100).toFixed(2)} %`;
}

function IssueTable({ caption, issues }: { caption: string; issues: FigmaIssue[] }) {
    return (
        <table className="fqa-issues">
            <caption>{caption}</caption>
            <thead>
                <tr>
                    <th scope="col">Element</th>
                    <th scope="col">Property</th>
                    <th scope="col">Figma</th>
                    <th scope="col">Story</th>
                    <th scope="col">Δ</th>
                    <th scope="col">Allowed</th>
                </tr>
            </thead>
            <tbody>
                {issues.map((issue) => {
                    return (
                        <tr key={`${issue.element}·${issue.property}`}>
                            <td>{issue.element}</td>
                            <td>{issue.property}</td>
                            <td>{issue.expected.text}</td>
                            <td>{issue.actual.text}</td>
                            <td>{issue.delta ?? ''}</td>
                            <td>{issue.tolerance}</td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
}

function Picture({ caption, file, fileUrl }: { caption: string; file: string; fileUrl: FileUrl }) {
    return (
        <figure>
            <a href={fileUrl(file)} target="_blank" rel="noreferrer">
                <img src={fileUrl(file)} alt={caption} />
            </a>
            <figcaption>{caption}</figcaption>
        </figure>
    );
}

function Cell({ cell, fileUrl }: { cell: FigmaCellResult; fileUrl: FileUrl }) {
    const { image, spec, files } = cell;
    const summary = image.classes ? diffSummary(image.classes, image.pair) : null;

    return (
        <li className="fqa-cell" data-status={cell.status}>
            <details open={cell.status === 'fail'}>
                <summary>
                    <span className="fqa-badge" data-tone={cell.status}>
                        {STATUS_LABEL[cell.status]}
                    </span>
                    <span className="fqa-cell__name">{cell.variant.name}</span>
                    {cell.triage && <span className="fqa-tag">{TRIAGE_LABEL[cell.triage]}</span>}
                    {image.ratio !== null && (
                        <span className="fqa-muted">
                            {percent(image.ratio)} pixels differ (allowed {percent(image.maxRatio)})
                        </span>
                    )}
                </summary>
                <div className="fqa-cell__body">
                    {cell.status === 'missing' && (
                        <p className="fqa-muted">Figma draws this variant; the code has no equivalent.</p>
                    )}
                    {cell.approval && (
                        <p>
                            <strong>Approved deviation:</strong> {cell.approval}
                        </p>
                    )}
                    {image.error && (
                        <p className="fqa-notice" data-kind="error">
                            {image.error}
                        </p>
                    )}
                    <div className="fqa-images">
                        <Picture caption="Figma" file={files.figma} fileUrl={fileUrl} />
                        {files.actual && <Picture caption="Story" file={files.actual} fileUrl={fileUrl} />}
                        {files.diff && <Picture caption="What differs" file={files.diff} fileUrl={fileUrl} />}
                    </div>
                    {files.diff && summary && (
                        <p>
                            <span className="fqa-key" aria-hidden="true">
                                <i data-class="colour" />
                                <i data-class="figma" />
                                <i data-class="story" />
                            </span>
                            {summary}
                            {image.blob?.element && (
                                <>
                                    {' '}
                                    Largest region at <code>{image.blob.element}</code>.
                                </>
                            )}
                        </p>
                    )}
                    {spec.mismatches.length > 0 && (
                        <IssueTable caption="Properties that differ" issues={spec.mismatches} />
                    )}
                    {spec.ignored.length > 0 && <IssueTable caption="Ignored by the story" issues={spec.ignored} />}
                </div>
            </details>
        </li>
    );
}

function Block({ block, fileUrl }: { block: FigmaBlockResult; fileUrl: FileUrl }) {
    return (
        <div className="fqa-block">
            <div className="fqa-block__head">
                <h3>{block.set.name}</h3>
                <span className="fqa-muted">Figma set “{block.set.set}”</span>
                <a href={block.set.url} target="_blank" rel="noreferrer">
                    Open in Figma
                </a>
            </div>
            <ul className="fqa-cells">
                {block.cells.map((cell) => {
                    return <Cell key={cell.variant.id} cell={cell} fileUrl={fileUrl} />;
                })}
            </ul>
        </div>
    );
}

export type StorySectionProps = {
    storyId: string | null;
    title: string;
    name: string;
    /** Harness or setup error: the story result's, or why none was written. */
    error: string | null;
    blocks: FigmaBlockResult[];
    warnings: string[];
    fileUrl: FileUrl;
};

/** One Figma story's results, with its verdict. */
export function StorySection({ storyId, title, name, error, blocks, warnings, fileUrl }: StorySectionProps) {
    const cells = countCells(blocks);
    const verdict = storyVerdict(error, cells);

    return (
        // An article, not a labelled section: the panel and the report may show the same story twice on one page, and
        // landmarks must be unique.
        <article className="fqa-story" data-story-id={storyId ?? ''} data-verdict={verdict}>
            <div className="fqa-story__head">
                <h2>
                    {title} › {name}
                </h2>
                <VerdictBadge verdict={verdict} />
                {!error && <Counts cells={cells} />}
            </div>
            {error && <ErrorNotice error={error} />}
            {warnings.map((warning) => {
                return (
                    <p key={warning} className="fqa-notice" data-kind="warning" role="note">
                        <strong>Warning.</strong> {warning}
                    </p>
                );
            })}
            {!error &&
                blocks.map((block) => {
                    return <Block key={block.set.name} block={block} fileUrl={fileUrl} />;
                })}
        </article>
    );
}
