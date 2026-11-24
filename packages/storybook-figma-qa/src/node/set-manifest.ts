// Spec extraction: a component set's raw `/nodes` entry → its manifest (variant axes + a layout/type spec per
// variant). Ported unchanged from the in-tree pipeline; pure, so `--refresh` rebuilds manifests from cached raw JSON.
import type { FigmaSetManifest, FigmaShadow, FigmaSpec, FigmaStroke, FigmaVariant, Box, Rgba } from '../figma/types.ts';
import { createHash } from 'node:crypto';
import { parseFigmaUrl } from '../figma/types.ts';

type Paint = { type: string; visible?: boolean; opacity?: number; color?: Rgba; boundVariables?: { color?: unknown } };
type Effect = {
    type: string;
    visible?: boolean;
    color?: Rgba;
    offset?: { x: number; y: number };
    radius: number;
    spread?: number;
};
export type FigmaNode = {
    id: string;
    name: string;
    type: string;
    visible?: boolean;
    characters?: string;
    absoluteBoundingBox: Box;
    fills?: Paint[];
    strokes?: Paint[];
    strokeWeight?: number;
    individualStrokeWeights?: { top: number; right: number; bottom: number; left: number };
    strokeAlign?: FigmaStroke['align'];
    strokeDashes?: number[];
    effects?: Effect[];
    opacity?: number;
    /** Variable aliases per property (`fills` per paint, `rectangleCornerRadii` per corner, …). */
    boundVariables?: Record<string, unknown>;
    layoutSizingHorizontal?: 'FIXED' | 'HUG' | 'FILL';
    cornerRadius?: number;
    rectangleCornerRadii?: [number, number, number, number];
    style?: {
        fontFamily: string;
        fontSize: number;
        fontWeight: number;
        lineHeightPx: number;
        letterSpacing: number;
        textCase?: string;
        textDecoration?: string;
        textAlignHorizontal?: string;
        textAutoResize?: string;
        textTruncation?: string;
    };
    textTruncation?: string;
    blendMode?: string;
    layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL';
    layoutPositioning?: 'AUTO' | 'ABSOLUTE';
    layoutWrap?: 'NO_WRAP' | 'WRAP';
    layoutSizingVertical?: 'FIXED' | 'HUG' | 'FILL';
    primaryAxisAlignItems?: string;
    counterAxisAlignItems?: string;
    componentPropertyDefinitions?: Record<string, { type: string; defaultValue: unknown; variantOptions?: string[] }>;
    componentId?: string;
    children?: FigmaNode[];
};

/** One set's entry of a `/nodes` response: its subtree plus the components its instances point at. */
export type NodesEntry = {
    document: FigmaNode;
    components?: Record<string, { name: string; componentSetId?: string }>;
    componentSets?: Record<string, { name: string }>;
};

/** `GET /v1/files/:key/nodes`. */
export type NodesResponse = { version: string; lastModified: string; nodes: Record<string, NodesEntry | null> };

/** Main-component name of an instance; for a variant (an icon set's `Size=24`), the set's name. */
type ComponentName = (componentId: string | undefined) => string | null;

function byte(value: number): number {
    return Math.round(value * 255);
}

/**
 * Every visible SOLID paint, composited source-over in array order (Figma lists paints bottom to top), as one colour;
 * `null` when there's none. Paint `opacity` multiplies the colour's alpha, as Figma draws it.
 */
function solidFill(fills: Paint[] | undefined): Rgba | null {
    let out: Rgba | null = null;
    for (const paint of fills ?? []) {
        if (paint.visible !== false && paint.type === 'SOLID' && paint.color) {
            out = over({ ...paint.color, a: paint.color.a * (paint.opacity ?? 1) }, out);
        }
    }

    return out && { r: byte(out.r), g: byte(out.g), b: byte(out.b), a: Math.round(out.a * 1000) / 1000 };
}

/** Source-over of `top` on `back` (straight alpha, 0–1 channels). */
function over(top: Rgba, back: Rgba | null): Rgba {
    if (!back) {
        return top;
    }
    const a = top.a + back.a * (1 - top.a);
    const mix = (front: number, behind: number): number => {
        return a === 0 ? 0 : (front * top.a + behind * back.a * (1 - top.a)) / a;
    };

    return { r: mix(top.r, back.r), g: mix(top.g, back.g), b: mix(top.b, back.b), a };
}

function visibleTypes(paints: Paint[] | undefined): string[] {
    return (paints ?? [])
        .filter((paint) => {
            return paint.visible !== false && paint.type !== 'SOLID';
        })
        .map((paint) => {
            return paint.type;
        });
}

