// `figma-qa scaffold`'s pure part: which component sets a `/nodes` response holds, their default entry names and
// layouts, and the kit-owned `<Component>.figma.stories.tsx` that links them: written whole the first time, then only
// appended to (literal shapes only, ast.ts). The CLI side (fetch, write, print) is commands/scaffold.ts.
import type { FigmaMatrixLayout, FigmaSetManifest } from '../figma/types.ts';
import type { ArrayNode, AstNode, ObjectNode, Program } from './ast.ts';
import type { FigmaNode, NodesEntry } from './set-manifest.ts';
import { parseModule } from 'magicast';
import { PACKAGE_NAME } from '../constants.ts';
import { scanStoryFile } from '../figma/story-scan.ts';
import { FIGMA_TAG } from '../figma/types.ts';
import {
    calleeName,
    isCall,
    isObject,
    keyName,
    literalArray,
    propertyValue,
    soleObjectArgument,
    stringValue,
    topLevelInit,
    unwrap,
    Unsafe,
} from './ast.ts';
import { variantAxes } from './set-manifest.ts';

const PREVIEW_ENTRY = `${PACKAGE_NAME}/preview`;

/** A component set found under a scaffold URL, with the design entry it gets. */
export type ScaffoldSet = {
    fileKey: string;
    nodeId: string;
    /** The set's own node URL: the input URL with this set's `node-id`. */
    url: string;
    /** Figma's set name, e.g. `Buttons/Button`. */
    set: string;
    /** The design entry name: `button`. */
    name: string;
    layout: FigmaMatrixLayout;
    /** The set's `/nodes` entry, written to the local raw cache so the first sync skips `/nodes`. */
    entry: NodesEntry;
};

/** An import the generated file repeats from the sibling story: `import <local> from` or `import { <imported> as <local> } from`. */
export type ImportSpec = { source: string; local: string; imported: 'default' | string };

/** What the generated file's head says. `component`: null when the sibling story has none to import. */
export type StoryHead = { title: string; preview: ImportSpec; component: ImportSpec | null };

/** A design entry the Figma story already links. */
export type LinkedEntry = { name: string; url: string };

function walk(node: FigmaNode, visit: (node: FigmaNode) => boolean) {
    if (!visit(node)) {
        return;
    }
    for (const child of node.children ?? []) {
        walk(child, visit);
    }
}

/** Every COMPONENT_SET in the subtree, in document order; a set's own subtree holds no further sets. */
export function componentSets(root: FigmaNode): FigmaNode[] {
    const sets: FigmaNode[] = [];
    walk(root, (node) => {
        if (node.type === 'COMPONENT_SET') {
            sets.push(node);

            return false;
        }

        return true;
    });

    return sets;
}

/**
 * The `/nodes` entry Figma would return for `set` alone, cut from the entry of a node above it: the set's subtree and
 * only the components its instances point at.
 */
export function setEntry(set: FigmaNode, from: NodesEntry): NodesEntry {
    const ids = new Set<string>();
    walk(set, (node) => {
        if (node.componentId) {
            ids.add(node.componentId);
        }

        return true;
    });
    const components = Object.fromEntries(
        Object.entries(from.components ?? {}).filter(([id]) => {
            return ids.has(id);
        })
    );
    const setIds = new Set(
        Object.values(components).flatMap((component) => {
            return component.componentSetId ? [component.componentSetId] : [];
        })
    );
    const componentSetsOf = Object.fromEntries(
        Object.entries(from.componentSets ?? {}).filter(([id]) => {
            return setIds.has(id);
        })
    );

    return { document: set, components, componentSets: componentSetsOf };
}

/** `url` pointing at `nodeId` instead: same file and file name, only `node-id` kept. */
export function nodeUrl(url: string, nodeId: string): string {
    const parsed = new URL(url);

    return `${parsed.origin}${parsed.pathname}?node-id=${nodeId.replace(':', '-')}`;
}

