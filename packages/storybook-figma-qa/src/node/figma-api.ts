// The Figma REST edge. FIGMA_TOKEN is read here only, never shipped to the browser. FIGMA_API_URL points the kit at
// another server (tests run against a stub serving recorded responses); image URLs come back absolute, so downloads
// follow whatever server answered.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_API = 'https://api.figma.com';

/** How a rejected token's error starts: the `--ci` summary turns it into "rotate the secret". */
export const TOKEN_REJECTED = 'Figma rejected FIGMA_TOKEN';

/** Figma refused the token: a setup error, whatever is cached. */
export class FigmaTokenError extends Error {
    override name = 'FigmaTokenError';
}

export function figmaToken(): string | null {
    return process.env.FIGMA_TOKEN || null;
}

function apiUrl(endpoint: string): string {
    return `${(process.env.FIGMA_API_URL || DEFAULT_API).replace(/\/$/, '')}/v1${endpoint}`;
}

async function request(endpoint: string, token: string): Promise<Response> {
    return fetch(apiUrl(endpoint), { headers: { 'X-Figma-Token': token } });
}

/** GET a Figma REST endpoint as JSON. 401/403 → FigmaTokenError; 429 is logged with its rate-limit type. */
export async function figmaGet<T>(endpoint: string, token: string): Promise<T> {
    const route = endpoint.split('?')[0];
    let response = await request(endpoint, token);
    const retryAfter = Number(response.headers.get('retry-after'));
    // One bounded retry on a short rate-limit window; a long one (Figma has sent days) is reported, not waited out.
    if (response.status === 429 && retryAfter > 0 && retryAfter <= 60) {
        await new Promise((resolve) => {
            setTimeout(resolve, retryAfter * 1000);
        });
        response = await request(endpoint, token);
    }
    if (response.status === 401 || response.status === 403) {
        throw new FigmaTokenError(
            `${TOKEN_REJECTED} (${response.status} on ${route}): check the token and that its owner can open the file.`
        );
    }
    if (response.status === 429) {
        // The type says which limit hit: `low` (View/Collab seat) needs a Dev or Full seat on the file's plan.
        const type = response.headers.get('x-figma-rate-limit-type') ?? 'unknown';
        const retry = response.headers.get('retry-after');
        const text = `Figma rate limit (429 on ${route}, X-Figma-Rate-Limit-Type: ${type}${retry ? `, retry after ${retry}s` : ''}).`;
        console.warn(`figma-qa: ${text}`);
        throw new Error(text);
    }
    if (!response.ok) {
        throw new Error(`Figma ${route}: ${response.status} ${await response.text()}`);
    }

    return (await response.json()) as T;
}

/** Image URLs point at Figma's CDN, which isn't rate-limited: download in parallel. */
const DOWNLOAD_CONCURRENCY = 8;

export async function download(jobs: { url: string; file: string }[]): Promise<void> {
    let next = 0;
    async function worker() {
        while (next < jobs.length) {
            const job = jobs[next++];
            if (!job) {
                return;
            }
            const response = await fetch(job.url);
            if (!response.ok) {
                throw new Error(`Figma image download ${path.basename(job.file)}: ${response.status}`);
            }
            await writeFile(job.file, Buffer.from(await response.arrayBuffer()));
        }
    }
    await Promise.all(Array.from({ length: DOWNLOAD_CONCURRENCY }, worker));
}
