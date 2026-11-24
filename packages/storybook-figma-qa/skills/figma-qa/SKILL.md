---
name: figma-qa
description: Check Storybook stories against the Figma UI kit with `figma-qa report`, triage failing cells, and fix the code or propose an approval. Use when a component with a Figma story changed, when asked whether code matches Figma, or when Figma cells fail.
---

# Figma QA

`figma-qa report` measures every **cell** (one Figma variant rendered by the story's `renderCell`) and triages what it can. This skill is the judgment the CLI leaves: why a cell differs, and whether that is a bug or a deliberate **deviation**. A human confirms every **approval**.

## 1. Run

`pnpm figma-report --json <scope>` (or `figma-qa report --json`), scoped as narrowly as the work: component names or story-id globs for components you touched or were asked about, `--changed [base]` for whatever this branch affects, nothing for the whole kit. Stdout is the run summary (README → "Reading the output"); the cell fields are in [TRIAGE.md](TRIAGE.md).

- **Exit 2**: a harness or setup error, not a design verdict. `errors[]` and `stories[].error` name the fix. Fix a story's configuration yourself; for setup, run `figma-qa doctor` and do what its lines say. A missing or rejected `FIGMA_TOKEN` is the user's to set: hand them the doctor's line and keep the token out of chat.
- **`warnings[]` naming unnamed variables**: run the `figma-qa-variables` skill first, then re-run. Until then colour rows on those variables are guesses.
- **`warnings[]` saying Figma changed since the last sync**: tell the user. `--refresh` adopts the new version and rewrites the committed refs, so run it only when they ask.
- **Cells all `missing` behind `TODO(figma-qa)` stubs**: the story is fresh from `figma-qa scaffold`; run the `figma-qa-scaffold` skill.

**Done when** the run exits 0 or 1 and every warning is handled or relayed.

## 2. Triage

For every entry of every story's `failing[]`, open its `stories[].results` file, find the cell by block and variant, and classify it with [TRIAGE.md](TRIAGE.md). The CLI's `triage` (`harness`, `token`, `value`) is a starting class; `null` is where your judgment is needed.

**Done when** every failing cell has a class, the owning file and line, and the evidence (row or diff region) behind it.

## 3. Act

- **harness** and **mapping**: fix the story yourself.
- **token**, **value**, **structure**, **behaviour**: fix the component or token when the user asked for fixes; otherwise report the cell with its owner.
- **deliberate**: paste the cell's `failing[].approved` entry into that block's `approved`, replace the `TODO` reason with the WCAG criterion or decision it rests on, and ask the user to confirm it. Tolerances and `maxDiffRatio` stay as they are.

Re-run step 1 after each change.

**Done when** every failing cell is fixed, reported with its owner, or approved pending the user's confirmation.

## 4. Report

One section per story, ranked structure → behaviour → value → token → mapping → harness:

```
## <title> › <story> · <pass> pass · <fail> fail · <approved> approved · <missing> missing
| Cell | Class | Figma | Story | Owner (file:line) | Action |
Approvals to confirm: <cells> — <reason>
```

End with the HTML report, `figma-qa/.results/report/index.html`, and any doctor lines still open.
