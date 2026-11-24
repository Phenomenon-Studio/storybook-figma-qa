// `figma-qa init`'s edits to a project's Storybook and Vitest config. Only literal shapes are edited: a key whose
// contents can't be read statically (a variable, a call result, a spread, a function export) could hide or duplicate
// entries, so the user gets the exact snippet instead. Safe/unsafe shapes: ticket 02 `## Answer`.
import { detectCodeFormat, generateCode, parseExpression, parseModule } from 'magicast';
import { PACKAGE_NAME } from '../constants.ts';

export type MergeResult =
    | { status: 'present' }
    /** A classic (non CSF Next) preview: the kit's preset `previewAnnotations` apply, nothing to add. */
    | { status: 'classic' }
    | { status: 'merged'; code: string }
    | { status: 'unsafe'; reason: string; snippet: string };

const PREVIEW_ENTRY = `${PACKAGE_NAME}/preview`;
const VITEST_ENTRY = `${PACKAGE_NAME}/vitest`;

export const MAIN_SNIPPET = `addons: [/* … */ '${PACKAGE_NAME}'],`;

export const PREVIEW_SNIPPET = [
    `import figmaQa from '${PREVIEW_ENTRY}';`,
    '',
    'export default definePreview({',
    '    addons: [/* … */ figmaQa()],',
    '});',
].join('\n');

export const VITEST_SNIPPET = [
    `import { figmaQa } from '${VITEST_ENTRY}';`,
    '',
    'export default defineConfig({',
    '    test: {',
    '        projects: [/* … */ figmaQa()],',
    '    },',
    '});',
].join('\n');

/** Babel AST, read structurally: only the node shapes below are ever edited. */
type AstNode = { type: string; [key: string]: unknown };
type ObjectNode = AstNode & { type: 'ObjectExpression'; properties: AstNode[] };
type ArrayNode = AstNode & { type: 'ArrayExpression'; elements: (AstNode | null)[] };
type CallNode = AstNode & { type: 'CallExpression'; callee: AstNode; arguments: AstNode[] };
type Program = { body: AstNode[] };
type Module = ReturnType<typeof parseModule>;

/** Thrown while reading a shape `init` must not edit. */
class Unsafe extends Error {}

/** Type-only and grouping wrappers around the value that matters: `{…} satisfies X`, `({…})`. */
const WRAPPERS = new Set(['TSSatisfiesExpression', 'TSAsExpression', 'TSNonNullExpression', 'ParenthesizedExpression']);

function unwrap(node: AstNode | null | undefined): AstNode | null {
    let current = node ?? null;
    while (current && WRAPPERS.has(current.type)) {
        current = current.expression as AstNode;
    }

    return current;
}

function isObject(node: AstNode | null): node is ObjectNode {
    return node?.type === 'ObjectExpression';
}

function isArray(node: AstNode | null): node is ArrayNode {
    return node?.type === 'ArrayExpression';
}

function isCall(node: AstNode | null): node is CallNode {
    return node?.type === 'CallExpression';
}

function stringValue(node: AstNode | null): string | null {
    return node?.type === 'StringLiteral' ? (node.value as string) : null;
}

/** `definePreview(…)` and `sb.definePreview(…)` both name `definePreview`. */
function calleeName(call: CallNode): string | null {
    const callee = call.callee;
    if (callee.type === 'Identifier') {
        return callee.name as string;
    }
    if (callee.type === 'MemberExpression' && (callee.property as AstNode).type === 'Identifier') {
        return (callee.property as AstNode).name as string;
    }

    return null;
}

function isCallOf(node: AstNode | null, name: string): boolean {
    const value = unwrap(node);

    return isCall(value) && value.callee.type === 'Identifier' && value.callee.name === name;
}

function soleObjectArgument(call: CallNode): ObjectNode {
    const argument = unwrap(call.arguments[0]);
    if (call.arguments.length !== 1 || !isObject(argument)) {
        throw new Unsafe(`\`${calleeName(call)}(…)\` does not take an object literal`);
    }

    return argument;
}

function topLevelInit(program: Program, name: string): AstNode | null {
    for (const statement of program.body) {
        const declaration = statement.type === 'ExportNamedDeclaration' ? (statement.declaration as AstNode) : statement;
        if (declaration?.type !== 'VariableDeclaration') {
            continue;
        }
        for (const declarator of declaration.declarations as AstNode[]) {
            const id = declarator.id as AstNode;
            if (id.type === 'Identifier' && id.name === name) {
                return (declarator.init as AstNode | null) ?? null;
            }
        }
    }

    return null;
}

