// Figma variables the synced component sets are bound to, by id, committed as `variables.json` in the refs dir. Names
// let spec rows say which variable Figma uses ("var Surface/control = --color-surface-control") instead of guessing
// the nearest token by value. Browser-safe: no Node imports.

export type FigmaVariable = { collection: string; type: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN'; name: string };

/** Keyed by variable id without the `VariableID:` prefix (`8019:325`). */
export type FigmaVariableCatalog = {
    source: { fileKey: string; via: string; updatedAt: string };
    variables: Record<string, FigmaVariable>;
};
