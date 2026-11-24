// A unified diff of two texts, for `--dry-run` output. Story files are small, so a plain LCS table is enough.

const CONTEXT = 3;

type Line = { kind: ' ' | '-' | '+'; text: string; a: number; b: number };

function lines(text: string): string[] {
    if (text === '') {
        return [];
    }

    return text.replace(/\n$/, '').split('\n');
}

/** Every line of `a` and `b` in order, each kept, removed or added; `a`/`b` are 0-based line numbers. */
function edits(a: string[], b: string[]): Line[] {
    // `common[i][j]`: length of the longest common subsequence of a[i..] and b[j..].
    const common = Array.from({ length: a.length + 1 }, () => {
        return new Array<number>(b.length + 1).fill(0);
    });
    for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
            common[i]![j] =
                a[i] === b[j] ? common[i + 1]![j + 1]! + 1 : Math.max(common[i + 1]![j]!, common[i]![j + 1]!);
        }
    }
    const result: Line[] = [];
    let i = 0;
    let j = 0;
    while (i < a.length || j < b.length) {
        if (i < a.length && j < b.length && a[i] === b[j]) {
            result.push({ kind: ' ', text: a[i]!, a: i++, b: j++ });
        } else if (j < b.length && (i === a.length || common[i]![j + 1]! >= common[i + 1]![j]!)) {
            result.push({ kind: '+', text: b[j]!, a: i, b: j++ });
        } else {
            result.push({ kind: '-', text: a[i]!, a: i++, b: j });
        }
    }

    return result;
}

/** `--- a/<file>` / `+++ b/<file>` and hunks with 3 lines of context; empty when the texts are equal. */
export function unifiedDiff(before: string, after: string, file: string): string {
    const all = edits(lines(before), lines(after));
    const changed = all.flatMap((line, index) => {
        return line.kind === ' ' ? [] : [index];
    });
    if (changed.length === 0) {
        return '';
    }
    // Group changes whose context overlaps into one hunk.
    const hunks: [number, number][] = [];
    for (const index of changed) {
        const start = Math.max(0, index - CONTEXT);
        const end = Math.min(all.length, index + CONTEXT + 1);
        const last = hunks.at(-1);
        if (last && start <= last[1]) {
            last[1] = end;
        } else {
            hunks.push([start, end]);
        }
    }
    const out = [before === '' ? '--- /dev/null' : `--- a/${file}`, `+++ b/${file}`];
    for (const [start, end] of hunks) {
        const slice = all.slice(start, end);
        const aCount = slice.filter((line) => {
            return line.kind !== '+';
        }).length;
        const bCount = slice.filter((line) => {
            return line.kind !== '-';
        }).length;
        const first = slice[0]!;
        // Unified diff numbers lines from 1; an empty side starts at 0.
        const aStart = aCount === 0 ? first.a : first.a + 1;
        const bStart = bCount === 0 ? first.b : first.b + 1;
        out.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@`);
        for (const line of slice) {
            out.push(`${line.kind}${line.text}`);
        }
    }

    return `${out.join('\n')}\n`;
}
