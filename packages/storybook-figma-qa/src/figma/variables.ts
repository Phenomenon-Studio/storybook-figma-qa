// Figma variables the synced component sets are bound to, by id, committed as `variables.json` in the refs dir. Names
// let spec rows say which variable Figma uses ("var Surface/control = --color-surface-control") instead of guessing
// the nearest token by value. Browser-safe: no Node imports.

export type FigmaVariable = { collection: string; type: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN'; name: string };

/** Keyed by variable id without the `VariableID:` prefix (`8019:325`). */
export type FigmaVariableCatalog = {
    source: { fileKey: string; via: string; updatedAt: string };
    variables: Record<string, FigmaVariable>;
};

/**
 * The CSS colour token a Figma colour variable is expected as: the full path kebab-cased, `%` dropped, with the token
 * prefix: `Surface/control` → `--color-surface-control`. Project-overridable later (`tokenName`).
 */
export function tokenName(variable: FigmaVariable): string {
    const kebab = variable.name
        .toLowerCase()
        .replaceAll('%', '')
        .replaceAll(/[^a-z\d]+/g, '-')
        .replaceAll(/^-|-$/g, '');

    return `--color-${kebab}`;
}