/** The default export's value, following `export default config` to a top-level `const config = …`. */
function defaultExport(program: Program): AstNode {
    const statement = program.body.find((node) => {
        return node.type === 'ExportDefaultDeclaration';
    });
    if (!statement) {
        throw new Unsafe('no `export default`');
    }
    let value = unwrap(statement.declaration as AstNode);
    if (value?.type === 'Identifier') {
        value = unwrap(topLevelInit(program, value.name as string));
    }
    if (!value) {
        throw new Unsafe('the default export is not a top-level `const`');
    }

    return value;
}

function keyName(property: AstNode): string | null {
    if (property.type !== 'ObjectProperty' || property.computed) {
        return null;
    }
    const key = property.key as AstNode;

    return key.type === 'Identifier' ? (key.name as string) : stringValue(key);
}

/** The value of `key`, or null when absent. A spread may hold the key, so an absent key next to one is unsafe. */
function propertyValue(object: ObjectNode, key: string): AstNode | null {
    const property = object.properties.find((node) => {
        return keyName(node) === key;
    });
    if (property) {
        return unwrap(property.value as AstNode);
    }
    if (
        object.properties.some((node) => {
            return node.type === 'SpreadElement';
        })
    ) {
        throw new Unsafe(`\`${key}\` may come from a spread`);
    }

    return null;
}

function literalArray(object: ObjectNode, key: string): ArrayNode | null {
    const value = propertyValue(object, key);
    if (value === null) {
        return null;
    }
    if (!isArray(value)) {
        throw new Unsafe(`\`${key}\` is not an array literal`);
    }
    if (
        value.elements.some((node) => {
            return node?.type === 'SpreadElement';
        })
    ) {
        throw new Unsafe(`\`${key}\` holds a spread`);
    }

    return value;
}

/** A call or object expression node; magicast hands literals back as plain values, so strings use `stringNode`. */
function expression(code: string): AstNode {
    return (parseExpression(code) as { $ast: unknown }).$ast as AstNode;
}

function stringNode(value: string): AstNode {
    return { type: 'StringLiteral', value };
}

/** Single quotes unless the file only uses double ones (magicast's own detection defaults to double). */
function quoteStyle(source: string): 'single' | 'double' {
    return /"[^"\n]*"/.test(source) && !/'[^'\n]*'/.test(source) ? 'double' : 'single';
}

function addProperty(object: ObjectNode, code: string) {
    object.properties.push((expression(`{ ${code} }`) as ObjectNode).properties[0] as AstNode);
}

function imports(program: Program): AstNode[] {
    return program.body.filter((node) => {
        return node.type === 'ImportDeclaration';
    });
}

/** The local name a specifier of `source` binds, e.g. the default import, or the named import `figmaQa`. */
function importedLocal(program: Program, source: string, imported: 'default' | string): string | null {
    for (const declaration of imports(program)) {
        if (stringValue(declaration.source as AstNode) !== source) {
            continue;
        }
        for (const specifier of declaration.specifiers as AstNode[]) {
            const name =
                specifier.type === 'ImportDefaultSpecifier'
                    ? 'default'
                    : specifier.type === 'ImportSpecifier'
                      ? ((specifier.imported as AstNode).name ?? stringValue(specifier.imported as AstNode))
                      : null;
            if (name === imported) {
                return (specifier.local as AstNode).name as string;
            }
        }
    }

    return null;
}

/** `base`, else `base2`, `base3`…: the first name no import or top-level declaration binds. */
function freeName(program: Program, base: string): string {
    const taken = new Set<string>();
    for (const statement of program.body) {
        if (statement.type === 'ImportDeclaration') {
            for (const specifier of statement.specifiers as AstNode[]) {
                taken.add((specifier.local as AstNode).name as string);
            }
        }
        const declaration = statement.type.startsWith('Export') ? (statement.declaration as AstNode | null) : statement;
        if (declaration?.type === 'VariableDeclaration') {
            for (const declarator of declaration.declarations as AstNode[]) {
                const id = declarator.id as AstNode;
                if (id.type === 'Identifier') {
                    taken.add(id.name as string);
                }
            }
        } else if (declaration?.id) {
            taken.add((declaration.id as AstNode).name as string);
        }
    }
    let name = base;
    for (let index = 2; taken.has(name); index++) {
        name = `${base}${index}`;
    }

    return name;
}

/**
 * Appends `local()` to `array` (or a new `key` on `object`), importing `imported` from `source` first when the file
 * doesn't. Present when the file already calls its import of the kit entry there.
 */
function addEntryCall(
    module: Module,
    program: Program,
    target: { object: ObjectNode; key: string; array: ArrayNode | null },
    entry: { source: string; imported: 'default' | string; base: string }
): 'present' | 'merged' {
    let local = importedLocal(program, entry.source, entry.imported);
    if (
        local &&
        target.array?.elements.some((node) => {
            return isCallOf(node, local as string);
        })
    ) {
        return 'present';
    }
    if (!local) {
        local = freeName(program, entry.base);
        module.imports.$append({ from: entry.source, imported: entry.imported, local });
    }
    if (target.array) {
        target.array.elements.push(expression(`${local}()`));
    } else {
        addProperty(target.object, `${target.key}: [${local}()]`);
    }

    return 'merged';
}

