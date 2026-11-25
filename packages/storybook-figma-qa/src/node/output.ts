// The CLI's stdout, the lines an agent or a `--json` reader parses. Written to the stream, never through `console`:
// the project's Vite and Vitest configs load in this process, and a plugin may take `console` over (vite-plugin-html
// calls consola's `wrapConsole()` on import, which prefixes `[log] `). Diagnostics on stderr may carry such prefixes.

/** One line (or several joined by `\n`) on stdout. */
export function print(text = ''): void {
    process.stdout.write(`${text}\n`);
}
