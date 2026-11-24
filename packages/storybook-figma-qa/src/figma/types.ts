// The results model and the Figma data it is measured against. Shared by the browser checks (setup.ts), the Node
// commands and the CLI. Browser-safe: no Node imports.

/** Run output, relative to the project root: per-story results JSON under `results/`, cell images beside it. */
export const RESULTS_DIR = 'figma-qa/.results';
/** Per-story results JSON, relative to the project root. */
export function resultsFile(storyId: string): string {
    return `${RESULTS_DIR}/results/${storyId}.json`;
}

/**
 * Figma's 2x export of one variant, relative to the project root. `refsDir` (config) holds one dir per component set:
 * manifest + one PNG per variant.
 */
export function refPng(refsDir: string, slug: string, variantId: string): string {
    return `${refsDir}/${slug}/${variantSlug(variantId)}.png`;
}

/** Figma export scale; the browser context runs at the same deviceScaleFactor. */
export const FIGMA_SCALE = 2;
/** Story tag that makes a story a Figma story. */
export const FIGMA_TAG = 'figma';

export type Box = { x: number; y: number; width: number; height: number };
export type Rgba = { r: number; g: number; b: number; a: number };

/** A node's visible solid strokes, composited. `sides`: per-side weights (top, right, bottom, left) if they differ. */
export type FigmaStroke = {
    weight: number;
    sides: [number, number, number, number] | null;
    align: 'INSIDE' | 'OUTSIDE' | 'CENTER';
    color: Rgba;
    dashed: boolean;
};

/** A DROP_SHADOW (`inset: false`) or INNER_SHADOW, in CSS `box-shadow` terms (Figma `radius` = CSS blur). */
export type FigmaShadow = { inset: boolean; x: number; y: number; blur: number; spread: number; color: Rgba };

/**
 * The auto-layout frame that arranges the variant's content: the root, or the frame reached through single-child
 * auto-layout wrappers (their padding shows as the content inset either way, so it is measured geometrically).
 * `children`: its visible in-flow children, boxes relative to the variant root.
 */
export type FigmaLayout = {
    direction: 'HORIZONTAL' | 'VERTICAL';
    /** primaryAxisAlignItems: MIN, CENTER, MAX, SPACE_BETWEEN. Visible only when the container doesn't hug. */
    primaryAlign: string;
    /** counterAxisAlignItems: MIN, CENTER, MAX, BASELINE. */
    counterAlign: string;
    wrap: boolean;
    /** The container hugs along its direction: no free space, so `primaryAlign` can't show. */
    hugPrimary: boolean;
    children: { name: string; text: boolean; box: Box }[];
};

/**
 * Leaf geometry is relative to the variant root, in CSS px. Colors are 0–255 sRGB, alpha 0–1; a fill is every visible
 * SOLID paint composited bottom to top. Optional fields are absent from manifests synced before they were measured.
 */
export type FigmaSpec = {
    root: {
        name: string;
        width: number;
        height: number;
        radius: [number, number, number, number];
        /** Figma `layoutSizingHorizontal: HUG`: the width follows the content (and so the text's glyph advances). */
        hugWidth?: boolean;
        fill: Rgba | null;
        /** Visible paints the fill can't express (GRADIENT_LINEAR, IMAGE, …). */
        fillTypes?: string[];
        /** Product of node opacities from the variant down to the painted surface. */
        opacity?: number;
        stroke?: FigmaStroke | null;
        shadows?: FigmaShadow[];
        /** Figma `blendMode` when it isn't NORMAL / PASS_THROUGH. */
        blendMode?: string | null;
        /** LAYER_BLUR / BACKGROUND_BLUR radius, as Figma stores it. */
        blur?: { layer: number | null; background: number | null };
        layout?: FigmaLayout | null;
        /** Variable ids (variables.ts) bound to these properties. */
        vars?: Partial<
            Record<
                'fill' | 'stroke' | 'radius' | 'gap' | 'paddingTop' | 'paddingRight' | 'paddingBottom' | 'paddingLeft',
                string
            >
        >;
    };
    texts: {
        characters: string;
        box: Box;
        fontFamily: string;
        fontSize: number;
        fontWeight: number;
        lineHeightPx: number;
        letterSpacing: number;
        color: Rgba | null;
        /** Figma enums. textCase: ORIGINAL, UPPER, LOWER, TITLE, SMALL_CAPS…; textDecoration: NONE, UNDERLINE… */
        textCase?: string;
        textDecoration?: string;
        textAlign?: string;
        /** WIDTH_AND_HEIGHT (box hugs the text: alignment can't show), HEIGHT, NONE, TRUNCATE. */
        autoResize?: string;
        truncate?: boolean;
        vars?: Partial<
            Record<'color' | 'fontSize' | 'lineHeight' | 'letterSpacing' | 'fontFamily' | 'fontWeight', string>
        >;
    }[];
    /** Glyph instances (no text inside), left-to-right then top-to-bottom. `component`: the main component's name. */
    icons: {
        name: string;
        component: string | null;
        box: Box;
        /** Topmost painted shape's fill (or stroke), alpha × every opacity from the instance down to it. */
        color?: Rgba | null;
        vars?: { color?: string };
    }[];
};

