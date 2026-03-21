---
name: code-tour
description: >
  IMPORTANT: You MUST invoke this skill BEFORE doing any exploration or research yourself when the
  user says "code tour", "give me a tour", "tour of", "walk me through", "show me how X works",
  "explain the codebase", "guided tour", "teach me about", or asks to understand a service's
  architecture or code structure. Do NOT use the Explore agent or read files yourself — invoke
  this skill first. Interactive educational tour using tmux side pane with nvim.
disable-model-invocation: false
allowed-tools: Bash(echo *), Bash(tmux *), Bash(nvim *), Bash(sleep *), Bash(wc *), Read, Grep, Glob, Task, mcp__atlassian__search, mcp__atlassian__getConfluencePage
---

# Interactive Code Tour

Give an interactive educational tour explaining code by displaying it in a tmux side pane with nvim while walking through explanations.

## Arguments

`$ARGUMENTS` - The topic, service, or code area to tour (e.g., "apm-services-api", "authentication flow", "src/handlers")

## Setup Phase

1. **Verify tmux session**:
   ```bash
   echo "TMUX=$TMUX"
   ```
   If not in tmux, inform the user they need to run from a tmux session.

2. **Confirm you are inside tmux** by checking `$TMUX_PANE` is set (from step 1). No need to capture the window ID — `split-pane.sh` resolves the correct window from `$TMUX_PANE` automatically, so navigating away before the split runs cannot misdirect it.

3. **Find code context** (for Datadog services):
   - Query Atlassian with `mcp__atlassian__search` for documentation about $ARGUMENTS
   - Fetch relevant Confluence pages for architecture context
   - Code locations: `~/dd/` (various repos) or `~/go/src/github.com/DataDog/dd-source` (monorepo)

4. **Formulate a tour plan**: Based on the exploration results and any documentation, design an ordered list of tour stops. Each stop must specify:
   - **file**: absolute path to the file
   - **line**: the line number to navigate to
   - **scroll**: `zt` (show line at top — for function/struct/class starts) or `zz` (center — when context above and below matters)
   - **topic**: a short label for what this stop covers

   The plan should follow a logical narrative arc (e.g., entry point → config → core logic → helpers → integration points). Aim for 5-12 stops.

   Example plan (internal, not shown to user yet):
   ```
   Stop 1: main.go:20 (zt) — entry point, CLI flags
   Stop 2: main.go:102 (zt) — parallel orchestration
   Stop 3: config.go:15 (zt) — Question struct and config loading
   Stop 4: session.go:30 (zt) — launching Claude Code sessions
   Stop 5: driver.go:11 (zt) — driver agent decision logic
   Stop 6: judge.go:12 (zt) — judge scoring
   ```

5. **Pre-read all tour files**: Read ALL unique files that appear in the tour plan using the Read tool. Issue multiple Read calls in parallel where possible (one per file). For large files, read the full file — you need complete contents in context so you already know exact line numbers and can explain any part without delay.

   **CRITICAL**: After this step, every file in your tour plan is in context. During the interactive tour you must NEVER re-read these files. This is the key to low-latency responses once the tour begins.

6. **Generate a unique socket path for this tour session**:

   Each tour needs its own nvim server socket so multiple tours can run concurrently. Construct a unique path yourself using the current Unix timestamp and a random suffix, then echo it as a **literal string** (no subshells):
   ```bash
   echo /tmp/nvim-tour-1739700000-42.sock
   ```
   Do NOT use `$(date)` or `$` — these create subshells that trigger permission prompts. Just embed a literal unique value you generate.

   Store the output as `nvim_sock` in your own context. You will substitute this literal string into ALL subsequent nvim commands. Do NOT rely on shell variables across Bash tool calls — shell state does not persist between calls.

