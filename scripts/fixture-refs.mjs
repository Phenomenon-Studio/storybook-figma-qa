// Writes the recorded Figma responses the kit's tests serve from a stub, and the committed Figma refs of both
// fixtures synced from them: one synthetic component set, `Swatch` (Size × Tone). The recordings stand in for Figma,
// so fixture runs need no token or network; refs are built by the kit's own spec extraction, so they match what a
// sync of the recordings writes. Re-run after changing the set below: `pnpm build && node scripts/fixture-refs.mjs`.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { setManifest } from '../packages/storybook-figma-qa/dist/node/set-manifest.js';

const SCALE = 2;
const FILE_KEY = 'FIXTUREKIT';
const VERSION = '1';
const LAST_MODIFIED = '2026-11-21T00:00:00Z';
const SET_ID = '10:0';
const URL = `https://www.figma.com/design/${FILE_KEY}/Fixture-UI-kit?node-id=${SET_ID.replace(':', '-')}`;
const SIZES = { Small: { side: 24, radius: 4 }, Large: { side: 40, radius: 8 } };
const TONES = {
    Brand: { r: 59, g: 91, b: 219, a: 1 },
    Neutral: { r: 173, g: 181, b: 189, a: 1 },
    Danger: { r: 224, g: 49, b: 49, a: 1 },
};

function chunk(type, data) {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));

    return Buffer.concat([length, body, crc]);
}

/** RGBA, 8 bits per channel, no filtering. */
function png(width, height, rgba) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header.set([8, 6, 0, 0, 0], 8);
    const rows = Buffer.alloc((width * 4 + 1) * height);
    for (let y = 0; y < height; y++) {
        rgba.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
    }

    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(rows)),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

/** A filled rounded square on transparent, edges anti-aliased by 4×4 supersampling. */
function roundedSquare(side, radius, color) {
    const size = side * SCALE;
    const r = radius * SCALE;
    const data = Buffer.alloc(size * size * 4);
    const inside = (x, y) => {
        const cx = Math.min(Math.max(x, r), size - r);
        const cy = Math.min(Math.max(y, r), size - r);

        return (x - cx) ** 2 + (y - cy) ** 2 <= r ** 2;
    };
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let hits = 0;
            for (let sy = 0; sy < 4; sy++) {
                for (let sx = 0; sx < 4; sx++) {
                    hits += inside(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4) ? 1 : 0;
                }
            }
            const offset = (y * size + x) * 4;
            data.set([color.r, color.g, color.b, Math.round((hits / 16) * 255 * color.a)], offset);
        }
    }

    return png(size, size, data);
}

/** Figma colours are 0–1 floats. */
function figmaColor({ r, g, b, a }) {
    return { r: r / 255, g: g / 255, b: b / 255, a };
}

const variants = [];
let index = 1;
let y = 0;
for (const [sizeName, size] of Object.entries(SIZES)) {
    let x = 0;
    for (const [toneName, fill] of Object.entries(TONES)) {
        variants.push({
            id: `10:${index++}`,
            name: `Size=${sizeName}, Tone=${toneName}`,
            type: 'COMPONENT',
            blendMode: 'PASS_THROUGH',
            absoluteBoundingBox: { x, y, width: size.side, height: size.side },
            fills: [{ blendMode: 'NORMAL', type: 'SOLID', color: figmaColor(fill) }],
            cornerRadius: size.radius,
            layoutSizingHorizontal: 'FIXED',
            layoutSizingVertical: 'FIXED',
            children: [],
            png: roundedSquare(size.side, size.radius, fill),
        });
        x += size.side + 16;
    }
    y += size.side + 16;
}

const document = {
    id: SET_ID,
    name: 'Swatch',
    type: 'COMPONENT_SET',
    blendMode: 'PASS_THROUGH',
    absoluteBoundingBox: { x: 0, y: 0, width: 168, height: 96 },
    componentPropertyDefinitions: {
        Size: { type: 'VARIANT', defaultValue: 'Small', variantOptions: Object.keys(SIZES) },
        Tone: { type: 'VARIANT', defaultValue: 'Brand', variantOptions: Object.keys(TONES) },
    },
    children: variants.map(({ png: _png, ...node }) => {
        return node;
    }),
};
const entry = { document, components: {}, componentSets: {}, schemaVersion: 0, styles: {} };
const nodes = { name: 'Fixture UI kit', lastModified: LAST_MODIFIED, version: VERSION, nodes: { [SET_ID]: entry } };

const recordings = path.join(import.meta.dirname, '..', 'packages', 'storybook-figma-qa', 'test', 'figma-api', FILE_KEY);
rmSync(recordings, { recursive: true, force: true });
mkdirSync(path.join(recordings, 'images'), { recursive: true });
writeFileSync(path.join(recordings, 'nodes.json'), `${JSON.stringify(nodes, null, 4)}\n`);
for (const variant of variants) {
    writeFileSync(path.join(recordings, 'images', `${variant.id.replace(':', '-')}.png`), variant.png);
}

const manifest = setManifest(URL, entry, VERSION, LAST_MODIFIED);
for (const fixture of ['sb10', 'sb11']) {
    const refs = path.join(import.meta.dirname, '..', 'fixtures', fixture, 'figma-qa', '__refs__');
    const dir = path.join(refs, `${FILE_KEY}-${SET_ID.replace(':', '-')}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 4)}\n`);
    for (const variant of variants) {
        writeFileSync(path.join(dir, `${variant.id.replace(':', '-')}.png`), variant.png);
    }
}
