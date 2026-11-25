// Terminal questions for `init`, the only command that prompts. Reads the TTY in raw mode, so a hidden answer (a
// token) is never echoed as it's typed.

/** Whether init may ask: both ends are a terminal. Pipes, CI and agent shells get the checklist instead. */
export function interactive(): boolean {
    return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/** Typed or pasted ahead of the question that reads it: a pasted token and its Enter may arrive with the next answer. */
let pending = '';

/** One line from the terminal. Ctrl-C exits 130, as a shell would; Ctrl-D answers empty. */
export function ask(question: string, options: { hidden?: boolean } = {}): Promise<string> {
    const { stdin, stdout } = process;
    // Raw (no echo) before the question shows: an answer typed the moment it appears is never echoed.
    stdin.setRawMode(true);
    stdout.write(question);
    stdin.setEncoding('utf8');
    let answer = '';

    return new Promise((resolve) => {
        const done = (value: string) => {
            stdin.off('data', onData);
            stdin.setRawMode(false);
            stdin.pause();
            stdout.write('\n');
            resolve(value);
        };
        /** Consumes `pending` up to the end of this answer; true once answered. */
        const consume = (): boolean => {
            while (pending.length > 0) {
                const char = pending[0] as string;
                pending = pending.slice(char === '\r' && pending[1] === '\n' ? 2 : 1);
                if (char === '\u0003') {
                    stdin.setRawMode(false);
                    stdout.write('\n');
                    process.exit(130);
                }
                if (char === '\r' || char === '\n' || char === '\u0004') {
                    done(char === '\u0004' ? '' : answer.trim());

                    return true;
                }
                if (char === '\u007f' || char === '\b') {
                    if (answer.length > 0) {
                        answer = answer.slice(0, -1);
                        if (!options.hidden) {
                            stdout.write('\b \b');
                        }
                    }
                } else if (char >= ' ') {
                    answer += char;
                    if (!options.hidden) {
                        stdout.write(char);
                    }
                }
            }

            return false;
        };
        const onData = (chunk: string) => {
            pending += chunk;
            consume();
        };
        if (!consume()) {
            stdin.on('data', onData);
            stdin.resume();
        }
    });
}

/** `[Y/n]`: an empty answer is yes. */
export async function confirm(question: string): Promise<boolean> {
    return !/^n/i.test(await ask(`${question} [Y/n] `));
}
