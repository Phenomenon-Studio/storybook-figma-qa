// Vitest setup for the Figma project (browser side). After each Figma story renders, every `[data-figma-variant]`
// cell is held to its Figma variant: 1) spec: layout/type/colour within tolerance, 2) pixels: one screenshot sent to
// Node (`figmaPixelDiff`) and compared there within `maxDiffRatio`. `[data-figma-missing]` cells (no code equivalent)
// are recorded, not failed. Soft assertions, so one run reports every cell; the outcome is written per story.
// Registers no project annotations: `setProjectAnnotations` throws on Storybook 11.
import type { PixelDiffRequest, PixelDiffResponse } from './node/commands.ts';
import type { LoadedSets, ResolvedStory, SkipUnselected, StoryParameters } from './figma/story.ts';
import type {
    Box,
    FigmaApproval,
    FigmaBlockResult,
    FigmaCellResult,
    FigmaIssue,
    FigmaStoryResult,
} from './figma/types.ts';
import type { TestContext } from 'vitest';
import { afterEach, beforeEach, expect, inject } from 'vitest';
import { commands, page } from 'vitest/browser';
import { pathFrom, setVariables, figmaSpecMismatches, textMasks } from './figma/spec.ts';
import { projectConfig } from './figma/project.ts';
import { STORIES_KEY } from './constants.ts';
import { LOAD_SETS_HOOK, resolveStory, SKIP_HOOK } from './figma/story.ts';
import { globToRegExp } from './figma/story-scan.ts';
import { FIGMA_SCALE, FIGMA_TAG, figmaIssueText, refPng } from './figma/types.ts';

declare module 'vitest/browser' {
    interface BrowserCommands {
        figmaEnsureSets: (urls: string[]) => Promise<LoadedSets>;
        figmaPixelDiff: (request: PixelDiffRequest) => Promise<PixelDiffResponse>;
        figmaSaveStoryResult: (result: FigmaStoryResult) => Promise<void>;
    }
}

// The preview loader reads refs through this: preview code can't import Vitest.
Object.assign(globalThis, { [LOAD_SETS_HOOK]: commands.figmaEnsureSets });

// Story-id filters (`figma-qa report 'button--*'`): the CLI collected only files that may hold a match; the rest of
// a file's stories skip before they load. A file a component name matched runs whole.
const selection = inject(STORIES_KEY) ?? null;
if (selection) {
    const globs = selection.globs.map(globToRegExp);
    let current: TestContext | null = null;
    beforeEach((context) => {
        current = context;

        return () => {
            current = null;
        };
    });
    const skipUnselected: SkipUnselected = (storyId) => {
        const file = current?.task.file.filepath ?? '';
        const selected =
            selection.files.includes(file) ||
            globs.some((glob) => {
                return glob.test(storyId);
            });
        if (!selected) {
            current?.skip(`not selected by ${selection.globs.join(', ')}`);
        }
    };
    Object.assign(globalThis, { [SKIP_HOOK]: skipUnselected });
}

// Motion frozen so the one screenshot is the settled frame.
const STABILIZE_CSS = `
*, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    caret-color: transparent !important;
}
`;

beforeEach(() => {
    const style = document.createElement('style');
    style.dataset.figmaQa = '';
    style.textContent = STABILIZE_CSS;
    document.head.append(style);

    return () => {
        style.remove();
    };
});

/**
 * Frames the cell for capture: clipped to Figma's exact box, on a whole CSS pixel. Text widths are fractional and
 * Playwright rounds an element's clip out to whole CSS pixels, so an unclipped capture comes out a pixel off Figma's
 * export and can't be compared at all. Real size drift is the spec check's job (root size within 1px).
 */
function frameCell(cell: HTMLElement, root: Element, width: number, height: number) {
    Object.assign(cell.style, { width: `${width}px`, height: `${height}px`, overflow: 'hidden' });
    const rect = root.getBoundingClientRect();
    // A layout offset (the cell is `position: relative`), not `translate`: a fractional transform composites the cell
    // as a layer and shifts what is captured by a device pixel.
    cell.style.left = `${Math.round(rect.x) - rect.x}px`;
    cell.style.top = `${Math.round(rect.y) - rect.y}px`;
}

/** Points sampled over the cell, as fractions of its box: centre plus inset corners and edge midpoints. */
const PROBES = [0.5, 0.05, 0.95].flatMap((fx) => {
    return [0.5, 0.05, 0.95].map((fy) => {
        return [fx, fy] as const;
    });
});

