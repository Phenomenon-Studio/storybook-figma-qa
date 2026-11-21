// Writes the committed Figma refs of both fixtures: one synthetic component set, `Swatch` (Size × Tone), as a sync
// would cache it: manifest.json plus one 2x PNG per variant. Stand-in for Figma, so fixture runs need no token or
// network. Re-run after changing the set below: `node scripts/fixture-refs.mjs`.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

const SCALE = 2;
const FILE_KEY = 'FIXTUREKIT';
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

const variants = [];
let index = 1;
for (const [sizeName, size] of Object.entries(SIZES)) {
    for (const [toneName, fill] of Object.entries(TONES)) {
        variants.push({
            id: `10:${index++}`,
            name: `Size=${sizeName}, Tone=${toneName}`,
            props: { Size: sizeName, Tone: toneName },
            size,
            fill,
        });
    }
}

const manifest = {
    source: {
        url: URL,
        fileKey: FILE_KEY,
        nodeId: SET_ID,
        name: 'Swatch',
        version: '1',
        lastModified: '2026-11-21T00:00:00Z',
    },
    axes: [
        { name: 'Size', options: Object.keys(SIZES) },
        { name: 'Tone', options: Object.keys(TONES) },
    ],
    booleans: [],
    variants: variants.map(({ id, name, props, size, fill }) => {
        return {
            id,
            name,
            props,
            spec: {
                root: {
                    name,
                    width: size.side,
                    height: size.side,
                    radius: [size.radius, size.radius, size.radius, size.radius],
                    hugWidth: false,
                    fill,
                    fillTypes: [],
                    opacity: 1,
                    stroke: null,
                    shadows: [],
                    blendMode: null,
                    blur: { layer: null, background: null },
                    layout: null,
                },
                texts: [],
                icons: [],
            },
        };
    }),
};

for (const fixture of ['sb10', 'sb11']) {
    const refs = path.join(import.meta.dirname, '..', 'fixtures', fixture, 'figma-qa', '__refs__');
    const dir = path.join(refs, `${FILE_KEY}-${SET_ID.replace(':', '-')}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 4)}\n`);
    for (const variant of variants) {
        writeFileSync(
            path.join(dir, `${variant.id.replace(':', '-')}.png`),
            roundedSquare(variant.size.side, variant.size.radius, variant.fill)
        );
    }
}
