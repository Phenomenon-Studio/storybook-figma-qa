---
title: Philosophy
description: The nine rules the kit is built on, and why each one is there.
sidebar:
  order: 2
---

The kit exists so that "does this match Figma?" gets the same answer from a developer's terminal, an agent session and CI. Each rule below protects that.

## 1. One command, and it never prompts

`figma-qa report` does everything a result needs: checks the setup, starts the browser, syncs Figma, runs the stories, writes the report. It never asks a question. **Why:** a command that prompts behaves differently for a human, an agent and CI. Only [`init`](./commands/init.md) prompts, and only in a terminal.

## 2. Exit codes separate design from infrastructure

`0` ok, `1` a cell differs from Figma, `2` the harness or setup broke. **Why:** a missing token or a dead browser must never read as "the design is wrong", and a design regression must never hide behind a flaky setup. See [Exit codes and warnings](./reference/exit-codes.md).

## 3. Warnings never fail a run

Host Chromium, Figma changed since the last sync, unnamed variables: each prints a `WARN` and leaves the exit code alone. **Why:** noise that blocks people teaches them to ignore the check.

## 4. Link a component set once, in the story

A Figma story names its component sets in `parameters.design`, and the `figma` tag opts it in. There is no central registry. **Why:** a URL written in three places drifts in two of them. See [Figma stories](./figma-stories.md).

## 5. Committed refs make runs offline

The first sync writes each set's manifest and images to `figma-qa/__refs__/`, and you commit them. **Why:** teammates, agents and forks without a Figma token still get a verdict, and a run with every set cached doesn't depend on Figma being reachable.

## 6. The pinned browser is CI's browser

With Docker, every run, local or CI, renders in the same Playwright image, tagged from the project's own `playwright`. Without it, the host's Chromium runs and the output says pixels aren't comparable. **Why:** a pixel diff is only meaningful if both sides rendered the same way.

## 7. A difference is fixed or approved, never ignored

A failing cell ends one of two ways: the code changes, or the story gains an `approved` entry with a reason (a WCAG criterion or a decision). Approved cells are still measured. **Why:** "known differences" that live in someone's head come back as regressions.

## 8. Thin skills, thick CLI

The CLI does the mechanics: sync, measure, triage what code can tell. The agent skills only call it and keep the judgment: is this deviation deliberate, which code variant is this Figma variant. **Why:** mechanics in prose drift and cost tokens; judgment in code guesses.

## 9. The panel and the report are one UI

The Storybook "Figma diff" panel and the HTML report render the same components from the same results, and one module decides every verdict. **Why:** two views that can disagree make neither trustworthy. See [Results UI](./reference/results-ui.md).