function kebab(value: string): string {
    return value
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/[^A-Za-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();
}

/**
 * The default design entry name: the set name's last `/` segment, the component's name stripped where it leads a word
 * (`Button Icon` → `icon`, `ButtonGroup` → `group`, not `Buttons` → `s`), in kebab-case.
 */
export function entryName(setName: string, component: string): string {
    const last = (setName.split('/').at(-1) ?? setName).trim();
    const head = last.slice(0, component.length);
    const rest = last.slice(component.length);
    const stripped = head.toLowerCase() === component.toLowerCase() && !/^[a-z]/.test(rest) ? rest : last;

    return kebab(stripped) || kebab(component) || 'set';
}

/** `State` across, else the axis with the most options; `Size` as sections when it isn't the columns. */
export function defaultLayout(axes: FigmaSetManifest['axes']): FigmaMatrixLayout {
    const columns =
        axes.find((axis) => {
            return axis.name === 'State';
        }) ??
        axes.reduce<FigmaSetManifest['axes'][number] | undefined>((best, axis) => {
            return !best || axis.options.length > best.options.length ? axis : best;
        }, undefined);
    if (!columns) {
        throw new Error('has no variant properties');
    }
    const size = axes.some((axis) => {
        return axis.name === 'Size';
    });

    return { columns: columns.name, sections: size && columns.name !== 'Size' ? 'Size' : null };
}

/** The scaffolded set for `set`, found under `url` in a `/nodes` entry `from`. */
export function scaffoldSet(url: string, fileKey: string, set: FigmaNode, from: NodesEntry, component: string) {
    return {
        fileKey,
        nodeId: set.id,
        url: nodeUrl(url, set.id),
        set: set.name,
        name: entryName(set.name, component),
        layout: defaultLayout(variantAxes(set)),
        entry: setEntry(set, from),
    } satisfies ScaffoldSet;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

function quote(value: string): string {
    const escaped = value
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/[\r\n\u2028\u2029]/g, (char) => {
            return `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
        });

    return `'${escaped}'`;
}

function key(name: string): string {
    return IDENTIFIER.test(name) ? name : quote(name);
}

function importLine(spec: ImportSpec): string {
    if (spec.imported === 'default') {
        return `import ${spec.local} from ${quote(spec.source)};`;
    }
    const named = spec.imported === spec.local ? spec.local : `${spec.imported} as ${spec.local}`;

    return `import { ${named} } from ${quote(spec.source)};`;
}

function designCode(set: ScaffoldSet): string {
    return `{ name: ${quote(set.name)}, type: 'figma', url: ${quote(set.url)} }`;
}

function blockCode(set: ScaffoldSet): string {
    const sections = set.layout.sections === null ? 'null' : quote(set.layout.sections);

    return `{ name: ${quote(set.name)}, layout: { sections: ${sections}, columns: ${quote(set.layout.columns)} } }`;
}

function todo(set: ScaffoldSet): string {
    // A line break in a Figma name would end the `//` comment and turn the rest of the name into code.
    const name = set.set.replace(/[\r\n\u2028\u2029]+/g, ' ');

    return ` TODO(figma-qa): render the code's variant for these Figma ${name} props; null reports the cell missing.`;
}

/** A stub renderer under its TODO, lines unindented. */
function renderCellCode(set: ScaffoldSet): string {
    return `//${todo(set)}\n${key(set.name)}: () => {\n    return null;\n}`;
}

/** `code` with every line after the first at `indent`; the first line goes where the caller writes it. */
function indented(code: string, indent: string): string {
    return code.replaceAll('\n', `\n${indent}`);
}

/** The three additions a story needs per set, for a file scaffold can't edit. */
export function scaffoldSnippet(sets: readonly ScaffoldSet[]): string {
    return [
        '// meta parameters.design:',
        ...sets.map((set) => {
            return `${designCode(set)},`;
        }),
        '// Matrix story parameters.figmaMatrix.blocks:',
        ...sets.map((set) => {
            return `${blockCode(set)},`;
        }),
        '// renderCell:',
        ...sets.map((set) => {
            return `${renderCellCode(set)},`;
        }),
    ].join('\n');
}

/** A new Figma story linking `sets`. */
export function newFigmaStory(head: StoryHead, sets: readonly ScaffoldSet[]): string {
    const imports = [
        `import type { RenderCell } from '${PREVIEW_ENTRY}';`,
        `import { FigmaMatrix } from '${PREVIEW_ENTRY}';`,
        importLine(head.preview),
        ...(head.component ? [importLine(head.component)] : []),
    ];

    return [
        '// Written by `figma-qa scaffold`: a re-run appends sets not linked yet, never renaming, reordering or removing.',
        "// Rename each entry to the code's variant and write its renderCell: until then its cells report missing.",
        ...imports,
        '',
        `const meta = ${head.preview.local}.meta({`,
        `    title: ${quote(head.title)},`,
        ...(head.component ? [`    component: ${head.component.local},`] : []),
        `    tags: ['${FIGMA_TAG}', '!autodocs'],`,
        '    parameters: {',
        '        design: [',
        ...sets.map((set) => {
            return `            ${designCode(set)},`;
        }),
        '        ],',
        '    },',
        '});',
        '',
        '/** Figma variant props → the code component, one renderer per design entry. */',
        'const renderCell: Record<string, RenderCell> = {',
        ...sets.map((set) => {
            return `    ${indented(renderCellCode(set), '    ')},`;
        }),
        '};',
        '',
        'export const Matrix = meta.story({',
        '    parameters: {',
        '        figmaMatrix: {',
        '            blocks: [',
        ...sets.map((set) => {
            return `                ${blockCode(set)},`;
        }),
        '            ],',
        '        },',
        '    },',
        '    render: (_args, context) => {',
        '        return <FigmaMatrix context={context} renderCell={renderCell} />;',
        '    },',
        '});',
        '',
    ].join('\n');
}

/** The scaffold's anchors in an existing Figma story, each a literal it can append to. */
type Anchors = { design: ArrayNode; blocks: ArrayNode; renderCell: ObjectNode; linked: LinkedEntry[] };

/** `<name> = <x>.<method>({…})` at the top level, exported or not: the declared name and the call's object. */
function topLevelCalls(program: Program, method: string): { name: string; object: ObjectNode }[] {
    const found: { name: string; object: ObjectNode }[] = [];
    for (const statement of program.body) {
        const declaration = statement.type === 'ExportNamedDeclaration' ? (statement.declaration as AstNode) : statement;
        if (declaration?.type !== 'VariableDeclaration') {
            continue;
        }
        for (const declarator of declaration.declarations as AstNode[]) {
            const init = unwrap(declarator.init as AstNode | null);
            const callee = isCall(init) ? init.callee : null;
            if (isCall(init) && callee?.type === 'MemberExpression' && calleeName(init) === method) {
                found.push({ name: (declarator.id as AstNode).name as string, object: soleObjectArgument(init) });
            }
        }
    }

    return found;
}

function objectAt(object: ObjectNode, key: string): ObjectNode {
    const value = propertyValue(object, key);
    if (!isObject(value)) {
        throw new Unsafe(`\`${key}\` is not an object literal`);
    }

    return value;
}

function arrayAt(object: ObjectNode, key: string): ArrayNode {
    const array = literalArray(object, key);
    if (!array) {
        throw new Unsafe(`no \`${key}\` array`);
    }

    return array;
}

function anchors(program: Program): Anchors {
    const [meta, ...others] = topLevelCalls(program, 'meta');
    if (!meta || others.length > 0) {
        throw new Unsafe('the file does not declare exactly one `preview.meta({…})`');
    }
    const design = arrayAt(objectAt(meta.object, 'parameters'), 'design');
    // Read first: an entry scaffold can't read means it can't tell what the file links.
    const linked = design.elements.map((element) => {
        const entry = unwrap(element);
        const name = isObject(entry) ? stringValue(propertyValue(entry, 'name')) : null;
        const url = isObject(entry) ? stringValue(propertyValue(entry, 'url')) : null;
        if (name === null || url === null) {
            throw new Unsafe('a `design` entry has no string literal `name` and `url`');
        }

        return { name, url };
    });
    const stories = topLevelCalls(program, 'story').filter((story) => {
        const parameters = propertyValue(story.object, 'parameters');

        return isObject(parameters) && propertyValue(parameters, 'figmaMatrix') !== null;
    });
    const [story] = stories;
    if (!story || stories.length > 1) {
        throw new Unsafe('the file does not have exactly one story with `parameters.figmaMatrix`');
    }
    const blocks = arrayAt(objectAt(objectAt(story.object, 'parameters'), 'figmaMatrix'), 'blocks');
    const renderCell = unwrap(topLevelInit(program, 'renderCell'));
    if (!isObject(renderCell)) {
        throw new Unsafe('no top-level `const renderCell = {…}` object literal');
    }

    return { design, blocks, renderCell, linked };
}

/** The design entries an existing Figma story links and its renderer keys; throws `Unsafe` when scaffold can't read or edit the file. */
export function linkedEntries(source: string): { linked: LinkedEntry[]; renderers: string[] } {
    const found = anchors(parseModule(source).$ast as unknown as Program);
    // A renamed entry may leave its renderer under the old key: a new entry must not take that key either.
    const renderers = found.renderCell.properties.flatMap((property) => {
        const name = keyName(property);

        return name === null ? [] : [name];
    });

    return { linked: found.linked, renderers };
}

/** Where to insert into an array or object literal, and what, for items written as `code`. */
type Insertion = { at: number; text: string };

function lineIndent(source: string, offset: number): string {
    const start = source.lastIndexOf('\n', offset - 1) + 1;

    return /^[ \t]*/.exec(source.slice(start))?.[0] ?? '';
}

/**
 * Appends `items` (each one or more lines of code) after the last item of `container` in the source text, in the
 * container's own layout: one per line at the last item's indent with a trailing comma when the file uses them, or
 * inline when the last item shares the container's opening line.
 */
function appendInto(source: string, container: AstNode, items: AstNode[], code: string[]): Insertion {
    const open = container.start as number;
    const close = (container.end as number) - 1;
    const last = items.at(-1);
    if (!last) {
        const indent = lineIndent(source, open);
        const inner = `${indent}    `;

        const lines = code.map((item) => {
            return `${inner}${indented(item, inner)},`;
        });

        return { at: close, text: `\n${lines.join('\n')}\n${indent}` };
    }
    const end = last.end as number;
    const between = source.slice(end, close);
    const comma = /^\s*,/.exec(between);
    if (!source.slice(open, last.start as number).includes('\n')) {
        // `[a, b]` on one line stays one line.
        const text = code
            .map((item) => {
                return `, ${item}`;
            })
            .join('');

        return { at: comma ? end + comma[0].length : end, text };
    }
    const indent = lineIndent(source, last.start as number);
    const lines = code.map((item) => {
        return `${indent}${indented(item, indent)}`;
    });
    // After the last item's own trailing comma, every new item keeps one; else each is preceded by one.
    const text = lines
        .map((line) => {
            return comma ? `\n${line},` : `,\n${line}`;
        })
        .join('');

    return { at: comma ? end + comma[0].length : end, text };
}

/**
 * `source` with `sets` appended to its design entries, matrix blocks and renderers. The AST only locates the
 * literals; the text is spliced in, so everything else, formatting included, stays byte for byte.
 */
export function appendSets(source: string, sets: readonly ScaffoldSet[]): string {
    const found = anchors(parseModule(source).$ast as unknown as Program);
    const insertions = [
        appendInto(source, found.design, found.design.elements as AstNode[], sets.map(designCode)),
        appendInto(source, found.blocks, found.blocks.elements as AstNode[], sets.map(blockCode)),
        appendInto(
            source,
            found.renderCell,
            found.renderCell.properties,
            sets.map(renderCellCode)
        ),
    ].sort((a, b) => {
        return b.at - a.at;
    });

    return insertions.reduce((text, insertion) => {
        return text.slice(0, insertion.at) + insertion.text + text.slice(insertion.at);
    }, source);
}

/** The import binding `local`, as an `ImportSpec`; null for a namespace import or none. */
function importOf(program: Program, local: string): ImportSpec | null {
    for (const declaration of program.body) {
        if (declaration.type !== 'ImportDeclaration') {
            continue;
        }
        for (const specifier of declaration.specifiers as AstNode[]) {
            if ((specifier.local as AstNode).name !== local) {
                continue;
            }
            const source = stringValue(declaration.source as AstNode) as string;
            if (specifier.type === 'ImportDefaultSpecifier') {
                return { source, local, imported: 'default' };
            }
            if (specifier.type === 'ImportSpecifier') {
                const imported = specifier.imported as AstNode;

                return { source, local, imported: (imported.name as string | undefined) ?? (stringValue(imported) as string) };
            }
        }
    }

    return null;
}

/**
 * What the Figma story repeats from its sibling story, read statically: the meta title, the import of the meta's
 * `component`, and the import whose `.meta(…)` builds the meta (CSF Next). Each is null when the sibling doesn't say.
 */
export function readSibling(file: string, source: string): {
    title: string | null;
    component: ImportSpec | null;
    preview: ImportSpec | null;
} {
    const scanned = scanStoryFile(file, source);
    const program = parseModule(source).$ast as unknown as Program;
    const previewLocal = /\b([A-Za-z_$][\w$]*)\.meta\s*\(/.exec(source)?.[1] ?? null;

    return {
        title: scanned.title,
        component: scanned.component ? importOf(program, scanned.component) : null,
        preview: previewLocal ? importOf(program, previewLocal) : null,
    };
}
