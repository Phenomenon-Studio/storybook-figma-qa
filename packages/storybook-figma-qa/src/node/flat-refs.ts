// Figma refs flattened onto a backdrop, memoized per (ref hash, backdrop): in memory for the run, and on disk under the
// local cache so the next run skips the PNG decode and the flatten for every ref that didn't change. Keyed by the
// ref's bytes, not its path: lazy sync may rewrite a ref mid-run.
import type { Pixels } from './diff-map.ts';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';

export type Rgb = { r: number; g: number; b: number };

/** Versioned: a kit that changes the flatten or the file layout starts a new directory, never reads the old one. */
export const FLAT_CACHE_DIR = 'node_modules/.cache/figma-qa/flat-v1';

/** Raw opaque RGBA after an 8-byte header (width, height as u32 LE): reading it back is one copy, no decode. */
const HEADER = 8;

/** Source-over of a straight-alpha RGBA image onto an opaque colour, in place. */
export function flatten(image: Pixels, backdrop: Rgb): void {
    const { data } = image;
    for (let index = 0; index < data.length; index += 4) {
        const alpha = (data[index + 3] ?? 0) / 255;
        data[index] = Math.round((data[index] ?? 0) * alpha + backdrop.r * (1 - alpha));
        data[index + 1] = Math.round((data[index + 1] ?? 0) * alpha + backdrop.g * (1 - alpha));
        data[index + 2] = Math.round((data[index + 2] ?? 0) * alpha + backdrop.b * (1 - alpha));
        data[index + 3] = 255;
    }
}

function hex({ r, g, b }: Rgb): string {
    return [r, g, b]
        .map((channel) => {
            return channel.toString(16).padStart(2, '0');
        })
        .join('');
}

async function readCached(file: string): Promise<Pixels | null> {
    let bytes: Buffer;
    try {
        bytes = await readFile(file);
    } catch {
        return null;
    }
    if (bytes.length < HEADER) {
        return null;
    }
    const width = bytes.readUInt32LE(0);
    const height = bytes.readUInt32LE(4);
    // A torn or foreign file is recomputed, never trusted.
    if (bytes.length !== HEADER + width * height * 4) {
        return null;
    }

    return { width, height, data: new Uint8Array(bytes.buffer, bytes.byteOffset + HEADER, width * height * 4) };
}

async function writeCached(file: string, image: Pixels): Promise<void> {
    const header = Buffer.alloc(HEADER);
    header.writeUInt32LE(image.width, 0);
    header.writeUInt32LE(image.height, 4);
    await mkdir(path.dirname(file), { recursive: true });
    // Renamed into place: a concurrent run reads a whole file or none.
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, Buffer.concat([header, image.data]));
    await rename(temporary, file);
}

const memory = new Map<string, Promise<Pixels>>();

async function load(root: string, key: string, reference: Buffer, backdrop: Rgb): Promise<Pixels> {
    const file = path.join(root, FLAT_CACHE_DIR, `${key}.rgba`);
    const cached = await readCached(file);
    if (cached) {
        return cached;
    }
    const png = PNG.sync.read(reference);
    const image: Pixels = { width: png.width, height: png.height, data: png.data };
    flatten(image, backdrop);
    try {
        await writeCached(file, image);
    } catch {
        // A cache that can't be written only costs the next run a flatten.
    }

    return image;
}

/** The ref flattened onto `backdrop`. Shared: callers copy before painting on it. */
export function flatRef(root: string, reference: Buffer, backdrop: Rgb): Promise<Pixels> {
    const key = `${createHash('sha256').update(reference).digest('hex').slice(0, 32)}-${hex(backdrop)}`;
    let flat = memory.get(key);
    if (!flat) {
        flat = load(root, key, reference, backdrop);
        memory.set(key, flat);
        flat.catch(() => {
            memory.delete(key);
        });
    }

    return flat;
}
