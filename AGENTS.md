# AGENTS.md — storybook-figma-qa

Layout and commands: [`README.md`](README.md). CI is the definition of done: [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Tickets

Spec and tickets live outside this repo, in the consumer project: `../amber/storybook-mcp/.scratch/figma-qa-kit/` (`spec.md`, `issues/NN-*.md`). Start sessions here with `claude --add-dir ../amber/storybook-mcp`.

- Code and its commits go here. Ticket bookkeeping goes there as a separate commit: `**Status:** resolved`, ticked criteria, and an `## Answer` section (date, kit commit SHAs, CI run, decisions a later ticket needs).
- When a ticket settles a fact the spec states differently, update the spec line in the same bookkeeping commit.

## Both majors, always

Every change must hold on `fixtures/sb10` (Storybook 10.6, Vitest 4) **and** `fixtures/sb11` (Storybook 11 beta, Vitest 5). Prove behaviour by running the real `figma-qa` binary in both fixtures (`test/` drives the CLI against them); unit tests are for pure logic only.

## Gotchas

- **Setup order**: `pnpm install` → `pnpm build` → `pnpm install --offline`. The `figma-qa` bin links only once `dist/cli.js` exists, and fixtures hold an injected copy of the kit that syncs after `build`: rebuild before running anything in a fixture.
- **pnpm 10**, pinned in `packageManager`: pnpm 11 needs Node ≥ 22.13, the floor is 22.12.
- **Manager entry uses classic JSX** (`/** @jsxRuntime classic */` + `import React`): SB 10's manager shares `react` but not `react/jsx-runtime`. So does everything it imports (`src/ui/`), and TanStack Query gets its client per query, never through `QueryClientProvider` (built on `react/jsx-runtime`).
- **Panel and HTML report are one UI**: `src/ui/` components, live in the manager and `renderToStaticMarkup`'d by `report`. Verdicts come only from `figma/verdict.ts`. Their stories (`stories/`, the kit's own SB 10 Storybook in `.storybook/`) run in the `ui` Vitest project with axe.
- **Preview side lives in `definePreview({ addons })`**: CSF Next ignores preset `previewAnnotations`. `definePreviewAddon` comes from `storybook/internal/csf` (the one sanctioned internal import).
- **Edit user config with magicast** on literal shapes only; any other shape prints the exact snippet and exits 2. `storybook/internal/*` AST APIs changed in 11. Safe/unsafe shape list: ticket 02 `## Answer`.
- **Vitest setup files register nothing**: `setProjectAnnotations` throws on 11.
- **Project config reaches the preview as `virtual:figma-qa/config` / `virtual:figma-qa/icons`** from the preset's `viteFinal` (addon-vitest applies it too). Kit entries a user file imports stay out of `optimizeDeps`: a dep discovered mid-run reloads and fails that run.
- **Stale prebundled preview in fixtures**: Vite prebundles `…/preview` into `fixtures/*/node_modules/.cache/storybook/*/*/sb-vitest`, keyed by the lockfile, so a rebuilt kit isn't picked up there. After changing preview-side code, `rm -rf fixtures/*/node_modules/.cache/storybook/*/*/sb-vitest`.
- **`createVitest` needs Vitest's env**: set `VITEST`/`TEST`/`NODE_ENV` first as `startVitest` does (`node/figma-project.ts`), or addon-vitest adds no stories include and nothing is collected.
- **Tests never use real Docker**: `report()` in `test/cli.ts` passes `--host-browser`; browser cases put `test/fake-docker` first on PATH.
- **Skill frontmatter is YAML**: a `: ` in a `description` makes `skills add` skip that skill without an error; the init test lists every file under `skills/` to catch it.
- **Agent skills install** with `DISABLE_TELEMETRY=1 npx -y skills@<pinned> add ./node_modules/@phenomenon-studio/storybook-figma-qa/skills --copy -y -a claude-code codex`; without `-a` it writes ~55 agent dirs on machines with no detected agent.

## Package contract

- ESM only. Peers `storybook ^10.6.0 || ^11.0.0-0`, `vitest ^4 || ^5`, `react`, `react-dom` (the HTML report renders on the server), plus `@storybook/addon-vitest` and `@vitest/browser-playwright` (the `./vitest` project composes them); engines Node ≥ 22.12, Vite ≥ 6.3. Widening or narrowing a range is a semver decision.
- CLI exit codes: 0 ok, 1 design failure, 2 harness or setup error. Only `init` prompts. Commands load lazily so heavy deps cost only the command that uses them.
- Any `figma-qa.config.ts` or committed refs format change is a **major** and ships a `figma-qa migrate` step.
- `skills/` holds thin skills: they call CLI commands and keep only judgment.
- Every command and flag ships a README "Reading the output" example: a real fixture run (shortened, not invented) and how to read each kind of line or field. A change to what a command prints updates its example in the same commit.

## Style

Match the surrounding code: 4-space indent, block-bodied arrows with explicit `return`, relative imports with `.ts` extensions, comments that state the reason. Conventional Commits.