export type FigmaVariant = {
    /** Figma node id, e.g. `8882:16355`. */
    id: string;
    /** Figma's variant name, e.g. `Size=Big, State=Default`. */
    name: string;
    props: Record<string, string>;
    spec: FigmaSpec;
};

/** One component set, as cached in `<refsDir>/<slug>/manifest.json` next to one PNG per variant. */
export type FigmaSetManifest = {
    /**
     * `version`: the Figma file version synced (compared with `/meta` to warn that Figma changed since). `hash`: of the
     * set's raw `/nodes` subtree; images are re-rendered only when it changes.
     */
    source: {
        url: string;
        fileKey: string;
        nodeId: string;
        name: string;
        version: string;
        lastModified: string;
        hash: string;
    };
    /** VARIANT properties in Figma's order, each with its options in Figma's order: the matrix axes. */
    axes: { name: string; options: string[] }[];
    /** BOOLEAN properties. Figma renders only their defaults, so they can't be matrix axes. */
    booleans: { name: string; default: boolean }[];
    variants: FigmaVariant[];
};

/**
 * A known, deliberate deviation (ADR 0002): cells whose Figma props match `when` (every listed property takes one of
 * the listed options; omitted properties match anything) report `approved` instead of `fail`, with the reason shown.
 * They're still measured, so the numbers stay visible. Name the WCAG criterion or decision in `reason`.
 */
export type FigmaApproval = { when?: Record<string, string[]>; reason: string };

/**
 * One component set in a matrix: the `parameters.design` entry it checks (by `name`; a story with one Figma entry may
 * omit it), how to group its axes, and its approved deviations.
 */
export type FigmaMatrixBlock = { name?: string; layout: FigmaMatrixLayout; approved?: FigmaApproval[] };

/** Story parameter: hold every cell of this story's matrix blocks to their Figma variants. */
export type FigmaMatrixParameter = {
    blocks: FigmaMatrixBlock[];
    /** Share of pixels allowed to differ per cell. Default 5 %. */
    maxDiffRatio?: number;
    /** Approved spec deviations (ADR 0002) dropped from every cell; per-variant ones go in `approved`. */
    ignore?: FigmaIgnore[];
};

/** One `parameters.design` entry (addon-designs): only named `figma` entries link component sets. */
export type DesignEntry = { name?: string; type: string; url: string };

/**
 * Drops spec issues whose `property` equals this one (`Letter spacing`) and, when given, whose `element` equals this
 * one (`Text "FAN 1"`, `Component`). Matched on fields, not wording, so rephrasing a message can't un-ignore it.
 */
export type FigmaIgnore = { element?: string; property: string; reason: string };

/** Refs dir name of a component set: `fileKey-nodeId`, `:` → `-`. */
export function figmaSlug(fileKey: string, nodeId: string): string {
    return `${fileKey}-${variantSlug(nodeId)}`;
}

export function variantSlug(nodeId: string): string {
    return nodeId.replace(':', '-');
}

/**
 * One side of a spec issue. `note`: nearest kit token for colours. `swatch`: CSS colour to paint next to it. `tokens`:
 * the kit tokens this colour is (Figma's side: the token its variable names, else those equal by value; the story's:
 * those equal by value, or the one it is painted with); triage reads it (triage.ts).
 */
