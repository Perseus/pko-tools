#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: code-review.sh [options] [--] <file> [file...]

Open a full-width nvimdiff review pane with one tab per file.

Default diff base behavior (no --range):
  - If any file is uncommitted vs HEAD: diff BASE=HEAD vs working tree
  - If all files are already committed: diff BASE=HEAD^ vs working tree

Options:
  -t, --target <pane>   Calling pane ID (default: $TMUX_PANE)
  -n, --name <name>     New window name when created (default: code-review)
  -r, --range <A..B>    Diff commit range (or A...B). Uses commit-to-commit diff.
  -h, --help            Show help

Notes:
  - If current window has >2 panes, opens a NEW tmux window.
  - If current window has <=2 panes, opens a split pane and forces vertical
    layout so the review pane is full width (top/bottom stack).
USAGE
}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SPLIT_PANE_SH="$SCRIPT_DIR/split-pane.sh"

quote_for_bash() {
  printf "%q" "$1"
}

quote_for_vim_single_string() {
  local s="$1"
  # In Vim single-quoted strings, escape single quote by doubling it.
  s=${s//\'/\'\'}
  printf "%s" "$s"
}

TARGET_PANE="${TMUX_PANE:-}"
WINDOW_NAME="code-review"
RANGE=""
FILES=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -t|--target)
      TARGET_PANE="${2-}"
      shift 2
      ;;
    -n|--name)
      WINDOW_NAME="${2-}"
      shift 2
      ;;
    -r|--range)
      RANGE="${2-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      FILES+=("$@")
      break
      ;;
    -*)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
    *)
      FILES+=("$1")
      shift
      ;;
  esac
done

if [[ -z "$TARGET_PANE" ]]; then
  echo "Error: target pane not provided and TMUX_PANE is not set" >&2
  exit 1
fi

if ! command -v tmux >/dev/null 2>&1; then
  echo "Error: tmux not found in PATH" >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "Error: git not found in PATH" >&2
  exit 1
fi

if ! command -v nvim >/dev/null 2>&1; then
  echo "Error: nvim not found in PATH" >&2
  exit 1
fi

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [[ -z "$REPO_ROOT" ]]; then
  echo "Error: current directory is not inside a git repository" >&2
  exit 1
fi

cd "$REPO_ROOT"

