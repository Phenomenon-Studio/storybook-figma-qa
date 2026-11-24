// The diff map: classifies each pixel that differs between the two images the pixel diff compared (Figma flattened on
// the backdrop, the story screenshot, text masked on both), instead of pixelmatch's raw diff, where a colour change
// and a moved edge look the same. Computed once, when the cell's result is written; the panel and the HTML report only
// show the image and the numbers. Orange: drawn only in Figma; blue: drawn only in the story; yellow: drawn in both,
// another colour; hatched: text (judged by spec); the rest is the story, dimmed.
import type { DiffClasses } from '../figma/types.ts';
import { DIFF_COLOURS } from '../figma/types.ts';

/** Straight RGBA, 4 bytes per pixel (a pngjs `PNG`). */
export type Pixels = { width: number; height: number; data: Uint8Array };

export type DiffMap = {
    /** RGBA, same size as the inputs. */
    image: Uint8Array;
    classes: DiffClasses;
    /** The dominant colour change, as hex; null when the colour pixels are a scatter of edge tones. */
    pair: { figma: string; story: string } | null;
    /** Largest 8-connected region of differing pixels (text masks excluded), in image pixels. */
    blob: { pixels: number; x: number; y: number; width: number; height: number } | null;
};

const SAME = 0;
const FIGMA = 1;
const STORY = 2;
const COLOUR = 3;
const MASK = 4;

/**
 * YIQ colour distance at threshold 0.1 (pixelmatch's metric before v8, no anti-alias detection). It only sorts pixels
 * for the picture: the verdict counts what pixelmatch itself finds.
 */
const LIMIT = 35215 * 0.1 * 0.1;

function yiq(r: number, g: number, b: number): [number, number, number] {
    return [
        r * 0.29889531 + g * 0.58662247 + b * 0.11448223,
        r * 0.59597799 - g * 0.2741761 - b * 0.32180189,
        r * 0.21147017 - g * 0.52261711 + b * 0.31114694,
    ];
}

function distance(a: Uint8Array, i: number, b: Uint8Array, j: number): number {
    const [y1, i1, q1] = yiq(a[i] ?? 0, a[i + 1] ?? 0, a[i + 2] ?? 0);
    const [y2, i2, q2] = yiq(b[j] ?? 0, b[j + 1] ?? 0, b[j + 2] ?? 0);

    return 0.5053 * (y1 - y2) ** 2 + 0.299 * (i1 - i2) ** 2 + 0.1957 * (q1 - q2) ** 2;
}

function hex(rgb: number[]): string {
    return `#${rgb
        .map((value) => {
            return Math.round(value).toString(16).padStart(2, '0');
        })
        .join('')}`;
}

/** The most common colour on an image's border ring. */
function ringColour(image: Pixels): Uint8Array {
    const { width, height, data } = image;
    const ring = new Map<number, number>();
    const add = (x: number, y: number) => {
        const o = (y * width + x) * 4;
        const key = ((data[o] ?? 0) << 16) | ((data[o + 1] ?? 0) << 8) | (data[o + 2] ?? 0);
        ring.set(key, (ring.get(key) ?? 0) + 1);
    };
    for (let x = 0; x < width; x++) {
        add(x, 0);
        add(x, height - 1);
    }
    for (let y = 0; y < height; y++) {
        add(0, y);
        add(width - 1, y);
    }
    const [key = 0] =
        [...ring].sort((a, b) => {
            return b[1] - a[1];
        })[0] ?? [];

    return new Uint8Array([(key >> 16) & 255, (key >> 8) & 255, key & 255]);
}

function isMask(data: Uint8Array, o: number): boolean {
    return data[o] === 255 && data[o + 1] === 0 && data[o + 2] === 255;
}

/**
 * The ground "drawn" is measured against: the reference's border ring (the page around rounded corners, or the
 * component's own base fill when it is a full rectangle, so shapes on it still read as drawn). When that base fill is
 * itself what changed, the ring differs between the images and the page backdrop is the ground instead: the fill then
 * reads as a colour change, not as drawn only in the story.
 */
function groundOf(reference: Pixels, actual: Pixels, backdrop: Uint8Array): Uint8Array {
    const ring = ringColour(reference);

    return distance(ring, 0, ringColour(actual), 0) > LIMIT ? backdrop : ring;
}

/** One class per pixel; the anti-aliased edge of a moved or resized shape joins that shape's class. */
function classify(reference: Pixels, actual: Pixels, backdrop: Uint8Array): Uint8Array {
    const { width, height } = reference;
    const ref = reference.data;
    const act = actual.data;
    const ground = groundOf(reference, actual, backdrop);
    const classes = new Uint8Array(width * height);
    for (let p = 0; p < classes.length; p++) {
        const o = p * 4;
        if (isMask(ref, o) || isMask(act, o)) {
            classes[p] = MASK;
        } else if (distance(ref, o, act, o) > LIMIT) {
            const inFigma = distance(ref, o, ground, 0) > LIMIT;
            const inStory = distance(act, o, ground, 0) > LIMIT;
            if (inFigma && !inStory) {
                classes[p] = FIGMA;
            } else if (inStory && !inFigma) {
                classes[p] = STORY;
            } else {
                classes[p] = COLOUR;
            }
        }
    }
    const settled = new Uint8Array(classes);
    for (let p = 0; p < classes.length; p++) {
        if (classes[p] !== COLOUR) {
            continue;
        }
        const x = p % width;
        const y = Math.floor(p / width);
        search: for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const nx = x + dx;
                const ny = y + dy;
                const neighbour = classes[ny * width + nx];
                if (nx >= 0 && ny >= 0 && nx < width && ny < height && (neighbour === FIGMA || neighbour === STORY)) {
                    settled[p] = neighbour;
                    break search;
                }
            }
        }
    }

    return settled;
}