export type FigmaIssueValue = { text: string; note?: string; swatch?: string; tokens?: string[] };

/**
 * One spec property that differs from Figma, e.g. element `Text "FAN 1"`, property `Font size`, expected `12px`,
 * actual `10px`, delta `−2px`, tolerance `exact`. Rendered as expected/received rows by the panel and the report;
 * `figmaIssueText` (issues.ts) flattens it for test output.
 */
export type FigmaIssue = {
    element: string;
    property: string;
    /** Figma. */
    expected: FigmaIssueValue;
    /** The rendered story. */
    actual: FigmaIssueValue;
    /** Story minus Figma, for numeric properties: `+2px`, `−18 × +6px`. */
    delta?: string;
    /** What still counts as a match: `±1px`, `±3 per RGB channel`, `exact`. */
    tolerance: string;
    /** The measured element, from the component root: `button > span:nth-of-type(2) > svg`. */
    selector?: string;
    /**
     * Colour rows of text, glyphs and strokes: WCAG contrast against what each side is seen over, and the minimum
     * (1.4.3 text 4.5:1, 3:1 when large; 1.4.11 non-text 3:1). Absent where it doesn't apply (disabled controls).
     */
    contrast?: { figma: number; story: number; required: number; criterion: string };
};

export type FigmaCellResult = {
    variant: { id: string; name: string; props: Record<string, string> };
    /**
     * `missing`: Figma draws the variant, the code has no equivalent (renderCell returned null). `approved`: it
     * fails, but a FigmaApproval covers it. Neither fails the run.
     */
    status: 'pass' | 'fail' | 'approved' | 'missing';
    /** The FigmaApproval reason, when one matches. */
    approval: string | null;
    /** Why a `fail` cell fails, where code can tell (triage.ts); null otherwise and for every other status. */
    triage: TriageCategory | null;
    spec: { mismatches: FigmaIssue[]; ignored: FigmaIssue[] };
    image: {
        /** null when the comparator could not measure (e.g. sizes differ). */
        mismatchedPixels: number | null;
        /** Differing share of the area outside text masks (text is judged by spec). */
        ratio: number | null;
        maxRatio: number;
        /** Comparator message when it could not measure. */
        error: string | null;
        /**
         * The diff map, computed once in Node (node/diff-map.ts): differing pixels by kind, at 2x. `figma`: drawn only
         * in Figma; `story`: only in the story; `colour`: in both, another colour; `masked`: text, judged by spec.
         * null when the images couldn't be compared.
         */
        classes: DiffClasses | null;
        /** The colour change that dominates the `colour` pixels, as hex; null when none does. */
        pair: { figma: string; story: string } | null;
        /**
         * Largest connected differing region: `area` in CSS px², `box` in CSS px relative to the cell, and the element
         * drawn at its centre (a path from the component root). null when nothing differs.
         */
        blob: { area: number; box: Box; element: string | null } | null;
    };
    /**
     * Relative to the project root. `figma`: Figma's own export; `actual`: the cell's screenshot; `diff`: the diff map
     * (orange Figma only, blue story only, yellow other colour, hatched text, the rest dimmed).
     */
    files: { figma: string; actual: string | null; diff: string | null };
};

/** The diff map's colours (sRGB), shared by the image Node paints and the legend the UI draws. */
export const DIFF_COLOURS = { figma: [255, 138, 61], story: [77, 163, 255], colour: [255, 222, 89] } as const;

export type DiffClasses = { figma: number; story: number; colour: number; masked: number };

export type FigmaBlockResult = {
    /** `name`: the design entry; `set`: Figma's component set name. */
    set: { name: string; set: string; url: string; version: string };
    layout: FigmaMatrixLayout;
    axes: FigmaSetManifest['axes'];
    cells: FigmaCellResult[];
};

/** One Figma story's outcome: `${RESULTS_DIR}/results/<storyId>.json`. */
export type FigmaStoryResult = {
    storyId: string;
    title: string;
    name: string;
    blocks: FigmaBlockResult[];
    /** Harness or setup error that stopped the checks (misconfigured story, uncached set): not a design verdict. */
    error: string | null;
    /** Never fail the run: Figma changed since the refs were synced, Figma unreachable while refs are cached. */
    warnings: string[];
    ranAt: string;
};

