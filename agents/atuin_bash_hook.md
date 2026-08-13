# The atuin Bash hook

What the three `atuin hook claude-code` entries in `~/.claude/settings.json`
are for, why they broke every Bash call in August 2026, and how to fix or
remove them.

## What it does

Atuin is a shell-history database ("magical shell history" — searchable, synced,
SQLite-backed). Normally it records commands **you** type in your shell.

The agent hook extends that to commands run by an AI coding agent, so work done
by Claude Code lands in the same searchable history as your own, tagged with the
agent's name. Without it, everything an agent runs is invisible to `atuin
search` — which, if you use atuin as your record of "what happened on this
machine", is a real gap.

It is configured as three Claude Code hooks, all matching the `Bash` tool:

| Event | What atuin records |
|---|---|
| `PreToolUse` | the command, working directory, timestamp — before it runs |
| `PostToolUse` | exit code and duration — after it succeeds |
| `PostToolUseFailure` | the same, for a command that failed |

Claude Code invokes `atuin hook claude-code` on each of those events and passes
the event as JSON on **stdin**. The hook is pure observation: it records, it
does not gate, rewrite or approve anything.

Installed with `atuin hook install claude-code`, which writes the settings.json
entries for you. Nobody hand-wrote the config here — that command did.

## How it broke

Every `Bash` tool call failed, before running, with:

```
PreToolUse:Bash hook error: [atuin hook claude-code]: error: unrecognized
subcommand 'hook'
```

The cause is a **version mismatch, not a bad config**. The installed binary was
`atuin 18.4.0` (`C:\Users\matth\.cargo\bin\atuin.exe`), which has no `hook`
subcommand at all — `atuin --help` on 18.4.0 lists `history`, `import`,
`stats`, `search`, `sync`, … and no `hook`. Agent hooks arrived in a later
release.

So the settings.json entries were written by a newer atuin (or copied from
newer docs) than the binary on PATH. `PreToolUse` failing is what made it fatal
rather than cosmetic: the hook runs *before* the command, so a non-zero exit
blocks the command entirely. Every Bash call in the session died; PowerShell and
the file tools were unaffected.

Symptom to recognise next time: **all** Bash calls failing identically and
instantly, with the hook name in the error, and nothing else on the machine
broken.

## The fix

Upgrade atuin so the binary has the subcommand its own config asks for:

```sh
cargo install atuin --locked
```

On this machine that hit a second wall — atuin 18.19.0 requires
`rustc >= 1.97.0`, and the active toolchain was 1.94.0. cargo says so plainly
and names the last compatible release:

```
error: cannot install package `atuin 18.19.0`, it requires rustc 1.97.0 or
newer, while the currently active rustc version is 1.94.0
`atuin 18.15.2` supports rustc 1.94.0
```

So the full sequence is:

```sh
rustup update stable-x86_64-pc-windows-msvc   # 1.94.0 -> 1.97.1
cargo install atuin --locked
atuin --version           # expect 18.19.0 or newer
atuin hook claude-code --help   # subcommand must exist
```

**Name the toolchain explicitly.** Plain `rustup update stable` on this machine
resolved to `stable-x86_64-pc-windows-**gnu**` and installed 1.97.1 *there*,
while the active default is `stable-x86_64-pc-windows-**msvc**` — which stayed
on 1.94.0. It exits 0 and looks like it worked; `rustc --version` still reports
the old version afterwards, which is the tell. Two toolchains are installed here
(plus `esp`), so the bare channel name is ambiguous.

Then start a new Claude Code session — settings.json needs no edit, because the
config was never the problem.

## If you would rather not have it

Delete the `hooks` block from `~/.claude/settings.json`. Bash works again
immediately and nothing else changes; you lose only the agent-command capture.
Keep a copy of the block first if you may want it back — or just re-run
`atuin hook install claude-code` on a new enough atuin, which regenerates it.

## Why it is worth keeping

The reason to fix rather than delete: this repo's own
`session-diagnostics-logging` note says the console is the only forensics we
have. Shell history for agent-run commands is the same kind of evidence, for the
same reason — after the fact, "what did it actually run, in which directory, and
what did that return" is a question you can only answer if something recorded
it at the time.

## Sources

- [Atuin — AI Agent Hooks](https://docs.atuin.sh/latest/guide/agent-hooks/)
- [atuin releases](https://github.com/atuinsh/atuin/releases)
