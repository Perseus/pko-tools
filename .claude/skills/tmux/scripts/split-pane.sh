#!/usr/bin/env bash
# split-pane.sh — Open a new pane using the user's preferred layout rules.
#
# Rules (evaluated against the WINDOW of the calling pane, not the active window):
#   1 pane  → horizontal split (new pane to the right, 50% width)
#   2 panes → vertical split on the calling pane (new pane below, 50% height)
#   3 panes → vertical split on the largest pane in the window (50% height)
#   4+ panes → new window (created in background, focus unchanged)
#
# Focus always returns to the calling pane after creation.
#
# Usage:
#   split-pane.sh [-t <pane-id>] [-n <window-name>] [-- <command> [args...]]
#
# Options:
#   -t, --target   pane ID of the calling pane, e.g. %5  (default: $TMUX_PANE)
#   -n, --name     window name if a new window must be created
#   -h, --help     show this help
#
# Output:
#   Prints the new pane ID to stdout.
#   Prints status info to stderr.

set -euo pipefail

usage() {
  sed -n '/^# Usage:/,/^[^#]/{ /^#/{ s/^# \{0,1\}//; p }; /^[^#]/q }' "$0"
}

target_pane=""
window_name=""
cmd=()
parse_opts=true

while [[ $# -gt 0 ]] && $parse_opts; do
  case "$1" in
    -t|--target) target_pane="${2-}"; shift 2 ;;
    -n|--name)   window_name="${2-}"; shift 2 ;;
    -h|--help)   usage; exit 0 ;;
    --)          parse_opts=false; shift ;;
    -*)          echo "Unknown option: $1" >&2; usage; exit 1 ;;
    *)           cmd+=("$1"); shift ;;
  esac
done
# Remaining args after -- are the command
cmd+=("$@")

# Default to $TMUX_PANE — set by tmux in every pane's environment at creation,
# so it always reflects where the calling process lives, not which pane is
# currently active.
if [[ -z "$target_pane" ]]; then
  if [[ -z "${TMUX_PANE:-}" ]]; then
    echo "Error: -t <pane-id> is required (and \$TMUX_PANE is not set)" >&2
    usage
    exit 1
  fi
  target_pane="$TMUX_PANE"
fi

# ── Resolve calling window (NOT the currently active window) ──────────────────
window_id=$(tmux display-message -p -t "$target_pane" '#{window_id}')
pane_count=$(tmux list-panes -t "$window_id" | wc -l | tr -d ' ')

echo "Window $window_id has $pane_count pane(s)" >&2

# ── Decide split strategy ─────────────────────────────────────────────────────
new_pane=""

if [[ "$pane_count" -eq 1 ]]; then
  # Single pane → horizontal split (side-by-side)
  echo "Strategy: horizontal split on calling pane $target_pane" >&2
  new_pane=$(tmux split-window -h -d -l 50% -t "$target_pane" -P -F '#{pane_id}' "${cmd[@]+"${cmd[@]}"}")

elif [[ "$pane_count" -eq 2 ]]; then
  # Two panes → vertical split on the calling pane
  echo "Strategy: vertical split on calling pane $target_pane" >&2
  new_pane=$(tmux split-window -v -d -l 50% -t "$target_pane" -P -F '#{pane_id}' "${cmd[@]+"${cmd[@]}"}")

elif [[ "$pane_count" -eq 3 ]]; then
  # Three panes → vertical split on the largest pane in the window
  biggest_pane=""
  biggest_area=0
  while IFS=' ' read -r pid pwidth pheight; do
    area=$(( pwidth * pheight ))
    if (( area > biggest_area )); then
      biggest_area=$area
      biggest_pane=$pid
    fi
  done < <(tmux list-panes -t "$window_id" -F '#{pane_id} #{pane_width} #{pane_height}')

  echo "Strategy: vertical split on largest pane $biggest_pane (${biggest_area}px²)" >&2
  new_pane=$(tmux split-window -v -d -l 50% -t "$biggest_pane" -P -F '#{pane_id}' "${cmd[@]+"${cmd[@]}"}")

else
  # 4+ panes → new window, anchored to the calling window's session so
  # navigation away before this runs doesn't affect where it lands
  echo "Strategy: new window (4+ panes in current window)" >&2
  wname="${window_name:-new}"
  new_pane=$(tmux new-window -d -n "$wname" -t "$window_id" -P -F '#{pane_id}' "${cmd[@]+"${cmd[@]}"}")
  echo "Opened new window named '$wname'" >&2
fi

# ── Return focus to the calling pane ─────────────────────────────────────────
tmux select-pane -t "$target_pane"

# ── Report ────────────────────────────────────────────────────────────────────
echo "$new_pane"
