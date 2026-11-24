// `figma-qa init`'s edits to a project's Storybook and Vitest config, on literal shapes only (ast.ts). Safe/unsafe
// shapes: ticket 02 `## Answer`.
import type { ArrayNode, AstNode, Module, ObjectNode, Program } from './ast.ts';
import { parseModule } from 'magicast';
import { PACKAGE_NAME } from '../constants.ts';
import {
    addProperty,
    calleeName,
    defaultExport,
    expression,
    freeName,
    generate,
    importedLocal,
    isCall,
    isCallOf,
    isObject,
    literalArray,
    propertyValue,
    soleObjectArgument,
    stringNode,
    stringValue,
    unwrap,
    Unsafe,
} from './ast.ts';

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

    return { status: 'merged', code: generate(module, source) };
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
