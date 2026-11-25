import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Stands in for plugins that take over `console` when the config loads (vite-plugin-html calls consola's
// `wrapConsole()` on import, which prefixes `[log] `): the CLI's stdout must not go through `console`.
const log = console.log.bind(console);
console.log = (...args: unknown[]) => {
    log('[log]', ...args);
};

export default defineConfig({
    plugins: [react()],
});
