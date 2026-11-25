// Writes the recorded Figma responses the kit's tests serve from a stub, and the committed Figma refs of both
// fixtures synced from them: two synthetic component sets, `Swatch` (Size × Tone, Brand's and Neutral's fills bound
// to colour variables) and `Glyph` (one icon instance per variant), plus the variable catalogue naming those variables. The
// recordings stand in for Figma, so fixture runs need no token or network; refs are built by the kit's own spec
// extraction, so they match what a sync of the recordings writes.
// Re-run after changing the sets below: `pnpm build && node scripts/fixture-refs.mjs`.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { REFS_FORMAT, writeRefsFormat } from '../packages/storybook-figma-qa/dist/node/migrate.js';
import { setManifest } from '../packages/storybook-figma-qa/dist/node/set-manifest.js';

const SCALE = 2;
const FILE_KEY = 'FIXTUREKIT';
const VERSION = '1';
const LAST_MODIFIED = '2026-11-21T00:00:00Z';
const SIZES = { Small: { side: 24, radius: 4 }, Large: { side: 40, radius: 8 } };
const TONES = {
    Brand: { r: 59, g: 91, b: 219, a: 1 },
    Neutral: { r: 173, g: 181, b: 189, a: 1 },
    Danger: { r: 224, g: 49, b: 49, a: 1 },
};
/** Fills bound to colour variables, which `variables.json` names. Brand's name maps to a kit token, Neutral's doesn't. */
const TONE_VARIABLES = {
    Brand: { id: '1:1', name: 'Brand' },
    Neutral: { id: '1:2', name: 'Tone/Neutral' },
};
/** Glyph variants: a 24×24 frame with one 16×16 icon instance inset 4px, drawn in Brand. */
const GLYPHS = { Square: 0, Circle: 8 };
const GLYPH = { frame: 24, side: 16, inset: 4 };

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

