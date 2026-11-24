---
name: figma-qa
description: Check Storybook stories against the Figma UI kit with the figma-qa CLI. Run the Figma report and read its results.
---

# Figma QA

Run `figma-qa report --json` (alias `pnpm figma-report --json`), optionally with component names or story-id globs, and read the summary on stdout and the per-story results JSON it points at. Exit 0 pass, 1 design failure, 2 harness or setup error (exit 2 naming `figma-qa init`: the kit isn't set up). Triage guidance lands with the kit skills.
