---
title: Storybook Figma QA
description: Check every Storybook story against the Figma UI kit, one variant per cell, with a verdict you can trust in a terminal, an agent session and CI.
template: splash
hero:
  tagline: Does each component match the designers' UI kit? One command checks every Figma variant against its story and says exactly what differs.
  actions:
    - text: Get started
      link: getting-started/
      icon: right-arrow
    - text: View on GitHub
      link: https://github.com/Phenomenon-Studio/storybook-figma-qa
      icon: external
      variant: minimal
---

## Why

Designers draw every variant of a component in Figma; developers build it in code. Over time the two drift: a token swapped, a padding off by 4px, a variant nobody built. Spotting that by eye, component by component, doesn't scale and isn't repeatable.

`@phenomenon-studio/storybook-figma-qa` makes the check a command. A **Figma story** links a component's Figma component sets once. The kit renders every Figma variant as a cell, measures it against Figma's spec (sizes, spacing, type, colours and the tokens behind them) and against Figma's own image, and gives each cell a verdict: `pass`, `fail`, `approved` or `missing`.

## What you get

- **`figma-qa` CLI**: [`init`](./commands/init.md) sets a project up, [`report`](./commands/report.md) is the one command you run, [`scaffold`](./commands/scaffold.md) starts a Figma story from a UI-kit URL.
- **Terminal output an agent can act on**: under each failing cell, what differs from Figma, git-style, and the `approved` entry to paste when a deviation is deliberate.
- **HTML report and Storybook panel**: the same results with images and diff maps, for you and for designers. See [Results UI](./reference/results-ui.md).
- **PR workflow**: a reusable GitHub Actions workflow that checks the stories a PR reaches and keeps one sticky comment. See [CI / PR workflow](./ci.md).
- **Agent skills**: run the report and triage it, finish a scaffolded story, name Figma variables. See [Agent skills](./skills.md).

## Start here

- **[Getting started](./getting-started.md)**: install, first report.
- **[Philosophy](./philosophy.md)**: the rules the kit is built on.
- **[Workflow](./workflow.md)**: from a new component to a green PR.

Works with React + Vite on Storybook 10.6+ and the 11 beta, Vitest 4 and 5, Node 22.12+.