/** Elements outside the cell drawn over it at a probe point (a sticky header, an open popup). */
function occluders(cell: HTMLElement): Element[] {
    const rect = cell.getBoundingClientRect();
    const found = new Set<Element>();
    for (const [fx, fy] of PROBES) {
        const hit = document.elementFromPoint(rect.x + rect.width * fx, rect.y + rect.height * fy);
        if (hit && !cell.contains(hit) && !hit.contains(cell)) {
            found.add(hit);
        }
    }

    return [...found];
}

function describe(element: Element): string {
    const id = element.id ? `#${element.id}` : '';
    const classes = [...element.classList]
        .slice(0, 2)
        .map((name) => {
            return `.${name}`;
        })
        .join('');

    return `${element.tagName.toLowerCase()}${id}${classes}`;
}

/**
 * Clears the cell for capture: centres it in the viewport, then hides whatever still covers it (the screenshot is a
 * viewport crop, so an overlapping element lands in the image). Returns the restore and anything left covering.
 */
function uncover(cell: HTMLElement): { restore: () => void; covered: string | null } {
    cell.scrollIntoView({ block: 'center', inline: 'center' });
    const hidden: { element: HTMLElement; visibility: string }[] = [];
    for (let pass = 0; pass < 5; pass++) {
        const hits = occluders(cell);
        if (hits.length === 0) {
            break;
        }
        for (const hit of hits) {
            if (hit instanceof HTMLElement || hit instanceof SVGElement) {
                const element = hit as HTMLElement;
                hidden.push({ element, visibility: element.style.visibility });
                element.style.visibility = 'hidden';
            }
        }
    }
    const left = occluders(cell)[0];

    return {
        restore: () => {
            for (const { element, visibility } of hidden.reverse()) {
                element.style.visibility = visibility;
            }
        },
        covered: left ? describe(left) : null,
    };
}

function approvalFor(approved: FigmaApproval[] | undefined, props: Record<string, string>): string | null {
    return (
        approved?.find((approval) => {
            return Object.entries(approval.when ?? {}).every(([name, options]) => {
                return options.includes(props[name] ?? '');
            });
        })?.reason ?? null
    );
}

/**
 * The diff map's largest region in CSS px relative to the cell, and the element drawn at its centre: Node only sees
 * pixels, the page knows what is there.
 */
function blobAt(cell: HTMLElement, root: Element, blob: PixelDiffResponse['blob']): FigmaCellResult['image']['blob'] {
    if (!blob) {
        return null;
    }
    const box = {
        x: blob.x / FIGMA_SCALE,
        y: blob.y / FIGMA_SCALE,
        width: blob.width / FIGMA_SCALE,
        height: blob.height / FIGMA_SCALE,
    };
    const rect = cell.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + box.x + box.width / 2, rect.y + box.y + box.height / 2);
    let element: string | null = null;
    if (hit && root.contains(hit)) {
        element = pathFrom(root, hit);
    }

    return { area: blob.pixels / FIGMA_SCALE ** 2, box, element };
}

type FigmaStory = { tags: string[]; parameters: StoryParameters };

