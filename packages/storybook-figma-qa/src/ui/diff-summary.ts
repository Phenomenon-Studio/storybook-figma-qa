// One line under the diff map: what each colour means for this cell, biggest first, in CSS px (the images are 2x).
// Browser-safe: the panel and the HTML report both print it from the counts the run persisted.
import type { DiffClasses, FigmaCellResult } from '../figma/types.ts';
import { FIGMA_SCALE } from '../figma/types.ts';

function px(count: number): string {
    return `${Math.max(1, Math.round(count / FIGMA_SCALE ** 2)).toLocaleString('en-GB')} px`;
}

export function diffSummary(classes: DiffClasses, pair: FigmaCellResult['image']['pair']): string {
    const parts: { n: number; text: string }[] = [];
    if (classes.colour > 0) {
        const change = pair ? ` (Figma ${pair.figma} → story ${pair.story})` : '';
        parts.push({ n: classes.colour, text: `yellow: same shape, other colour on ${px(classes.colour)}${change}` });
    }
    if (classes.figma > 0) {
        parts.push({
            n: classes.figma,
            text: `orange: ${px(classes.figma)} drawn only in Figma (missing, moved or smaller in the story)`,
        });
    }
    if (classes.story > 0) {
        parts.push({
            n: classes.story,
            text: `blue: ${px(classes.story)} drawn only in the story (extra, moved or larger)`,
        });
    }
    const lines = parts
        .sort((a, b) => {
            return b.n - a.n;
        })
        .map((part) => {
            return part.text;
        });
    // Orange and blue in similar amounts: the same shape sits elsewhere or at another size.
    const { figma, story } = classes;
    if (figma > 0 && story > 0 && Math.max(figma, story) <= Math.min(figma, story) * 2.5) {
        lines.unshift('Shapes shifted or resized: orange where Figma draws, blue where the story draws instead');
    }
    if (lines.length === 0) {
        lines.push('No pixel above the comparison threshold; the raw count comes from anti-aliasing');
    }
    if (classes.masked > 0) {
        lines.push('hatched: text, checked by properties instead of pixels');
    }

    return `${lines.join(' · ')}.`;
}
