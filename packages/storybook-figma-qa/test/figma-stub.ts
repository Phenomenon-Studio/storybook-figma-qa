// A stand-in for the Figma REST API at the network edge: serves the recorded `/meta`, `/nodes`, `/images` responses
// of test/figma-api/<fileKey>/ (written by scripts/fixture-refs.mjs) and logs every request. The CLI reaches it
// through FIGMA_API_URL.
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const RECORDINGS = fileURLToPath(new URL('./figma-api/', import.meta.url));

export type Route = 'me' | 'meta' | 'nodes' | 'images' | 'png';

type Nodes = { version: string; lastModified: string; nodes: Record<string, unknown> };

export type FigmaStub = {
    url: string;
    /** File version `/meta` reports (the recordings are version 1). */
    version: string;
    /** The recorded `/nodes` response; edit it to change what Figma serves. */
    nodes: Nodes;
    /** The only token Figma accepts; null accepts any. */
    token: string | null;
    /** Answer every API route with this instead. */
    fail: { status: number; headers?: Record<string, string> } | null;
    requests: { route: Route; url: URL }[];
    routes: () => Route[];
    close: () => Promise<void>;
};

export async function startFigmaStub(fileKey: string): Promise<FigmaStub> {
    const dir = `${RECORDINGS}${fileKey}/`;
    const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', stub.url);
        const json = (body: unknown) => {
            res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
        };
        const png = /^\/png\/([\w-]+)$/.exec(url.pathname)?.[1];
        if (png) {
            stub.requests.push({ route: 'png', url });
            res.writeHead(200, { 'content-type': 'image/png' }).end(readFileSync(`${dir}images/${png}.png`));

            return;
        }
        const route: Route | null =
            url.pathname === '/v1/me'
                ? 'me'
                : url.pathname === `/v1/files/${fileKey}/meta`
                  ? 'meta'
                  : url.pathname === `/v1/files/${fileKey}/nodes`
                    ? 'nodes'
                    : url.pathname === `/v1/images/${fileKey}`
                      ? 'images'
                      : null;
        if (!route) {
            res.writeHead(404).end('not recorded');

            return;
        }
        stub.requests.push({ route, url });
        if (stub.fail) {
            res.writeHead(stub.fail.status, stub.fail.headers).end(JSON.stringify({ status: stub.fail.status }));

            return;
        }
        const token = req.headers['x-figma-token'];
        if (!token || (stub.token !== null && token !== stub.token)) {
            res.writeHead(403).end(JSON.stringify({ status: 403, err: 'Invalid token' }));

            return;
        }
        const ids = (url.searchParams.get('ids') ?? '').split(',');
        if (route === 'me') {
            json({ id: '1', handle: 'Fixture Dev', email: 'dev@example.com' });
        } else if (route === 'meta') {
            json({ file: { name: 'Fixture UI kit', version: stub.version, last_touched_at: stub.nodes.lastModified } });
        } else if (route === 'nodes') {
            json({
                ...stub.nodes,
                version: stub.version,
                nodes: Object.fromEntries(
                    ids.map((id) => {
                        return [id, stub.nodes.nodes[id] ?? null];
                    })
                ),
            });
        } else {
            json({
                err: null,
                images: Object.fromEntries(
                    ids.map((id) => {
                        return [id, `${stub.url}/png/${id.replace(':', '-')}`];
                    })
                ),
            });
        }
    });
    await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
    });
    const stub: FigmaStub = {
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        version: '1',
        nodes: JSON.parse(readFileSync(`${dir}nodes.json`, 'utf8')) as Nodes,
        token: null,
        fail: null,
        requests: [],
        routes: () => {
            return stub.requests.map((request) => {
                return request.route;
            });
        },
        close: () => {
            return new Promise((resolve) => {
                server.close(() => {
                    resolve();
                });
            });
        },
    };

    return stub;
}
