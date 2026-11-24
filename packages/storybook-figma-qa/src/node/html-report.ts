// Writes the HTML report directory for a run: index.html rendered from the results model with the same components
// as the Storybook panel, plus a copy of every image it shows, so the directory stands alone (opened from disk, or
// uploaded as one CI artifact).
import type { FigmaRunSummary, FigmaStoryResult } from '../figma/types.ts';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { REPORT_DIR } from '../figma/types.ts';
import { ReportPage } from '../ui/report-page.tsx';

/** Where a project file lands in the report: `files/<project path>`, `..` segments renamed so nothing escapes. */
function reportPath(projectPath: string): string {
    const segments = path.posix
        .normalize(projectPath.replaceAll('\\', '/'))
        .split('/')
        .map((segment) => {
            return segment === '..' ? '_up' : segment;
        });

    return ['files', ...segments].join('/');
}

export async function writeHtmlReport(
    root: string,
    run: FigmaRunSummary,
    results: readonly FigmaStoryResult[]
): Promise<string> {
    const dir = path.join(root, REPORT_DIR);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    const files = new Set<string>();
    for (const result of results) {
        for (const block of result.blocks) {
            for (const { files: cell } of block.cells) {
                for (const file of [cell.figma, cell.actual, cell.diff]) {
                    if (file) {
                        files.add(file);
                    }
                }
            }
        }
    }
    await Promise.all(
        [...files].map(async (file) => {
            const target = path.join(dir, reportPath(file));
            await mkdir(path.dirname(target), { recursive: true });
            await copyFile(path.join(root, file), target);
        })
    );
    const html = renderToStaticMarkup(
        createElement(ReportPage, {
            run,
            results: [...results],
            fileUrl: (file: string) => {
                return encodeURI(reportPath(file));
            },
        })
    );
    const index = path.join(dir, 'index.html');
    await writeFile(index, `<!doctype html>\n${html}\n`);

    return index;
}