7. **Create side pane with nvim using the server socket** (open the first stop's file).

   Use the **tmux skill** to open a new pane running:
   ```
   bash -c "cd {working_directory} && exec nvim --listen {nvim_sock} {first_stop_file}"
   ```
   The tmux skill handles window targeting, layout, and returns focus to the agent's pane automatically. It will print the new pane ID — store that as `$NVIM_PANE`.

8. **Wait for nvim to be ready**:
   ```bash
   sleep 0.2 && [ -S "{nvim_sock}" ] && echo "nvim ready" || echo "ERROR: nvim failed to start"
   ```
   If nvim doesn't start in time, report the error to the user.

   Use `$NVIM_PANE` as the target for all subsequent pane-directed tmux commands (e.g., `tmux capture-pane -t "$NVIM_PANE"`). No need to list panes or track a pane index.

9. **Enable line numbers in nvim**:
   ```bash
   nvim --server {nvim_sock} --remote-send '<Esc>:set number<CR>'
   ```

## Navigation Pattern

The nvim pane is for the **user** to look at. You should NOT read code through nvim. Instead:
- Use the **Read tool** to read file contents for your own understanding
- Use **nvim `--remote-send`** only to control what the user sees in the pane
- Use **nvim `--remote-expr`** to verify navigation landed correctly (not `tmux capture-pane`)

**Scroll positioning — `zt` vs `zz`**:
- Use `zt` (line at **top** of screen) when jumping to the start of a function, struct, class, type definition, or other top-level declaration. This shows the definition and its body below it.
- Use `zz` (line at **center** of screen) only when the code both above and below the target line is useful context — e.g., a line in the middle of a function where you want the reader to see what comes before and after.

**Navigate within the current file** (jump to a line):
```bash
nvim --server {nvim_sock} --remote-send ':{line_number}<CR>zt'
```

**Open a different file** (and optionally jump to a line):

IMPORTANT: Split file-open and line-jump into two separate `--remote-send` calls chained with `&&`. Combining `:e {file}<CR>:{line}<CR>zt` in one send is unreliable — the line jump can execute before the file loads. Always chain the verify step into the same Bash call using `&&` so that open + jump + verify is a single tool invocation.

```bash
nvim --server {nvim_sock} --remote-send '<Esc>:e {filepath}<CR>' && nvim --server {nvim_sock} --remote-send ':{line_number}<CR>zt' && nvim --server {nvim_sock} --remote-expr 'expand("%:t") .. ":" .. line(".")'
```
This returns e.g. `config.go:45` — confirming the current file and line without dumping screen contents.

**Verify navigation within current file** (when not opening a new file):
```bash
nvim --server {nvim_sock} --remote-send ':{line_number}<CR>zt' && nvim --server {nvim_sock} --remote-expr 'expand("%:t") .. ":" .. line(".")'
```

Replace `zt` with `zz` in the examples above only when the code both above and below the target line is useful context.

**Reading file contents during the tour**: All tour plan files were pre-read in Phase 3, so you already have their contents in context. Default behavior is to avoid re-reading for low latency. However, if the user explicitly asks you to re-read files before each step (e.g., due to compaction/memory concerns), honor that preference and re-read the current stop file before explaining it. Still use Read for files outside the plan as needed.

**IMPORTANT**: In `--remote-send`, use `<CR>` for Enter and `<Esc>` for Escape (nvim key notation), NOT literal Enter keys. These are single direct Bash tool calls — no sub-agents needed.

**Sub-agents are still appropriate for heavy research only**:
- Initial codebase exploration during setup (Task with subagent_type=Explore)
- Researching user-highlighted code selections (Task with subagent_type=Explore)

## Pacing Rules

**ABSOLUTE HARD RULE — NEVER VIOLATE**: This is an INTERACTIVE tour. You MUST:

1. After explaining what's on screen, ALWAYS end your message by asking for confirmation before navigating elsewhere:
   - "Ready to see [next concept]?"
   - "Let me know when you're ready to continue"
   - "Any questions before we move on?"

2. **ONE LOCATION PER MESSAGE**: Each message you send must navigate to AT MOST one new location. After explaining that location, you MUST STOP and wait for user confirmation. Do NOT navigate to a second location in the same message. Do NOT even describe what you plan to show next and then navigate there — just ask if the user is ready.

3. NEVER blast through multiple locations without user confirmation between each.

4. Give the user time to read and absorb the code in the side pane.

5. If you find yourself wanting to say "let me also show you X" or "now let me scroll to Y" in the same message — STOP. Ask first, navigate later.

## Reading User Selections

Users can highlight code in nvim and ask questions about it.

**User workflow**: Select text in visual mode → Ask question (while selection is still active)

**To read the selection** (run directly, not in sub-agent):
```bash
nvim --server {nvim_sock} --remote-expr 'join(getline(min([line("v"), line(".")]), max([line("v"), line(".")])), "\n")'
```

This uses `--remote-expr` to read the active visual selection range. `line("v")` is where visual mode started and `line(".")` is the current cursor position. Using `min/max` handles both forward and reverse selections. Works in all visual modes (`v`, `V`, `<C-v>`).

**Deictic language preference (`this` / `that`)**:
- During a tour, if the user says phrases like "this", "that", "this block", or "what does this do?", assume they mean the currently highlighted visual selection.
- Read the visual selection first using the command above, then answer.
- If no visual selection is active (or the selection is empty), explicitly ask a clarifying question instead of guessing.

**When user asks about a selection**:
1. Read the selection using the command above (including when they refer to "this"/"that")
2. Answer from your existing context — all tour files were pre-read, so you likely already have the code
3. Only use Read (for files not yet in context) or a sub-agent (Task with subagent_type=Explore) if the question requires information entirely outside the pre-read files

## Tour Structure

1. **Overview**: Start with high-level context from documentation
2. **Entry point**: Show main() or equivalent, explain the starting point
3. **Dependencies**: Walk through initialization and dependency injection
4. **Core logic**: Show key handlers, routes, or business logic
5. **Integration points**: Show connections to other services
6. **Q&A**: Let user highlight and ask about specific code

## Example Flow

```
[You] "Let me give you a tour of {service}. First, let me find the documentation..."
[Query Atlassian, explore codebase with sub-agent]

[Formulate tour plan: 7 stops across 5 files]
[Pre-read all 5 files in parallel using Read tool]
[Setup tmux pane with nvim]

[You] "This service does X. Here's the tour plan: ... Looking at the entry point now."
[Navigate nvim to Stop 1 — no Read needed, file already in context]

[You] "Here's main() - it creates the API server with these options: ...
       Ready to see how dependencies are wired up?"

[Wait for user: "yes"]

[Navigate nvim to Stop 2 — no Read needed]
[Explain from context, then ask for confirmation again]

[User highlights something, asks "what does this do?"]
[Read selection with --remote-expr, answer from context]

[User asks about a file NOT in the tour plan]
[Read that new file with Read tool, then answer]
```

## Cleanup

When tour is complete, optionally close nvim and the pane:
```bash
nvim --server {nvim_sock} --remote-send '<Esc>:q<CR>'
```

The tmux pane will close automatically when nvim exits.
Or leave it open for the user to continue exploring.