function strokeOf(node: FigmaNode): FigmaStroke | null {
    const color = solidFill(node.strokes);
    const sides = node.individualStrokeWeights;
    const weights = sides ? [sides.top, sides.right, sides.bottom, sides.left] : null;
    const weight = weights ? Math.max(...weights) : (node.strokeWeight ?? 0);
    if (!color || weight <= 0) {
        return null;
    }

    return {
        weight,
        sides: weights && new Set(weights).size > 1 ? (weights as FigmaStroke['sides']) : null,
        align: node.strokeAlign ?? 'INSIDE',
        color,
        dashed: (node.strokeDashes?.length ?? 0) > 0,
    };
}

function shadowsOf(node: FigmaNode): FigmaShadow[] {
    return (node.effects ?? [])
        .filter((effect) => {
            return effect.visible !== false && (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW');
        })
        .map((effect) => {
            const color = effect.color ?? { r: 0, g: 0, b: 0, a: 0 };

            return {
                inset: effect.type === 'INNER_SHADOW',
                x: effect.offset?.x ?? 0,
                y: effect.offset?.y ?? 0,
                blur: effect.radius,
                spread: effect.spread ?? 0,
                color: { r: byte(color.r), g: byte(color.g), b: byte(color.b), a: Math.round(color.a * 1000) / 1000 },
            };
        });
}

function blendOf(node: FigmaNode): string | null {
    return node.blendMode && node.blendMode !== 'NORMAL' && node.blendMode !== 'PASS_THROUGH' ? node.blendMode : null;
}

function blurOf(node: FigmaNode): { layer: number | null; background: number | null } {
    const radius = (type: string) => {
        return (
            (node.effects ?? []).find((effect) => {
                return effect.visible !== false && effect.type === type;
            })?.radius ?? null
        );
    };

    return { layer: radius('LAYER_BLUR'), background: radius('BACKGROUND_BLUR') };
}

function inFlow(node: FigmaNode): FigmaNode[] {
    return (node.children ?? []).filter((child) => {
        return child.visible !== false && child.layoutPositioning !== 'ABSOLUTE';
    });
}

/** The auto-layout frame arranging the content: through single-child auto-layout FRAME wrappers from the root. */
/** The auto-layout container (see layoutOf): the root, or reached through single-child auto-layout FRAME wrappers. */
function layoutNode(root: FigmaNode): FigmaNode {
    let node = root;
    for (;;) {
        const children = inFlow(node);
        const only = children.length === 1 ? children[0] : undefined;
        if (only?.type !== 'FRAME' || !only.layoutMode || only.layoutMode === 'NONE') {
            return node;
        }
        node = only;
    }
}

function layoutOf(root: FigmaNode, origin: Box): FigmaSpec['root']['layout'] {
    const node = layoutNode(root);
    if (!node.layoutMode || node.layoutMode === 'NONE') {
        return null;
    }
    const direction = node.layoutMode;

    return {
        direction,
        primaryAlign: node.primaryAxisAlignItems ?? 'MIN',
        counterAlign: node.counterAxisAlignItems ?? 'MIN',
        wrap: node.layoutWrap === 'WRAP',
        hugPrimary: (direction === 'HORIZONTAL' ? node.layoutSizingHorizontal : node.layoutSizingVertical) === 'HUG',
        children: inFlow(node).map((child) => {
            return {
                name: child.name,
                text: child.type === 'TEXT',
                box: relativeBox(child.absoluteBoundingBox, origin),
            };
        }),
    };
}

/**
 * A glyph's visible colour: its topmost painted shape (last in paint order), fill else stroke, alpha multiplied by
 * every node opacity from the instance down to that shape.
 */
function glyphColor(instance: FigmaNode): { color: Rgba; variable: string | undefined } | null {
    let found: { color: Rgba; variable: string | undefined } | null = null;
    function walk(node: FigmaNode, opacity: number) {
        if (node.visible === false) {
            return;
        }
        const own = opacity * (node.opacity ?? 1);
        if (node.children?.length) {
            node.children.forEach((child) => {
                walk(child, own);
            });

            return;
        }
        const fill = solidFill(node.fills);
        const color = fill ?? solidFill(node.strokes);
        if (color && color.a > 0) {
            found = {
                color: { ...color, a: Math.round(color.a * own * 1000) / 1000 },
                variable: paintVariable(node, fill ? 'fills' : 'strokes'),
            };
        }
    }
    walk(instance, 1);

    return found;
}

/** The variable id (`8019:325`) an alias, or the first alias inside a value, points at. */
function aliasId(value: unknown): string | undefined {
    return /"VariableID:([^"]+)"/.exec(JSON.stringify(value ?? null))?.[1];
}

