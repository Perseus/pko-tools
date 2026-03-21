---
name: tmux
description: >
  ALWAYS load this skill before performing ANY tmux operation — including opening panes, splitting windows,
  running commands in panes, sending keystrokes, or checking pane output. Do NOT improvise tmux pane layout
  logic inline; all pane creation must go through scripts/split-pane.sh as documented here. Failing to load
  this skill first will produce incorrect window targeting and unwanted focus shifts.
triggers:
  - tmux
  - pane
  - split
  - open a terminal
  - open a window
  - run in background
  - side by side
  - new pane
  - new window
---

# tmux Skill

Use tmux to run interactive programs (REPLs, debuggers, servers) that can't work as one-shot bash commands.

---

## Opening a new pane — always use split-pane.sh

Call `split-pane.sh` directly — no need to capture the calling pane first. The script defaults `-t` to `$TMUX_PANE`, which tmux injects into every pane's environment at creation. This is always the pane where the agent process is running, regardless of which pane the user has focused since.

```bash
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NEW_PANE=$(bash "$SKILL_DIR/scripts/split-pane.sh" \
  -n "window-name" \
  -- btop)
```

The script prints the new pane ID to stdout and status info to stderr. It always returns focus to the calling pane.

### Layout rules (encoded in split-pane.sh — do not re-implement inline)

| Panes in window | Action |
|---|---|
| 1 | Horizontal split on calling pane (new pane right, 50% width) |
| 2 | Vertical split on **calling pane** (new pane below, 50% height) |
| 3 | Vertical split on **largest pane** in the window (50% height) |
| 4+ | New tmux window (background, focus untouched) |

**Critical rules:**
- The window is always derived from the **calling pane's window ID**, never from the currently active window. This is safe even if the user navigated away before the command ran.
- `-d` flag is always used on splits/new-window so focus never jumps to the new pane.
- Focus is explicitly returned to `$CALLING_PANE` at the end of the script.

### Running a command in the new pane

Pass it after `--`:

```bash
NEW_PANE=$(bash "$SKILL_DIR/scripts/split-pane.sh" -n "server" -- npm run dev)
```

Or send keys manually after creation:

```bash
NEW_PANE=$(bash "$SKILL_DIR/scripts/split-pane.sh")
tmux send-keys -t "$NEW_PANE" -l -- 'PYTHON_BASIC_REPL=1 python3 -q'
tmux send-keys -t "$NEW_PANE" Enter
```

### Telling the user where things ended up

Always report what happened:
- Pane split: `"Started <program> in a new pane (below/right). Your cursor stayed in place."`
- New window: `"Opened <program> in a new tmux window named '<name>'. Navigate with prefix+n or prefix+w."`

---

## Targeting panes

Format: `{session}:{window}.{pane}` — pane ID (`%N`) is most reliable.

```bash
# Capture the new pane's ID after a split
NEW_PANE=$(tmux display-message -p -t '{last}' '#{pane_id}')
```

---

## Sending input safely

```bash
# Literal send (avoids shell word-splitting)
tmux send-keys -t "$TARGET" -l -- "some command with spaces"
tmux send-keys -t "$TARGET" Enter

# Control keys
tmux send-keys -t "$TARGET" C-c
tmux send-keys -t "$TARGET" C-d
tmux send-keys -t "$TARGET" Escape

# ANSI C quoting for inline escapes
tmux send-keys -t "$TARGET" -- $'python3 -q' Enter
```

**Special cases:**
- **Python REPL**: always set `PYTHON_BASIC_REPL=1` (the fancy console breaks send-keys).
- **Debugger**: use `lldb` by default.

---

## Watching output

```bash
# Capture recent history
tmux capture-pane -p -J -t "$TARGET" -S -200

# Poll for expected output
./scripts/wait-for-text.sh -t "$TARGET" -p '^>>>' -T 15 -l 4000
```

---

## Cleanup

```bash
tmux kill-pane   -t "$TARGET"           # kill a pane
tmux kill-window -t "$WINDOW"           # kill a window
```

After a task is done, offer to clean up panes/windows you created.

---

## Code review diffs (nvimdiff)

Use `scripts/code-review.sh` for multi-file code reviews instead of hand-building tmux+nvim commands.

```bash
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Diff selected files:
# - against HEAD if any file is uncommitted
# - otherwise against HEAD^
bash "$SKILL_DIR/scripts/code-review.sh" -- src/index.ts src/extensions/loader.ts

# Diff explicit commit range (commit-to-commit snapshots)
bash "$SKILL_DIR/scripts/code-review.sh" --range HEAD^..HEAD -- src/index.ts
```

Layout behavior in the **calling window**:
- If pane count is `<=2`: opens a review split and forces **vertical stack** (`even-vertical`) so the nvimdiff pane uses full width.
- If pane count is `>2`: opens a **new tmux window** for the review.

---

## Helper scripts

### scripts/split-pane.sh <- primary entry point for pane creation
```
split-pane.sh [-t <pane-id>] [-n <window-name>] [-- <command> [args...]]
```
- `-t` calling pane ID (default: `$TMUX_PANE` -- the pane where the agent process is running)
- `-n` window name if a new window is opened
- `--` separator before the command to run in the new pane
- Outputs new pane ID to stdout

### scripts/wait-for-text.sh
```
wait-for-text.sh -t <target> -p <pattern> [-F] [-T 20] [-i 0.5] [-l 2000]
```
- `-t` target pane (required)
- `-p` regex pattern (required); `-F` for fixed string
- `-T` timeout seconds (default 15)
- `-i` poll interval (default 0.5)
- `-l` history lines to search (default 1000)
- Exits 0 on match, 1 on timeout

### scripts/find-sessions.sh
```
find-sessions.sh [-L socket-name | -S socket-path | -A] [-q pattern]
```
- `-A` scans all agent sockets
- `-q` filters by session name substring

### scripts/code-review.sh
```
code-review.sh [-t <pane-id>] [-n <window-name>] [--range <A..B|A...B>] [--] <file> [file...]
```
- Opens nvimdiff with one tab per file.
- Without `--range`, auto-selects left side:
  - `HEAD` if any file is uncommitted
  - `HEAD^` if all files are already committed
- With `--range`, diffs commit-to-commit snapshots (`A` vs `B`).
- If current window has more than 2 panes, opens a new tmux window.
- If current window has 2 or fewer panes, opens split and enforces vertical stack for full-width review pane.