/** A filled rounded square on a transparent `frame` (default: the square), inset by `inset`, edges anti-aliased by 4×4 supersampling. */
function roundedSquare(side, radius, color, frame = side, inset = 0) {
    const size = frame * SCALE;
    const [from, to] = [inset * SCALE, (inset + side) * SCALE];
    const r = radius * SCALE;
    const data = Buffer.alloc(size * size * 4);
    const inside = (x, y) => {
        if (x < from || x > to || y < from || y > to) {
            return false;
        }
        const cx = Math.min(Math.max(x, from + r), to - r);
        const cy = Math.min(Math.max(y, from + r), to - r);

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

function setUrl(setId) {
    return `https://www.figma.com/design/${FILE_KEY}/Fixture-UI-kit?node-id=${setId.replace(':', '-')}`;
}

function componentSet(id, name, axes, variants) {
    const right = Math.max(
        ...variants.map(({ absoluteBoundingBox: box }) => {
            return box.x + box.width;
        })
    );
    const bottom = Math.max(
        ...variants.map(({ absoluteBoundingBox: box }) => {
            return box.y + box.height;
        })
    );

    return {
        id,
        name,
        type: 'COMPONENT_SET',
        blendMode: 'PASS_THROUGH',
        absoluteBoundingBox: { x: 0, y: 0, width: right, height: bottom },
        componentPropertyDefinitions: Object.fromEntries(
            Object.entries(axes).map(([axis, options]) => {
                return [axis, { type: 'VARIANT', defaultValue: options[0], variantOptions: options }];
            })
        ),
        children: variants.map(({ png: _png, ...node }) => {
            return node;
        }),
    };
}

const swatches = [];
let index = 1;
let y = 0;
for (const [sizeName, size] of Object.entries(SIZES)) {
    let x = 0;
    for (const [toneName, fill] of Object.entries(TONES)) {
        const paint = { blendMode: 'NORMAL', type: 'SOLID', color: figmaColor(fill) };
        const variable = TONE_VARIABLES[toneName];
        if (variable) {
            paint.boundVariables = { color: { type: 'VARIABLE_ALIAS', id: `VariableID:${variable.id}` } };
        }
        swatches.push({
            id: `10:${index++}`,
            name: `Size=${sizeName}, Tone=${toneName}`,
            type: 'COMPONENT',
            blendMode: 'PASS_THROUGH',
            absoluteBoundingBox: { x, y, width: size.side, height: size.side },
            fills: [paint],
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

const glyphs = Object.entries(GLYPHS).map(([iconName, radius], column) => {
    const x = column * (GLYPH.frame + 16);
    const icon = { x: x + GLYPH.inset, y: GLYPH.inset, width: GLYPH.side, height: GLYPH.side };

    return {
        id: `20:${column + 1}`,
        name: `Icon=${iconName}`,
        type: 'COMPONENT',
        blendMode: 'PASS_THROUGH',
        absoluteBoundingBox: { x, y: 0, width: GLYPH.frame, height: GLYPH.frame },
        fills: [],
        layoutSizingHorizontal: 'FIXED',
        layoutSizingVertical: 'FIXED',
        children: [
            {
                id: `I20:${column + 1};30:${column + 1}`,
                name: iconName,
                type: 'INSTANCE',
                componentId: `30:${column + 1}`,
                blendMode: 'PASS_THROUGH',
                absoluteBoundingBox: icon,
                fills: [],
                children: [
                    {
                        id: `I20:${column + 1};30:${column + 1};31:1`,
                        name: 'Shape',
                        type: 'RECTANGLE',
                        blendMode: 'PASS_THROUGH',
                        absoluteBoundingBox: icon,
                        fills: [{ blendMode: 'NORMAL', type: 'SOLID', color: figmaColor(TONES.Brand) }],
                        cornerRadius: radius,
                    },
                ],
            },
        ],
        png: roundedSquare(GLYPH.side, radius, TONES.Brand, GLYPH.frame, GLYPH.inset),
    };
});

const sets = [
    { id: '10:0', variants: swatches, document: componentSet('10:0', 'Swatch', { Size: Object.keys(SIZES), Tone: Object.keys(TONES) }, swatches), components: {} },
    {
        id: '20:0',
        variants: glyphs,
        document: componentSet('20:0', 'Glyph', { Icon: Object.keys(GLYPHS) }, glyphs),
        components: Object.fromEntries(
            Object.keys(GLYPHS).map((iconName, column) => {
                return [`30:${column + 1}`, { key: `glyph-${column + 1}`, name: `Icons/${iconName}` }];
            })
        ),
    },
];
const entries = Object.fromEntries(
    sets.map(({ id, document, components }) => {
        return [id, { document, components, componentSets: {}, schemaVersion: 0, styles: {} }];
    })
);
const nodes = { name: 'Fixture UI kit', lastModified: LAST_MODIFIED, version: VERSION, nodes: entries };
const variables = {
    source: { fileKey: FILE_KEY, via: 'scripts/fixture-refs.mjs', updatedAt: LAST_MODIFIED },
    variables: Object.fromEntries(
        Object.values(TONE_VARIABLES).map(({ id, name }) => {
            return [id, { collection: 'Tones', type: 'COLOR', name }];
        })
    ),
};

const recordings = path.join(import.meta.dirname, '..', 'packages', 'storybook-figma-qa', 'test', 'figma-api', FILE_KEY);
rmSync(recordings, { recursive: true, force: true });
mkdirSync(path.join(recordings, 'images'), { recursive: true });
writeFileSync(path.join(recordings, 'nodes.json'), `${JSON.stringify(nodes, null, 4)}\n`);
for (const { variants } of sets) {
    for (const variant of variants) {
        writeFileSync(path.join(recordings, 'images', `${variant.id.replace(':', '-')}.png`), variant.png);
    }
}

for (const fixture of ['sb10', 'sb11']) {
    const refs = path.join(import.meta.dirname, '..', 'fixtures', fixture, 'figma-qa', '__refs__');
    mkdirSync(refs, { recursive: true });
    await writeRefsFormat({ root: refs, refsDir: '.' }, REFS_FORMAT);
    writeFileSync(path.join(refs, 'variables.json'), `${JSON.stringify(variables, null, 4)}\n`);
    for (const { id, variants } of sets) {
        const manifest = setManifest(setUrl(id), entries[id], VERSION, LAST_MODIFIED);
        const dir = path.join(refs, `${FILE_KEY}-${id.replace(':', '-')}`);
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 4)}\n`);
        for (const variant of variants) {
            writeFileSync(path.join(dir, `${variant.id.replace(':', '-')}.png`), variant.png);
        }
    }
}