/** The variable bound to a node's topmost visible solid paint (paint-level binding, else the node's per-paint one). */
function paintVariable(node: FigmaNode, key: 'fills' | 'strokes'): string | undefined {
    const paints = node[key] ?? [];
    for (let index = paints.length - 1; index >= 0; index--) {
        const paint = paints[index];
        if (paint && paint.visible !== false && paint.type === 'SOLID') {
            const perPaint = node.boundVariables?.[key];

            return (
                aliasId(paint.boundVariables?.color) ?? aliasId(Array.isArray(perPaint) ? perPaint[index] : undefined)
            );
        }
    }

    return undefined;
}

/** Drops unbound keys, so manifests only list what Figma binds. */
function bound<T extends Record<string, string | undefined>>(vars: T): Partial<Record<keyof T, string>> | undefined {
    const entries = Object.entries(vars).filter(([, id]) => {
        return id !== undefined;
    });

    return entries.length ? (Object.fromEntries(entries) as Partial<Record<keyof T, string>>) : undefined;
}

function relativeBox(box: Box, origin: Box): Box {
    return { x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height };
}

/** Flattens a variant to what the DOM can be held to: root box + visible text runs + visible icon instances. */
function sameBox(a: Box, b: Box): boolean {
    return (
        Math.abs(a.x - b.x) < 0.5 &&
        Math.abs(a.y - b.y) < 0.5 &&
        Math.abs(a.width - b.width) < 0.5 &&
        Math.abs(a.height - b.height) < 0.5
    );
}

/**
 * The node that paints the variant's box. Figma often wraps it: a paint-less root whose single visible child covers
 * the same box carries the fill and radius, while the DOM puts them on the root element. `opacity`: the product along
 * that path, as the DOM root carries it.
 */
function surface(root: FigmaNode): { node: FigmaNode; opacity: number } {
    let current = root;
    let opacity = root.opacity ?? 1;
    for (;;) {
        const children = (current.children ?? []).filter((child) => {
            return child.visible !== false;
        });
        const only = children.length === 1 ? children[0] : undefined;
        const painted =
            solidFill(current.fills) !== null ||
            visibleTypes(current.fills).length > 0 ||
            strokeOf(current) !== null ||
            shadowsOf(current).length > 0 ||
            (current.cornerRadius ?? 0) > 0 ||
            current.rectangleCornerRadii;
        if (painted || !only || !sameBox(only.absoluteBoundingBox, current.absoluteBoundingBox)) {
            return { node: current, opacity: Math.round(opacity * 1000) / 1000 };
        }
        current = only;
        opacity *= current.opacity ?? 1;
    }
}