/** Largest 8-connected region of differing pixels: where the eye lands, even when its share of the cell is small. */
function largestBlob(classes: Uint8Array, width: number, height: number): DiffMap['blob'] {
    let blob: DiffMap['blob'] = null;
    const seen = new Uint8Array(classes.length);
    const stack = new Int32Array(classes.length);
    const differs = (p: number) => {
        return classes[p] !== SAME && classes[p] !== MASK;
    };
    for (let start = 0; start < classes.length; start++) {
        if (seen[start] || !differs(start)) {
            continue;
        }
        let depth = 0;
        stack[depth++] = start;
        seen[start] = 1;
        let pixels = 0;
        let minX = width;
        let minY = height;
        let maxX = 0;
        let maxY = 0;
        while (depth > 0) {
            const p = stack[--depth] ?? 0;
            pixels++;
            const x = p % width;
            const y = Math.floor(p / width);
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx;
                    const ny = y + dy;
                    const n = ny * width + nx;
                    if (nx >= 0 && ny >= 0 && nx < width && ny < height && !seen[n] && differs(n)) {
                        seen[n] = 1;
                        stack[depth++] = n;
                    }
                }
            }
        }
        if (!blob || pixels > blob.pixels) {
            blob = { pixels, x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
        }
    }

    return blob;
}

/**
 * Both images must have the same size (the pixel diff checks it first). `backdrop`: the opaque page colour the
 * reference was flattened onto.
 */
export function diffMap(reference: Pixels, actual: Pixels, backdrop: { r: number; g: number; b: number }): DiffMap {
    const { width, height } = reference;
    const settled = classify(reference, actual, new Uint8Array([backdrop.r, backdrop.g, backdrop.b]));
    const ref = reference.data;
    const act = actual.data;
    const image = new Uint8Array(ref.length);
    const classes: DiffClasses = { figma: 0, story: 0, colour: 0, masked: 0 };
    const pairs = new Map<string, { n: number; f: number[]; s: number[] }>();
    const paint = (o: number, r: number, g: number, b: number) => {
        image[o] = r;
        image[o + 1] = g;
        image[o + 2] = b;
        image[o + 3] = 255;
    };
    for (let p = 0; p < settled.length; p++) {
        const o = p * 4;
        const kind = settled[p];
        if (kind === MASK) {
            classes.masked++;
            const stripe = ((p % width) + Math.floor(p / width)) % 6 < 2;
            paint(o, stripe ? 92 : 30, stripe ? 92 : 30, stripe ? 100 : 34);
        } else if (kind === FIGMA) {
            classes.figma++;
            paint(o, ...DIFF_COLOURS.figma);
        } else if (kind === STORY) {
            classes.story++;
            paint(o, ...DIFF_COLOURS.story);
        } else if (kind === COLOUR) {
            classes.colour++;
            paint(o, ...DIFF_COLOURS.colour);
            const f = [ref[o] ?? 0, ref[o + 1] ?? 0, ref[o + 2] ?? 0];
            const s = [act[o] ?? 0, act[o + 1] ?? 0, act[o + 2] ?? 0];
            // Bucketed so near-identical tones of one fill count as one change.
            const bucket = (rgb: number[]) => {
                return rgb.map((value) => {
                    return value >> 3;
                });
            };
            const key = `${bucket(f)}|${bucket(s)}`;
            const entry = pairs.get(key) ?? { n: 0, f: [0, 0, 0], s: [0, 0, 0] };
            entry.n++;
            for (let c = 0; c < 3; c++) {
                entry.f[c] = (entry.f[c] ?? 0) + (f[c] ?? 0);
                entry.s[c] = (entry.s[c] ?? 0) + (s[c] ?? 0);
            }
            pairs.set(key, entry);
        } else {
            // Unchanged: the story as dim grey context.
            const luminance = 0.2126 * (act[o] ?? 0) + 0.7152 * (act[o + 1] ?? 0) + 0.0722 * (act[o + 2] ?? 0);
            paint(o, luminance * 0.35 + 8, luminance * 0.35 + 8, luminance * 0.35 + 10);
        }
    }
    // Named only when one change dominates (a fill or a stroke), not a scatter of edge tones.
    const top = [...pairs.values()]
        .sort((a, b) => {
            return b.n - a.n;
        })
        .find((entry) => {
            return entry.n >= Math.max(32, classes.colour * 0.3);
        });
    const average = (sum: number[], n: number) => {
        return hex(
            sum.map((value) => {
                return value / n;
            })
        );
    };

    return {
        image,
        classes,
        pair: top ? { figma: average(top.f, top.n), story: average(top.s, top.n) } : null,
        blob: largestBlob(settled, width, height),
    };
}