/** How a matrix groups Figma's axes: one block per `sections` option, `columns` across, the rest down. */
export type FigmaMatrixLayout = { sections: string | null; columns: string };

export function parseFigmaUrl(url: string): { fileKey: string; nodeId: string } {
    const parsed = new URL(url);
    const fileKey = /\/(?:design|file)\/([^/]+)/.exec(parsed.pathname)?.[1];
    const nodeId = parsed.searchParams.get('node-id')?.replace('-', ':');
    if (!fileKey || !nodeId) {
        throw new Error(`Not a Figma node URL: ${url}`);
    }

    return { fileKey, nodeId };
}

/** `Text "FAN 1" · Font size: story 10px ≠ Figma 12px (−2px; allowed exact)`. Test output. */
export function figmaIssueText(issue: FigmaIssue): string {
    const delta = issue.delta ? `${issue.delta}; ` : '';

    return `${issue.element} · ${issue.property}: story ${issue.actual.text} ≠ Figma ${issue.expected.text} (${delta}allowed ${issue.tolerance})`;
}

/**
 * A failing cell's deterministic triage. `harness`: the cell couldn't be measured (capture blocked, sizes differ): not
 * a design verdict. `token`: a colour is another kit token than Figma's. `value`: a spec number is off.
 */
export type TriageCategory = 'harness' | 'token' | 'value';

/** A `fail` cell as the CLI prints it: its triage and a paste-ready entry for its block's `approved`. */
export type FailingCell = {
    /** The matrix block's design entry name. */
    block: string;
    variant: string;
    triage: TriageCategory | null;
    /**
     * A `FigmaApproval` literal matching this variant, reason left to fill. null for `harness`: no approval covers a
     * cell that couldn't be measured.
     */
    approved: string | null;
};

export type CellStatus = FigmaCellResult['status'];
export type CellCounts = Record<CellStatus, number>;

/** A story's outcome (verdict.ts). `error`: a harness or setup error stopped its checks: not a design verdict. */
export type StoryVerdict = 'pass' | 'fail' | 'error';

export type FigmaStorySummary = {
    storyId: string | null;
    title: string;
    name: string;
    file: string;
    verdict: StoryVerdict;
    cells: CellCounts;
    error: string | null;
    /** Per-story results JSON, relative to the project root. */
    results: string | null;
    failing: FailingCell[];
};

/** One run's outcome: printed by `report --json`, written to `RUN_FILE`. The panel and the HTML report render it. */
export type FigmaRunSummary = {
    exitCode: 0 | 1 | 2;
    /**
     * The stories ran in the host's Chromium, not the pinned browser image: pixels aren't comparable to CI. A
     * warning, never a verdict.
     */
    hostBrowser: boolean;
    cells: CellCounts;
    /** Story files Vitest collected: the scanned Figma story files the filters kept, relative to the project root. */
    files: string[];
    stories: FigmaStorySummary[];
    /** Errors outside any story: unloadable story files, unhandled errors, a missing Figma project. */
    errors: string[];
    /** Stories' warnings, deduplicated: never change the exit code. */
    warnings: string[];
    /** Milliseconds per phase, for the phases the run reached. `report` is missing from the HTML report it times. */
    timings: Partial<Record<RunPhase, number>>;
    /** The "Figma diff" panel of a running `storybook dev` for this project, at the first story worth a look. */
    panelUrl: string | null;
};

/** A report's phases, in order. Figma sync happens lazily inside `tests`. */
export const RUN_PHASES = ['doctor', 'browser', 'collect', 'tests', 'report'] as const;

export type RunPhase = (typeof RUN_PHASES)[number];

/** The run summary, relative to the project root. */
export const RUN_FILE = `${RESULTS_DIR}/run.json`;
/** `report --ci`'s markdown summary for the PR comment, relative to the project root. */
export const CI_SUMMARY_FILE = `${RESULTS_DIR}/summary.md`;
/** The HTML report: a self-contained directory (index.html plus the images it shows), relative to the project root. */
export const REPORT_DIR = `${RESULTS_DIR}/report`;