if [[ -n "$RANGE" && ${#FILES[@]} -eq 0 ]]; then
  while IFS= read -r file; do
    [[ -n "$file" ]] && FILES+=("$file")
  done < <(git diff --name-only "$RANGE" --)
fi

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "Error: no files provided. Pass files or use --range <A..B>." >&2
  exit 1
fi

# Deduplicate while preserving order.
UNIQ_FILES=()
for f in "${FILES[@]}"; do
  already_seen=0
  if (( ${#UNIQ_FILES[@]} > 0 )); then
    for existing in "${UNIQ_FILES[@]}"; do
      if [[ "$existing" == "$f" ]]; then
        already_seen=1
        break
      fi
    done
  fi
  if [[ "$already_seen" -eq 0 ]]; then
    UNIQ_FILES+=("$f")
  fi
done
FILES=("${UNIQ_FILES[@]}")

if [[ "${CODE_REVIEW_IN_PANE:-0}" != "1" ]]; then
  WINDOW_ID=$(tmux display-message -p -t "$TARGET_PANE" '#{window_id}')
  PANE_COUNT=$(tmux list-panes -t "$WINDOW_ID" | wc -l | tr -d ' ')

  child_cmd="CODE_REVIEW_IN_PANE=1 $(quote_for_bash "$0") -t $(quote_for_bash "$TARGET_PANE") -n $(quote_for_bash "$WINDOW_NAME")"
  if [[ -n "$RANGE" ]]; then
    child_cmd+=" -r $(quote_for_bash "$RANGE")"
  fi
  child_cmd+=" --"
  for f in "${FILES[@]}"; do
    child_cmd+=" $(quote_for_bash "$f")"
  done

  NEW_PANE=""
  if (( PANE_COUNT > 2 )); then
    echo "Window $WINDOW_ID has $PANE_COUNT panes; opening a new window for review" >&2
    NEW_PANE=$(tmux new-window -d -n "$WINDOW_NAME" -t "$WINDOW_ID" -P -F '#{pane_id}' bash -lc "$child_cmd")
  else
    echo "Window $WINDOW_ID has $PANE_COUNT panes; opening review split pane" >&2
    NEW_PANE=$(bash "$SPLIT_PANE_SH" -t "$TARGET_PANE" -n "$WINDOW_NAME" -- bash -lc "$child_cmd")
    # Force top/bottom layout so review pane has full width.
    tmux select-layout -t "$WINDOW_ID" even-vertical >/dev/null
  fi

  tmux select-pane -t "$TARGET_PANE"
  echo "$NEW_PANE"
  exit 0
fi

TMP_DIR=$(mktemp -d /tmp/code-review-diff.XXXXXX)
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

LEFT_DIR="$TMP_DIR/left"
RIGHT_DIR="$TMP_DIR/right"
mkdir -p "$LEFT_DIR" "$RIGHT_DIR"

LEFT_REV=""
RIGHT_REV=""
MODE="working"

if [[ -n "$RANGE" ]]; then
  if [[ "$RANGE" == *"..."* ]]; then
    LEFT_REV="${RANGE%%...*}"
    RIGHT_REV="${RANGE#*...}"
  elif [[ "$RANGE" == *".."* ]]; then
    LEFT_REV="${RANGE%%..*}"
    RIGHT_REV="${RANGE#*..}"
  else
    echo "Error: --range must be in A..B or A...B format" >&2
    exit 1
  fi

  if [[ -z "$LEFT_REV" || -z "$RIGHT_REV" ]]; then
    echo "Error: invalid --range '$RANGE'" >&2
    exit 1
  fi

  git rev-parse --verify "$LEFT_REV" >/dev/null 2>&1 || {
    echo "Error: left revision not found: $LEFT_REV" >&2
    exit 1
  }
  git rev-parse --verify "$RIGHT_REV" >/dev/null 2>&1 || {
    echo "Error: right revision not found: $RIGHT_REV" >&2
    exit 1
  }

  MODE="range"
else
  ANY_DIRTY=0
  for f in "${FILES[@]}"; do
    if ! git ls-files --error-unmatch -- "$f" >/dev/null 2>&1; then
      ANY_DIRTY=1
      break
    fi
    if ! git diff --quiet HEAD -- "$f"; then
      ANY_DIRTY=1
      break
    fi
  done

  if (( ANY_DIRTY == 1 )); then
    LEFT_REV="HEAD"
  else
    if git rev-parse --verify HEAD^ >/dev/null 2>&1; then
      LEFT_REV="HEAD^"
    else
      LEFT_REV="HEAD"
    fi
  fi
fi

RIGHT_PATHS=()
LEFT_PATHS=()

for f in "${FILES[@]}"; do
  left_path="$LEFT_DIR/$f"
  mkdir -p "$(dirname "$left_path")"

  if [[ "$MODE" == "range" ]]; then
    right_path="$RIGHT_DIR/$f"
    mkdir -p "$(dirname "$right_path")"

    if git cat-file -e "$LEFT_REV:$f" 2>/dev/null; then
      git show "$LEFT_REV:$f" > "$left_path"
    else
      : > "$left_path"
    fi

    if git cat-file -e "$RIGHT_REV:$f" 2>/dev/null; then
      git show "$RIGHT_REV:$f" > "$right_path"
    else
      : > "$right_path"
    fi
  else
    if git cat-file -e "$LEFT_REV:$f" 2>/dev/null; then
      git show "$LEFT_REV:$f" > "$left_path"
    else
      : > "$left_path"
    fi

    if [[ -f "$REPO_ROOT/$f" ]]; then
      right_path="$REPO_ROOT/$f"
    else
      right_path="$RIGHT_DIR/$f"
      mkdir -p "$(dirname "$right_path")"
      if git cat-file -e "HEAD:$f" 2>/dev/null; then
        git show "HEAD:$f" > "$right_path"
      else
        : > "$right_path"
      fi
    fi
  fi

  LEFT_PATHS+=("$left_path")
  RIGHT_PATHS+=("$right_path")
done

if [[ ${#RIGHT_PATHS[@]} -eq 0 ]]; then
  echo "Error: no reviewable files after filtering" >&2
  exit 1
fi

VIM_SCRIPT="$TMP_DIR/open-review.vim"
{
  echo "set diffopt+=vertical"
  for i in "${!RIGHT_PATHS[@]}"; do
    lq=$(quote_for_vim_single_string "${LEFT_PATHS[$i]}")
    rq=$(quote_for_vim_single_string "${RIGHT_PATHS[$i]}")
    if [[ "$i" -eq 0 ]]; then
      printf "execute 'edit ' . fnameescape('%s')\n" "$rq"
      printf "execute 'vert diffsplit ' . fnameescape('%s')\n" "$lq"
    else
      printf "execute 'tabnew ' . fnameescape('%s')\n" "$rq"
      printf "execute 'vert diffsplit ' . fnameescape('%s')\n" "$lq"
    fi
  done
  echo "tabfirst"
  echo "tabdo wincmd ="
} > "$VIM_SCRIPT"

exec nvim -S "$VIM_SCRIPT"
