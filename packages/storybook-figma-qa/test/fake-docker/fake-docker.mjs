// The Docker CLI as `figma-qa report` uses it, without Docker. `FAKE_DOCKER` = `up` (default) | `down` | `fail`.
// `docker info` answers by mode; `docker compose … up --wait` reads the compose file from stdin and serves its port
// with the project's own Playwright (`run-server`), so the report really connects to a remote browser.
// Every call is appended to `FAKE_DOCKER_LOG` as JSON (args, then the compose file); the server's pid goes to
// `FAKE_DOCKER_PID` for the test to stop.
import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';

const mode = process.env.FAKE_DOCKER ?? 'up';
const args = process.argv.slice(2);
function log(entry) {
    if (process.env.FAKE_DOCKER_LOG) {
        appendFileSync(process.env.FAKE_DOCKER_LOG, `${JSON.stringify(entry)}\n`);
    }
}
log(args);

function listening(port) {
    return new Promise((resolve) => {
        const socket = net.connect(port, '127.0.0.1');
        socket.on('connect', () => {
            socket.end();
            resolve(true);
        });
        socket.on('error', () => {
            resolve(false);
        });
    });
}

if (args[0] === 'info') {
    process.exit(mode === 'down' ? 1 : 0);
}
if (args[0] !== 'compose') {
    console.error(`fake docker: unexpected ${args.join(' ')}`);
    process.exit(1);
}
const file = JSON.parse(readFileSync(0, 'utf8'));
log(file);
if (mode === 'fail') {
    console.error('Error response from daemon: Bind for 127.0.0.1:3100 failed: port is already allocated');
    process.exit(1);
}
const port = Number(file.services.browser.ports[0].split(':')[1]);
const manifest = createRequire(path.join(process.cwd(), 'package.json')).resolve('playwright/package.json');
const server = spawn(process.execPath, [path.join(path.dirname(manifest), 'cli.js'), 'run-server', '--port', String(port), '--host', '127.0.0.1'], {
    detached: true,
    stdio: 'ignore',
});
server.unref();
writeFileSync(process.env.FAKE_DOCKER_PID, String(server.pid));
for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await listening(port)) {
        process.exit(0);
    }
    await new Promise((resolve) => {
        setTimeout(resolve, 100);
    });
}
console.error('fake docker: run-server did not listen');
process.exit(1);