function toSpec(root: FigmaNode, componentName: ComponentName): FigmaSpec {
    const origin = root.absoluteBoundingBox;
    const { node: paint, opacity } = surface(root);
    const spec: FigmaSpec = {
        root: {
            name: root.name,
            width: origin.width,
            height: origin.height,
            hugWidth: root.layoutSizingHorizontal === 'HUG',
            radius:
                paint.rectangleCornerRadii ??
                ([0, 0, 0, 0].fill(paint.cornerRadius ?? 0) as FigmaSpec['root']['radius']),
            fill: solidFill(paint.fills),
            fillTypes: visibleTypes(paint.fills),
            opacity,
            stroke: strokeOf(paint),
            shadows: shadowsOf(paint),
            blendMode: blendOf(root),
            blur: blurOf(paint),
            layout: layoutOf(root, origin),
            vars: bound({
                fill: paintVariable(paint, 'fills'),
                stroke: paintVariable(paint, 'strokes'),
                radius: aliasId(paint.boundVariables?.rectangleCornerRadii ?? paint.boundVariables?.topLeftRadius),
                gap: aliasId(layoutNode(root).boundVariables?.itemSpacing),
                paddingTop: aliasId(root.boundVariables?.paddingTop),
                paddingRight: aliasId(root.boundVariables?.paddingRight),
                paddingBottom: aliasId(root.boundVariables?.paddingBottom),
                paddingLeft: aliasId(root.boundVariables?.paddingLeft),
            }),
        },
        texts: [],
        icons: [],
    };

    function walk(node: FigmaNode) {
        if (node.visible === false) {
            return;
        }
        if (node.type === 'TEXT' && node.style) {
            spec.texts.push({
                characters: node.characters ?? '',
                box: relativeBox(node.absoluteBoundingBox, origin),
                fontFamily: node.style.fontFamily,
                fontSize: node.style.fontSize,
                fontWeight: node.style.fontWeight,
                lineHeightPx: node.style.lineHeightPx,
                letterSpacing: node.style.letterSpacing,
                color: solidFill(node.fills),
                textCase: node.style.textCase ?? 'ORIGINAL',
                textDecoration: node.style.textDecoration ?? 'NONE',
                textAlign: node.style.textAlignHorizontal ?? 'LEFT',
                autoResize: node.style.textAutoResize ?? 'NONE',
                truncate: (node.textTruncation ?? node.style.textTruncation) === 'ENDING',
                vars: bound({
                    color: paintVariable(node, 'fills'),
                    fontSize: aliasId(node.boundVariables?.fontSize),
                    lineHeight: aliasId(node.boundVariables?.lineHeight),
                    letterSpacing: aliasId(node.boundVariables?.letterSpacing),
                    fontFamily: aliasId(node.boundVariables?.fontFamily),
                    fontWeight: aliasId(node.boundVariables?.fontStyle ?? node.boundVariables?.fontWeight),
                }),
            });

            return;
        }
        // An instance with no text inside is a glyph (icon, spinner, avatar): compare its box, not its insides.
        if (node !== root && node.type === 'INSTANCE' && !JSON.stringify(node.children ?? []).includes('"TEXT"')) {
            const glyph = glyphColor(node);
            spec.icons.push({
                name: node.name,
                component: componentName(node.componentId),
                box: relativeBox(node.absoluteBoundingBox, origin),
                color: glyph?.color ?? null,
                vars: bound({ color: glyph?.variable }),
            });

            return;
        }
        node.children?.forEach(walk);
    }
    walk(root);
    spec.icons.sort((a, b) => {
        return a.box.x - b.box.x || a.box.y - b.box.y;
    });

    return spec;
}

/** `Size=Big, State=Default` → `{ Size: 'Big', State: 'Default' }`. */
function variantProps(name: string): Record<string, string> {
    return Object.fromEntries(
        name.split(',').map((pair) => {
            const [key = '', ...value] = pair.split('=');

            return [key.trim(), value.join('=').trim()];
        })
    );
}

/** `#1234:5` suffixes Figma appends to non-variant property names. */
function propertyName(key: string): string {
    return key.replace(/#[\d:]+$/, '');
}

/** Hash of a set's whole `/nodes` entry: equal hashes mean Figma would render the same images. */
export function subtreeHash(entry: NodesEntry): string {
    return createHash('sha256').update(JSON.stringify(entry)).digest('hex').slice(0, 16);
}

/** A component set's VARIANT properties in Figma's order, each with its options in Figma's order. */
export function variantAxes(set: Pick<FigmaNode, 'componentPropertyDefinitions'>): FigmaSetManifest['axes'] {
    return Object.entries(set.componentPropertyDefinitions ?? {})
        .filter(([, definition]) => {
            return definition.type === 'VARIANT';
        })
        .map(([key, definition]) => {
            return { name: propertyName(key), options: definition.variantOptions ?? [] };
        });
}

/** A set's manifest from its `/nodes` entry, stamped with the file version it came from. */
export function setManifest(url: string, entry: NodesEntry, version: string, lastModified: string): FigmaSetManifest {
    const set = entry.document;
    if (set.type !== 'COMPONENT_SET') {
        throw new Error(`${url} is not a component set (got ${set.type}).`);
    }
    const componentName: ComponentName = (componentId) => {
        const component = componentId ? entry.components?.[componentId] : undefined;
        if (!component) {
            return null;
        }
        const setName = component.componentSetId ? entry.componentSets?.[component.componentSetId]?.name : undefined;

        return setName ?? component.name;
    };
    const variants: FigmaVariant[] = (set.children ?? [])
        .filter((child) => {
            return child.type === 'COMPONENT';
        })
        .map((component) => {
            return {
                id: component.id,
                name: component.name,
                props: variantProps(component.name),
                spec: toSpec(component, componentName),
            };
        });
    const definitions = Object.entries(set.componentPropertyDefinitions ?? {});
    const { fileKey, nodeId } = parseFigmaUrl(url);

    return {
        source: { url, fileKey, nodeId, name: set.name, version, lastModified, hash: subtreeHash(entry) },
        axes: variantAxes(set),
        booleans: definitions
            .filter(([, definition]) => {
                return definition.type === 'BOOLEAN';
            })
            .map(([key, definition]) => {
                return { name: propertyName(key), default: definition.defaultValue === true };
            }),
        variants,
    };
}
