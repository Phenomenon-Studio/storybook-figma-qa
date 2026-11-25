# Runs a command in a pseudo-terminal and answers its prompts as a person would: argv[1] is JSON
# `[[prompt, answer], ...]`, the rest is the command. Each answer is typed (with Enter) once its prompt text appears,
# in order. Prints everything the terminal showed, then exits with the command's code. `script` can't do this: fed a
# file, it sends the input and EOF before the first prompt.
import json
import os
import pty
import select
import sys

answers = json.loads(sys.argv[1])
pid, fd = pty.fork()
if pid == 0:
    os.execvp(sys.argv[2], sys.argv[2:])

shown = b''
cursor = 0
while True:
    ready, _, _ = select.select([fd], [], [], 120)
    if not ready:
        break
    try:
        chunk = os.read(fd, 4096)
    except OSError:
        break
    if not chunk:
        break
    shown += chunk
    while answers and answers[0][0].encode() in shown[cursor:]:
        prompt, answer = answers.pop(0)
        cursor = shown.index(prompt.encode(), cursor) + len(prompt)
        os.write(fd, (answer + '\r').encode())

sys.stdout.write(shown.decode(errors='replace'))
_, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status))
