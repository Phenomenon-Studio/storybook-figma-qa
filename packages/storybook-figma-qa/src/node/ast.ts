// Reading and editing user source files with magicast, on literal shapes only. A key whose contents can't be read
// statically (a variable, a call result, a spread, a function export) could hide or duplicate entries, so readers throw
// `Unsafe` and the command prints the exact snippet instead. Used by `init` (merge.ts) and `scaffold` (scaffold.ts).
import { detectCodeFormat, generateCode, parseExpression, parseModule } from 'magicast';

/** Babel AST, read structurally: only the node shapes below are ever edited. */
export type AstNode = { type: string; [key: string]: unknown };
export type ObjectNode = AstNode & { type: 'ObjectExpression'; properties: AstNode[] };
export type ArrayNode = AstNode & { type: 'ArrayExpression'; elements: (AstNode | null)[] };
export type CallNode = AstNode & { type: 'CallExpression'; callee: AstNode; arguments: AstNode[] };
export type Program = { body: AstNode[] };
export type Module = ReturnType<typeof parseModule>;

/** Thrown while reading a shape the CLI must not edit: the user gets the exact snippet instead. */
export class Unsafe extends Error {}

/** Type-only and grouping wrappers around the value that matters: `{…} satisfies X`, `({…})`. */
export const WRAPPERS = new Set(['TSSatisfiesExpression', 'TSAsExpression', 'TSNonNullExpression', 'ParenthesizedExpression']);

export function unwrap(node: AstNode | null | undefined): AstNode | null {
    let current = node ?? null;
    while (current && WRAPPERS.has(current.type)) {
        current = current.expression as AstNode;
    }

    return current;
}

export function isObject(node: AstNode | null): node is ObjectNode {
    return node?.type === 'ObjectExpression';
}

export function isArray(node: AstNode | null): node is ArrayNode {
    return node?.type === 'ArrayExpression';
}

export function isCall(node: AstNode | null): node is CallNode {
    return node?.type === 'CallExpression';
}

export function stringValue(node: AstNode | null): string | null {
    return node?.type === 'StringLiteral' ? (node.value as string) : null;
}

/** `definePreview(…)` and `sb.definePreview(…)` both name `definePreview`. */
export function calleeName(call: CallNode): string | null {
    const callee = call.callee;
    if (callee.type === 'Identifier') {
        return callee.name as string;
    }
    if (callee.type === 'MemberExpression' && (callee.property as AstNode).type === 'Identifier') {
        return (callee.property as AstNode).name as string;
    }

    return null;
}

export function isCallOf(node: AstNode | null, name: string): boolean {
    const value = unwrap(node);

    return isCall(value) && value.callee.type === 'Identifier' && value.callee.name === name;
}

export function soleObjectArgument(call: CallNode): ObjectNode {
    const argument = unwrap(call.arguments[0]);
    if (call.arguments.length !== 1 || !isObject(argument)) {
        throw new Unsafe(`\`${calleeName(call)}(…)\` does not take an object literal`);
    }

    return argument;
}

export function topLevelInit(program: Program, name: string): AstNode | null {
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
export function defaultExport(program: Program): AstNode {
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

export function keyName(property: AstNode): string | null {
    if (property.type !== 'ObjectProperty' || property.computed) {
        return null;
    }
    const key = property.key as AstNode;

    return key.type === 'Identifier' ? (key.name as string) : stringValue(key);
}

/** The value of `key`, or null when absent. A spread may hold the key, so an absent key next to one is unsafe. */
export function propertyValue(object: ObjectNode, key: string): AstNode | null {
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

export function literalArray(object: ObjectNode, key: string): ArrayNode | null {
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
export function expression(code: string): AstNode {
    return (parseExpression(code) as { $ast: unknown }).$ast as AstNode;
}

export function stringNode(value: string): AstNode {
    return { type: 'StringLiteral', value };
}

/** Single quotes unless the file only uses double ones (magicast's own detection defaults to double). */
export function quoteStyle(source: string): 'single' | 'double' {
    return /"[^"\n]*"/.test(source) && !/'[^'\n]*'/.test(source) ? 'double' : 'single';
}

export function addProperty(object: ObjectNode, code: string) {
    object.properties.push((expression(`{ ${code} }`) as ObjectNode).properties[0] as AstNode);
}

export function imports(program: Program): AstNode[] {
    return program.body.filter((node) => {
        return node.type === 'ImportDeclaration';
    });
}

/** The local name a specifier of `source` binds, e.g. the default import, or the named import `figmaQa`. */
export function importedLocal(program: Program, source: string, imported: 'default' | string): string | null {
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
export function freeName(program: Program, base: string): string {
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

/** The edited module's code: new nodes follow the file's quotes and indent; untouched code keeps its own text. */
export function generate(module: Module, source: string): string {
    return generateCode(module, { format: { ...detectCodeFormat(source), quote: quoteStyle(source) } }).code;
}