function merge(
    source: string,
    snippet: string,
    edit: (module: Module, program: Program) => 'present' | 'classic' | 'merged'
): MergeResult {
    let module: Module;
    try {
        module = parseModule(source);
    } catch (error) {
        return { status: 'unsafe', reason: `does not parse (${(error as Error).message})`, snippet };
    }
    try {
        const status = edit(module, module.$ast as unknown as Program);
        if (status !== 'merged') {
            return { status };
        }
    } catch (error) {
        if (error instanceof Unsafe) {
            return { status: 'unsafe', reason: error.message, snippet };
        }
        throw error;
    }

    // New nodes follow the file's quotes and indent; untouched code keeps its own text.
    return { status: 'merged', code: generateCode(module, { format: { ...detectCodeFormat(source), quote: quoteStyle(source) } }).code };
}

/** True for the kit as `'pkg'`, `{ name: 'pkg', … }` or `getAbsolutePath('pkg')`. */
function namesKit(node: AstNode | null): boolean {
    const value = unwrap(node);
    if (isObject(value)) {
        return stringValue(propertyValue(value, 'name')) === PACKAGE_NAME;
    }
    if (isCall(value)) {
        return stringValue(unwrap(value.arguments[0])) === PACKAGE_NAME;
    }

    return stringValue(value) === PACKAGE_NAME;
}

/** `.storybook/main`: the kit in `addons` loads its preset and manager. */
export function mergeMain(source: string): MergeResult {
    return merge(source, MAIN_SNIPPET, (_module, program) => {
        const value = defaultExport(program);
        let config: ObjectNode;
        if (isObject(value)) {
            config = value;
        } else if (isCall(value) && calleeName(value) === 'defineMain') {
            config = soleObjectArgument(value);
        } else {
            throw new Unsafe('the default export is neither an object literal nor `defineMain({…})`');
        }
        const addons = literalArray(config, 'addons');
        if (addons?.elements.some(namesKit)) {
            return 'present';
        }
        if (addons) {
            addons.elements.push(stringNode(PACKAGE_NAME));
        } else {
            addProperty(config, `addons: ['${PACKAGE_NAME}']`);
        }

        return 'merged';
    });
}

/** `.storybook/preview`: CSF Next ignores preset `previewAnnotations`, so `definePreview` must list the kit. */
export function mergePreview(source: string): MergeResult {
    return merge(source, PREVIEW_SNIPPET, (module, program) => {
        const value = defaultExport(program);
        if (isObject(value)) {
            return 'classic';
        }
        if (!isCall(value) || calleeName(value) !== 'definePreview') {
            throw new Unsafe('the default export is neither `definePreview({…})` nor an object literal');
        }
        const config = soleObjectArgument(value);

        return addEntryCall(
            module,
            program,
            { object: config, key: 'addons', array: literalArray(config, 'addons') },
            { source: PREVIEW_ENTRY, imported: 'default', base: 'figmaQa' }
        );
    });
}

function vitestConfigObject(node: AstNode | null): ObjectNode {
    const value = unwrap(node);
    if (isObject(value)) {
        return value;
    }
    if (isCall(value) && calleeName(value) === 'defineConfig') {
        return soleObjectArgument(value);
    }
    // `mergeConfig(viteConfig, defineConfig({ test }))`: the test config is the last argument.
    if (isCall(value) && calleeName(value) === 'mergeConfig') {
        return vitestConfigObject(value.arguments.at(-1) ?? null);
    }
    throw new Unsafe('the default export is not `defineConfig({…})`, `mergeConfig(…, {…})` or an object literal');
}

/** The Vitest config: the kit's `figma-qa` project joins `test.projects`, other projects untouched. */
export function mergeVitest(source: string): MergeResult {
    return merge(source, VITEST_SNIPPET, (module, program) => {
        const config = vitestConfigObject(defaultExport(program));
        const test = propertyValue(config, 'test');
        if (!isObject(test)) {
            throw new Unsafe(
                test === null ? 'no `test` block (run `storybook add @storybook/addon-vitest`)' : '`test` is not an object literal'
            );
        }
        const projects = literalArray(test, 'projects');
        if (!projects) {
            // Moving a root `test` config into a project changes how the user's tests run: their call.
            throw new Unsafe('`test` has no `projects`');
        }

        return addEntryCall(
            module,
            program,
            { object: test, key: 'projects', array: projects },
            { source: VITEST_ENTRY, imported: 'figmaQa', base: 'figmaQa' }
        );
    });
}
