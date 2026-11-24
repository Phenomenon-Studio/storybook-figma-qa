// Glyph identity for the spec check: which project icon a Figma glyph names (config `icons.name`), and which one a
// rendered `<svg>` is (by geometry). Icons come from the config's `icons.glob`; with none found, no glyph has a known
// file, the identity row is skipped, and position, size and colour of glyphs are still compared.
import { projectConfig, projectIcons } from './project.ts';

/** The project icon a Figma glyph component names, as `{ file, svg }`; null when the project has none. */
export function projectIcon(figma: string | null): { file: string; svg: string } | null {
    if (!figma) {
        return null;
    }
    const name = projectConfig().icons.name(figma);
    const svg = projectIcons.get(name);

    return svg === undefined ? null : { file: `${name}.svg`, svg };
}

/** The project SVG file a Figma glyph names, or null when the project has none. */
export function kitIconFile(figma: string | null): string | null {
    return projectIcon(figma)?.file ?? null;
}

const SHAPES = 'path, circle, ellipse, rect, polygon, polyline, line';
const GEOMETRY = ['d', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height', 'points', 'x1', 'y1', 'x2', 'y2'];

/** viewBox + every shape's geometry: identical for two renders of one SVG, whatever their size or colour. */
function fingerprint(svg: Element): string {
    const shapes = [...svg.querySelectorAll(SHAPES)].map((shape) => {
        return `${shape.tagName}:${GEOMETRY.map((name) => {
            return shape.getAttribute(name) ?? '';
        }).join(',')}`;
    });

    return `${svg.getAttribute('viewBox') ?? ''}|${shapes.join(';')}`;
}

let prints: Map<string, string> | null = null;

/** The project SVG file a rendered `<svg>` was made from, or null when it isn't a project icon. */
export function kitIconOf(svg: Element): string | null {
    if (!prints) {
        prints = new Map();
        for (const [name, source] of projectIcons) {
            const parsed = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement;
            prints.set(fingerprint(parsed), `${name}.svg`);
        }
    }

    return prints.get(fingerprint(svg)) ?? null;
}
