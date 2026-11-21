// Pixel diff in Node: the cell's one screenshot against Figma's 2x export, flattened onto the page backdrop. Text
// boxes are masked identically on both images, so pixels judge fills, strokes, shadows and glyphs while text is
// judged by spec. Masks are painted on whole device pixels: both sides get exactly the same mask.
import type { Box } from '../figma/types.ts';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { FIGMA_SCALE } from '../figma/types.ts';

type Rgb = { r: number; g: number; b: number };

const MASK: Rgb = { r: 255, g: 0, b: 255 };
/** The iframe paints white under a transparent page; a screenshot can't keep alpha. */
const CANVAS: Rgb = { r: 255, g: 255, b: 255 };

/** `rgb(1, 2, 3)` / `rgba(1, 2, 3, 0.5)` / `rgb(1 2 3 / 50%)`, as `getComputedStyle` returns it, composited on white. */
export function parseBackdrop(css: string): Rgb {
    const match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(css.trim());
    if (!match) {
        throw new Error(`Unsupported backdrop colour: ${css}`);
    }
    const [, r = '0', g = '0', b = '0', alpha, unit] = match;
    const a = alpha === undefined ? 1 : Number(alpha) / (unit ? 100 : 1);
    const mix = (channel: string, under: number) => {
        return Math.round(Number(channel) * a + under * (1 - a));
    };

    return { r: mix(r, CANVAS.r), g: mix(g, CANVAS.g), b: mix(b, CANVAS.b) };
}

/** Source-over of a straight-alpha RGBA image onto an opaque colour, in place. */
function flatten(image: PNG, backdrop: Rgb): void {
    const { data } = image;
    for (let index = 0; index < data.length; index += 4) {
        const alpha = (data[index + 3] ?? 0) / 255;
        data[index] = Math.round((data[index] ?? 0) * alpha + backdrop.r * (1 - alpha));
        data[index + 1] = Math.round((data[index + 1] ?? 0) * alpha + backdrop.g * (1 - alpha));
        data[index + 2] = Math.round((data[index + 2] ?? 0) * alpha + backdrop.b * (1 - alpha));
        data[index + 3] = 255;
    }
}

/** Paints the masks (CSS px) at device scale on every image; returns the number of masked pixels. */
function paintMasks(images: PNG[], masks: Box[], width: number, height: number): number {
    const covered = new Uint8Array(width * height);
    for (const mask of masks) {
        const x0 = Math.max(0, Math.floor(mask.x * FIGMA_SCALE));
        const y0 = Math.max(0, Math.floor(mask.y * FIGMA_SCALE));
        const x1 = Math.min(width, Math.ceil((mask.x + mask.width) * FIGMA_SCALE));
        const y1 = Math.min(height, Math.ceil((mask.y + mask.height) * FIGMA_SCALE));
        for (let y = y0; y < y1; y++) {
            covered.fill(1, y * width + x0, y * width + Math.max(x0, x1));
        }
    }
    let count = 0;
    for (let pixel = 0; pixel < covered.length; pixel++) {
        if (!covered[pixel]) {
            continue;
        }
        count++;
        for (const image of images) {
            image.data[pixel * 4] = MASK.r;
            image.data[pixel * 4 + 1] = MASK.g;
            image.data[pixel * 4 + 2] = MASK.b;
            image.data[pixel * 4 + 3] = 255;
        }
    }

    return count;
}

export type PixelDiff =
    | { pixels: number; masked: number; diff: Buffer | null; error: null }
    | { pixels: null; masked: 0; diff: null; error: string };

/** Mismatched-pixel count at pixelmatch threshold 0.1 (the story's tolerance is applied by the caller). */
export function pixelDiff(reference: Buffer, screenshot: Buffer, backdrop: string, masks: Box[]): PixelDiff {
    const figma = PNG.sync.read(reference);
    const story = PNG.sync.read(screenshot);
    if (figma.width !== story.width || figma.height !== story.height) {
        return {
            pixels: null,
            masked: 0,
            diff: null,
            error: `Sizes differ: Figma ${figma.width}×${figma.height}, story ${story.width}×${story.height} (device px).`,
        };
    }
    const { width, height } = figma;
    flatten(figma, parseBackdrop(backdrop));
    flatten(story, CANVAS);
    const masked = paintMasks([figma, story], masks, width, height);
    const output = new PNG({ width, height });
    const pixels = pixelmatch(figma.data, story.data, output.data, width, height, { threshold: 0.1 });

    return { pixels, masked, diff: pixels > 0 ? PNG.sync.write(output) : null, error: null };
}
