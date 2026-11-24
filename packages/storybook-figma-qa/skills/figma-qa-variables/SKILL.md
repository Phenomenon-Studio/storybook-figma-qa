---
name: figma-qa-variables
description: Name the Figma variables that figma-qa reports as unnamed, through the Figma MCP `use_figma`. Use when `figma-qa report` warns that Figma variables are unnamed, or a spec row reads `var … (unnamed) · guess`.
---

# Name Figma variables

Spec rows hold a colour to the kit token its Figma variable names. Figma's REST API gives variable names only on Enterprise, so names come from the Plugin API: `figma-qa variables` prints the script and merges its output into the committed `figma-qa/__refs__/variables.json`. Your part is carrying the script to Figma and its output back, unchanged.

1. Run `figma-qa variables`. Stdout holds one script block per Figma file, each headed `// Figma file <key>: …`. Empty stdout means every bound variable is named: stop.
2. For each block, run it whole with the Figma MCP `use_figma` on that file key. Load the `figma-use` skill first, as that tool requires. The script only reads `figma.variables`.
3. Save each returned JSON object verbatim to a scratch file and run `figma-qa variables <file>` (or pipe it to `figma-qa variables -`).
   - Exit 2 saying the output isn't the script's shape: copy it again from the tool result, unedited.
   - Ids `not found in the file the script ran in` stay unnamed: they live in another file or were deleted. Relay them to the user.

**Done when** `figma-qa variables` prints nothing on stdout, or every id left is relayed as not found, and `variables.json` is updated.