/** Measures every cell of the story's matrix blocks. */
async function checkCells(storyId: string, story: FigmaStory, resolved: ResolvedStory): Promise<FigmaBlockResult[]> {
    const matrix = story.parameters.figmaMatrix;
    const config = projectConfig();
    const maxRatio = matrix?.maxDiffRatio ?? config.maxDiffRatio;
    const isIgnored = (issue: FigmaIssue) => {
        return (
            matrix?.ignore?.some((rule) => {
                return (
                    rule.property === issue.property && (rule.element === undefined || rule.element === issue.element)
                );
            }) ?? false
        );
    };
    await document.fonts.ready;
    const backdrop = getComputedStyle(document.documentElement).backgroundColor;
    setVariables(resolved.variables);

    const blocks: FigmaBlockResult[] = [];
    for (const { name, url, slug, block, manifest } of resolved.blocks) {
        const container = document.querySelector(`[data-figma-block="${CSS.escape(name)}"]`);
        if (!container) {
            throw new Error(`Matrix block "${name}" not rendered: render <FigmaMatrix> in the story.`);
        }
        const cells: FigmaCellResult[] = [];
        for (const variant of manifest.variants) {
            const variantRef = { id: variant.id, name: variant.name, props: variant.props };
            const cell = container.querySelector<HTMLElement>(`[data-figma-variant="${CSS.escape(variant.id)}"]`);
            const root = cell?.firstElementChild;
            if (!cell || !root) {
                // `[data-figma-missing]`, or left out by the layout: Figma draws it, the code doesn't.
                cells.push({
                    variant: variantRef,
                    status: 'missing',
                    approval: null,
                    spec: { mismatches: [], ignored: [] },
                    image: {
                        mismatchedPixels: null,
                        ratio: null,
                        maxRatio,
                        error: null,
                        classes: null,
                        pair: null,
                        blob: null,
                    },
                    files: { figma: refPng(config.refsDir, slug, variant.id), actual: null, diff: null },
                });
                continue;
            }
            // Spec first, on the unframed layout; then frame the cell for the pixel comparison.
            const all = figmaSpecMismatches(root, variant.spec);
            // Visible first: frameCell's sub-pixel shift reads the on-screen box.
            const view = uncover(cell);
            frameCell(cell, root, variant.spec.root.width, variant.spec.root.height);
            // Text is judged by spec; pixels judge everything else.
            const masks: Box[] = textMasks(root, variant.spec);
            const screenshot = await page.screenshot({ element: cell, save: false });
            view.restore();
            const diff = await commands.figmaPixelDiff({
                storyId,
                slug,
                variantId: variant.id,
                backdrop,
                masks,
                screenshot,
            });
            // A covered cell would compare the cover, not the component: report it instead of a pixel share.
            const error = view.covered
                ? `Capture blocked: ${view.covered} covers the cell. Harness issue, not a design diff.`
                : diff.error;
            const pixels = view.covered ? null : diff.pixels;
            const blob = view.covered ? null : blobAt(cell, root, diff.blob);
            const area = variant.spec.root.width * variant.spec.root.height * FIGMA_SCALE ** 2;
            // Share of what pixels judge: the area outside text masks, so masked text can't dilute a real difference.
            const ratio = pixels === null ? null : pixels / Math.max(1, area - diff.masked);
            const mismatches = all.filter((issue) => {
                return !isIgnored(issue);
            });
            const matches = mismatches.length === 0 && ratio !== null && ratio <= maxRatio;
            // An approval records a design deviation: it can't cover a cell that couldn't be measured.
            const approval = matches || error ? null : approvalFor(block.approved, variant.props);
            let status: FigmaCellResult['status'] = 'fail';
            if (matches) {
                status = 'pass';
            } else if (approval) {
                status = 'approved';
            }
            cells.push({
                variant: variantRef,
                status,
                approval,
                spec: { mismatches, ignored: all.filter(isIgnored) },
                image: {
                    mismatchedPixels: pixels,
                    ratio,
                    maxRatio,
                    error,
                    classes: view.covered ? null : diff.classes,
                    pair: view.covered ? null : diff.pair,
                    blob,
                },
                files: diff.files,
            });
        }
        if (
            cells.every((cell) => {
                return cell.status === 'missing';
            })
        ) {
            // A stubbed renderCell must fail visibly, not pass as "nothing in code".
            throw new Error(`Matrix block "${name}" rendered no cells: renderCell returned null for every variant.`);
        }
        blocks.push({
            set: { name, set: manifest.source.name, url, version: manifest.source.version },
            layout: block.layout,
            axes: manifest.axes,
            cells,
        });
    }

    return blocks;
}

afterEach(async (context) => {
    const story = (context as { story?: FigmaStory }).story;
    // Set by addon-vitest's story test.
    const meta = context.task.meta as { storyId?: string; componentName?: string };
    const storyId = meta.storyId;
    if (!story?.tags.includes(FIGMA_TAG) || !storyId) {
        return;
    }
    const result: FigmaStoryResult = {
        storyId,
        // Composed stories carry no title; addon-vitest records the component name instead.
        title: meta.componentName ?? context.task.file.name,
        name: context.task.name,
        blocks: [],
        error: null,
        warnings: [],
        ranAt: new Date().toISOString(),
    };
    const failed = context.task.result?.state === 'fail';
    try {
        if (failed) {
            const cause = context.task.result?.errors?.[0]?.message ?? 'unknown error';
            throw new Error(`Story failed before the Figma checks: ${cause}`);
        }
        const resolved = await resolveStory(story.parameters, commands.figmaEnsureSets);
        result.warnings = resolved.warnings;
        result.blocks = await checkCells(storyId, story, resolved);
    } catch (error) {
        result.error = error instanceof Error ? error.message : String(error);
    }
    await commands.figmaSaveStoryResult(result);
    if (failed) {
        return;
    }
    expect(result.error, 'Figma setup').toBeNull();

    const judged = result.blocks.flatMap((block) => {
        return block.cells.filter((cell) => {
            return cell.status === 'pass' || cell.status === 'fail';
        });
    });
    for (const cell of judged) {
        const label = cell.variant.name;
        expect.soft(cell.spec.mismatches.map(figmaIssueText), `Figma spec: ${label}`).toEqual([]);
        expect.soft(cell.image.error, `Figma image: ${label}`).toBeNull();
        if (cell.image.ratio !== null) {
            expect
                .soft(cell.image.ratio, `Figma image: ${label}: ${(cell.image.ratio * 100).toFixed(2)} % differ`)
                .toBeLessThanOrEqual(cell.image.maxRatio);
        }
    }
});
