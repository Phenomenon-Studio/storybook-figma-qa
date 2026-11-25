# Designer notes: fact-check each annotation

The designer's Dev Mode annotations come with the refs. In the per-story results JSON, set-level notes are in `blocks[].annotations` and a variant's notes are in `blocks[].cells[].annotations`. `report --json` lists them all in `stories[].annotations`. Each note has these fields:

- `nodeId`: the annotated layer. Instance sublayers look like `I20:2;30:2;31:1`.
- `path`: layer names from the set down to that layer. It is empty for the set itself.
- `variant`: the cell's variant name in `--json`, or the variant id in the results JSON. It is null at set level.
- `label`: plain text. REST drops the category, markdown and pinned properties.

`blocks[].annotations: null`, together with a warning that the notes are not synced, means the refs predate notes. Relay the warning; `--refresh` is the user's call.

Notes never change a verdict. A cell that passes can still carry a note the code ignores.

## 1. Category

When the Figma MCP `use_figma` tool is available, read the categories with this script. It is read-only: it never writes to the file. Use the `fileKey` from the block's `set.url` and the notes' `nodeId`s:

```js
const ids = ['20:0', 'I20:2;30:2;31:1'];
const categories = new Map(
    (await figma.annotations.getAnnotationCategoriesAsync()).map((category) => {
        return [category.id, category.label];
    })
);
const notes = [];
for (const id of ids) {
    const node = await figma.getNodeByIdAsync(id);
    for (const annotation of node?.annotations ?? []) {
        notes.push({
            nodeId: id,
            category: categories.get(annotation.categoryId) ?? 'unknown',
            labelMarkdown: annotation.labelMarkdown ?? null,
            properties: (annotation.properties ?? []).map((property) => {
                return property.type;
            }),
        });
    }
}
return notes;
```

Match the results to the notes by `nodeId` and order. `labelMarkdown` gives back the list markers and bold text that REST loses. Pinned `properties` are claims too, for example "the fill is this variable". Without `use_figma`, record the category as `unknown`.

## 2. Claims

Split each note into claims you can check one at a time. For example, "Hover darkens the fill by one step. Pressed: two steps." is two claims. Route each claim by its category. For `unknown`, route it by what the claim says.

| Category | Check against |
| --- | --- |
| Development | The component's code: props, classes, tokens, markup |
| Interaction | State styles, event handlers, the story's play functions and forced states |
| Accessibility | Roles, names, ARIA, focus order, keyboard use, the story's axe results, the WCAG criteria the note names |
| Content | Copy, labels, truncation, the story's `renderCell` text |
| Discussion, Question | Recorded answers in ADRs and decision logs; a question with no answer stays `open` |

## 3. Fact-check

Check each claim, in this order, against:

1. The code that owns it: the component, its tokens, its story.
2. Decision records: ADRs, decision logs, comments that state a reason, and the block's `approved` reasons.
3. The project glossary (`CONTEXT.md`, `GLOSSARY.md`): a term the note uses means what the glossary says.
4. The cells: the note's own cell and its siblings. The Figma PNG shows what the designer drew.
5. The other notes: two notes that disagree make a conflict.

Each claim gets one of these:

- **applied**: the code does what the claim says. Cite the file and line.
- **conflict**: the code or a record says otherwise. Cite both sides. The code and the records hold until the user rules.
- **open**: the code doesn't do it yet and nothing says it shouldn't. A question with no answer is also open.
- **out of scope**: the claim is about something this component doesn't own, such as a screen, a flow or the backend.

A note's verdict is the worst of its claims, in this order: `conflict`, `open`, `applied`, `out of scope`. A note whose claims are all out of scope is `out of scope`.

**Done when** every note has a verdict and evidence for each claim.

## 4. Ask before changing code

Ask the user about every `conflict` and every `open` note before you change code. Quote the note, give the evidence, and name the file you would change. Never edit code to match a note on your own: a recorded decision may say why the code differs.

## Table

End the report with one row per note:

```
| Block | Node (path) | Category | Verdict | Evidence or reason |
```
