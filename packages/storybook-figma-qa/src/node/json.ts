import { readFile } from 'node:fs/promises';

/** Parsed JSON, or null when the file doesn't exist. Any other read or parse error is thrown. */
export async function readJson<T>(file: string): Promise<T | null> {
    try {
        return JSON.parse(await readFile(file, 'utf8')) as T;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}
