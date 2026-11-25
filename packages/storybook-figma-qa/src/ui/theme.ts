// One stylesheet for the Storybook "Figma diff" panel and the HTML report, so both read the same. Kit-owned and dark,
// not configurable. Scoped under `.fqa`: the panel injects it into Storybook's manager, which it must not restyle.
// System fonts only: the report is opened from disk and CI artifacts, often offline.
import { DIFF_COLOURS } from '../figma/types.ts';

function rgb([r, g, b]: readonly number[]): string {
    return `rgb(${r} ${g} ${b})`;
}

export const FIGMA_QA_CSS = `
.fqa {
    --bg: #0a0a0b; --panel: #0d0d0f; --raised: #151518; --line: #26262b; --line-2: #34343a;
    --ink: #f4f4f2; --soft: #c9c9cf; --muted: #a1a1aa;
    --pass: #3dd68c; --fail: #ff8a5c; --approved: #c9c0ff; --missing: #a1a1aa; --error: #ff6b6b; --warn: #ffd166;
    --text: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
    --mono: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    color-scheme: dark;
    background: var(--panel); color: var(--ink); font: 400 13px/1.5 var(--text);
}
.fqa *, .fqa *::before, .fqa *::after { box-sizing: border-box; }
.fqa a { color: var(--ink); }
.fqa :focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.fqa h1, .fqa h2, .fqa h3 { margin: 0; font-weight: 600; line-height: 1.2; }
.fqa h1 { font-size: 22px; }
.fqa h2 { font-size: 16px; }
.fqa h3 { font-size: 13px; }
.fqa p { margin: 0; }
.fqa code { font-family: var(--mono); font-size: 12px; }
.fqa-muted { color: var(--muted); }

.fqa [data-tone='pass'] { --tone: var(--pass); }
.fqa [data-tone='fail'] { --tone: var(--fail); }
.fqa [data-tone='approved'] { --tone: var(--approved); }
.fqa [data-tone='missing'] { --tone: var(--missing); }
.fqa [data-tone='error'] { --tone: var(--error); }
.fqa-badge { display: inline-flex; align-items: center; height: 22px; padding: 0 9px; border-radius: 999px;
    border: 1px solid var(--tone); color: var(--tone); font-size: 12px; font-weight: 600; white-space: nowrap; }
.fqa-tag { display: inline-flex; align-items: center; height: 22px; padding: 0 8px; border-radius: 6px;
    background: var(--raised); color: var(--soft); font-size: 12px; white-space: nowrap; }
.fqa-counts { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 0; padding: 0; list-style: none; color: var(--soft); font-size: 12px; }
.fqa-counts b { color: var(--tone); font-weight: 600; }

.fqa-notice { padding: 10px 12px; border-radius: 8px; border: 1px solid var(--tone, var(--line-2)); background: var(--raised); }
.fqa-notice[data-kind='warning'] { --tone: var(--warn); }
.fqa-notice[data-kind='error'] { --tone: var(--error); }
.fqa-notice strong { color: var(--tone); }

.fqa-story { display: flex; flex-direction: column; gap: 14px; }
.fqa-story__head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
.fqa-block { display: flex; flex-direction: column; gap: 8px; }
.fqa-block__head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; }
.fqa-cells { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; }
.fqa-cell { border: 1px solid var(--line); border-radius: 8px; background: var(--bg); }
.fqa-cell[data-status='fail'] { border-color: var(--fail); }
.fqa-cell > details > summary { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 8px 12px; cursor: pointer; }
.fqa-cell__name { font-family: var(--mono); font-size: 12px; }
.fqa-cell__body { display: flex; flex-direction: column; gap: 12px; padding: 4px 12px 12px; }
.fqa-images { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; margin: 0; }
.fqa-images figure { margin: 0; display: flex; flex-direction: column; gap: 4px; }
.fqa-images figcaption { font-size: 11px; color: var(--muted); }
.fqa-images img { display: block; max-width: 100%; height: auto; border-radius: 4px; background: #fff;
    image-rendering: pixelated; border: 1px solid var(--line); }
.fqa-key { display: inline-flex; gap: 3px; margin-right: 6px; vertical-align: middle; }
.fqa-key i { width: 9px; height: 9px; border-radius: 2px; }
.fqa-key i[data-class='figma'] { background: ${rgb(DIFF_COLOURS.figma)}; }
.fqa-key i[data-class='story'] { background: ${rgb(DIFF_COLOURS.story)}; }
.fqa-key i[data-class='colour'] { background: ${rgb(DIFF_COLOURS.colour)}; }
.fqa-issues { width: 100%; border-collapse: collapse; font-size: 12px; }
.fqa-issues caption { text-align: left; padding-bottom: 4px; color: var(--soft); }
.fqa-issues th, .fqa-issues td { padding: 5px 8px; border-top: 1px solid var(--line); text-align: left; vertical-align: top; }
.fqa-issues th { color: var(--muted); font-weight: 500; }
.fqa-issues td { font-family: var(--mono); overflow-wrap: anywhere; }
.fqa-notes { display: flex; flex-direction: column; gap: 6px; padding: 8px 12px; border-left: 2px solid var(--line-2); }
.fqa-notes ul { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
.fqa-notes li { display: flex; flex-direction: column; gap: 2px; }
/* REST sends notes as plain text: its line breaks are the only structure left. */
.fqa-note { white-space: pre-line; overflow-wrap: anywhere; }

.fqa-page { max-width: 1100px; margin: 0 auto; padding: 32px 20px 64px; display: flex; flex-direction: column; gap: 28px; }
.fqa-page > header { display: flex; flex-direction: column; gap: 10px; }
.fqa-page > article + article { padding-top: 24px; border-top: 1px solid var(--line); }
.fqa-panel { display: flex; flex-direction: column; gap: 14px; padding: 14px 16px 24px;
    /* Fill the addon panel: short results would otherwise leave the manager's light background below them. */
    min-height: 100%; }
.fqa-panel__bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.fqa-btn { height: 28px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--line-2); background: transparent;
    color: var(--ink); font: inherit; font-size: 12px; cursor: pointer; }
.fqa-btn:disabled { color: var(--muted); cursor: default; }
`;
