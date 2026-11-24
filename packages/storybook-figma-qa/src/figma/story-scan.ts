// Which story files `figma-qa report` hands Vitest, read from their source without importing them: collecting a story
// file costs a transform and a browser import, so only files that can hold a Figma story are collected. Filters narrow
// that list; the rules lean towards including a file, and addon-vitest's tag filter still decides per story.

/** What a story file says about itself, read statically. */
export type ScannedFile = {
    file: string;
    /** A `figma` tag literal, or a tag the scan can't read (a variable, a spread): the file might hold Figma stories. */
    figma: boolean;
    /** The meta `title` literal; null for an auto title or a computed one. */
    title: string | null;
    /** The meta `component` identifier. */
    component: string | null;
    /** Story ids from the title and the exported names, as Storybook builds them; null without a title literal. */
    storyIds: string[] | null;
};

/** Positional `report` filters: a filter with `*`, `?` or `--` is a story-id glob, any other a component name. */
export type Filters = { components: string[]; globs: string[] };

/** Stories to run inside the selected files: ids matching `globs`, and every story of `files`. */
export type IdSelection = { globs: string[]; files: string[] };

export type Selection = { files: ScannedFile[]; ids: IdSelection | null };

declare module 'vitest' {
    interface ProvidedContext {
        /** Set only by `figma-qa report` with story-id filters (`STORIES_KEY`). */
        figmaQaStories?: IdSelection | null;
    }
}

/** Storybook's id sanitizer (`storybook/internal/csf` `sanitize`), so static ids equal the ones Storybook assigns. */
export function sanitize(value: string): string {
    return value
        .toLowerCase()
        .replace(/[ ’–—―′¿'`~!@#$%^&*()_|+\-=?;:'",.<>{}[\]\\/]/gi, '-')
        .replace(/-+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '');
}

/** Storybook's `storyNameFromExport` (`toStartCaseStr`): ids are built from it, `NoMatrix` → `No Matrix`. */
export function storyNameFromExport(exportName: string): string {
    return exportName
        .replace(/_/g, ' ')
        .replace(/-/g, ' ')
        .replace(/\./g, ' ')
        .replace(/([^\n])([A-Z])([a-z])/g, (_match, before: string, upper: string, lower: string) => {
            return `${before} ${upper}${lower}`;
        })
        .replace(/([a-z])([A-Z])/g, (_match, lower: string, upper: string) => {
            return `${lower} ${upper}`;
        })
        .replace(/([a-z])([0-9])/gi, (_match, letter: string, digit: string) => {
            return `${letter} ${digit}`;
        })
        .replace(/([0-9])([a-z])/gi, (_match, digit: string, letter: string) => {
            return `${digit} ${letter}`;
        })
        .replace(/(\s|^)(\w)/g, (_match, space: string, first: string) => {
            return `${space}${first.toUpperCase()}`;
        })
        .replace(/ +/g, ' ')
        .trim();
}

const PLAIN_STRING_LITERAL = /^(['"`])([^'"`\\$]*)\1$/;

/** `true` when `tags: …` may hold `figma`: it does, or the value isn't an array of plain string literals. */
function tagsMayHoldFigma(source: string): boolean {
    for (const match of source.matchAll(/\btags\s*:\s*/g)) {
        const rest = source.slice(match.index + match[0].length);
        if (!rest.startsWith('[')) {
            return true;
        }
        const end = rest.indexOf(']');
        const items = (end === -1 ? rest.slice(1) : rest.slice(1, end))
            .split(',')
            .map((item) => {
                return item.trim();
            })
            .filter(Boolean);
        for (const item of items) {
            const literal = PLAIN_STRING_LITERAL.exec(item);
            if (!literal || literal[2] === 'figma') {
                return true;
            }
        }
    }

    return false;
}

export function scanStoryFile(file: string, source: string): ScannedFile {
    const title = /\btitle\s*:\s*(['"`])([^'"`\\$]+)\1/.exec(source)?.[2] ?? null;
    const component = /\bcomponent\s*:\s*([A-Za-z_$][\w$]*)/.exec(source)?.[1] ?? null;
    const exports = [...source.matchAll(/^export\s+const\s+([A-Za-z_$][\w$]*)/gm)].map((match) => {
        return match[1] as string;
    });

    return {
        file,
        figma: tagsMayHoldFigma(source),
        title,
        component,
        storyIds: title
            ? exports.map((name) => {
                  return `${sanitize(title)}--${sanitize(storyNameFromExport(name))}`;
              })
            : null,
    };
}

export function parseFilters(filters: readonly string[]): Filters {
    const parsed: Filters = { components: [], globs: [] };
    for (const filter of filters) {
        (/[*?]|--/.test(filter) ? parsed.globs : parsed.components).push(filter);
    }

    return parsed;
}

/** `*` any run of characters, `?` one; the whole id must match. */
export function globToRegExp(glob: string): RegExp {
    const pattern = glob
        .split('')
        .map((char) => {
            if (char === '*') {
                return '.*';
            }
            if (char === '?') {
                return '.';
            }

            return char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        })
        .join('');

    return new RegExp(`^${pattern}$`, 'i');
}

/** `Swatch.figma.stories.tsx` → `Swatch.figma` and `Swatch`. */
function fileNames(file: string): string[] {
    const base = file.split(/[\\/]/).pop() ?? file;

    return [base.replace(/\.stories\.[^.]+$/, ''), base.split('.')[0] ?? base];
}

/** A component name matches the meta `component`, the title or one of its segments, or the file's name. */
function matchesComponent(scanned: ScannedFile, name: string): boolean {
    const wanted = sanitize(name);
    const candidates = [
        scanned.component,
        scanned.title,
        ...(scanned.title?.split('/') ?? []),
        ...fileNames(scanned.file),
    ];

    return candidates.some((candidate) => {
        return candidate !== null && sanitize(candidate) === wanted;
    });
}

/**
 * Intersects the Figma story files with the filters. A file a component name matches runs whole; an id glob keeps a
 * file whose static ids match or can't be read, and the run then skips its other stories by id.
 */
export function selectStories(scanned: readonly ScannedFile[], filters: Filters): Selection {
    const figma = scanned.filter((file) => {
        return file.figma;
    });
    if (filters.components.length === 0 && filters.globs.length === 0) {
        return { files: figma, ids: null };
    }
    const globs = filters.globs.map(globToRegExp);
    const whole: ScannedFile[] = [];
    const files = figma.filter((file) => {
        const component = filters.components.some((name) => {
            return matchesComponent(file, name);
        });
        if (component) {
            whole.push(file);

            return true;
        }

        return (
            globs.length > 0 &&
            (file.storyIds === null ||
                file.storyIds.some((id) => {
                    return globs.some((glob) => {
                        return glob.test(id);
                    });
                }))
        );
    });
    const ids =
        filters.globs.length > 0
            ? {
                  globs: filters.globs,
                  files: whole.map((file) => {
                      return file.file;
                  }),
              }
            : null;

    return { files, ids };
}
