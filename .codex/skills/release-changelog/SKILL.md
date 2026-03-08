---
name: release-changelog
description: Prepare a PKO Tools release changelog end to end. Use when asked to bump the app version, draft or update release notes, capture changelog screenshots, or package a release entry from recent work. Covers version sync across package.json/Tauri/Cargo, CHANGELOG.md authoring, screenshot capture through the Tauri MCP app, and optional tag/release prep.
---

# Release Changelog

Use this skill for PKO Tools release-note work. The default assumption is local-only changes: do not push, tag, or publish unless the user explicitly asks.

## Files to update

- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`
- `CHANGELOG.md`
- `changelog-assets/` for screenshots referenced by `CHANGELOG.md`

## Version bump workflow

1. Inspect the current top entry in `CHANGELOG.md` and the current versions in the JS/Tauri/Cargo files.
2. Update all version declarations to the same target version.
3. Keep the changelog date in ISO form: `YYYY-MM-DD`.
4. Do not create commits, tags, or push unless explicitly requested.

## Changelog entry format

For a new release entry near the top of `CHANGELOG.md`:

```md
## [0.1.x] - 2026-03-06

### Features

- **Area:** concise summary

### Improvements

- **Area:** concise summary

### Bug Fixes

- **Area:** concise summary
```

Guidelines:

- Prefer short, grouped bullets over file-by-file notes.
- Lead with user-visible features, then improvements, then fixes.
- Reuse existing section style in `CHANGELOG.md`.
- Keep image paths relative, e.g. `![Caption](changelog-assets/example.png)`.

## Screenshot workflow

When the user wants screenshots in patch notes:

1. Prefer the running Tauri app over static file guesses.
2. If the Tauri MCP is available, connect to the app and use it to navigate the relevant workbench.
3. Capture screenshots that show the feature clearly, not just the raw debug state.
4. Copy chosen screenshots into `changelog-assets/` with stable descriptive names.
5. Embed them directly under the relevant changelog bullet or subsection.

For effect-viewer screenshots specifically:

- Prefer `View` mode unless the feature itself is editor-only.
- For skeleton mode, choose one clean hierarchy/inspector example and one more complex proxy-geometry example.
- If render mode is relevant, stop playback first so the screenshot is deterministic.

## Tauri MCP path

If Tauri MCP is available:

1. Check `driver_session` status.
2. If needed, ask the user to launch the app with the MCP-enabled command:
   - `pnpm tauri:dev:mcp`
3. Use DOM snapshots to identify controls before clicking.
4. Save raw captures to `/tmp` first, inspect them, then copy selected images into `changelog-assets/`.

If Tauri MCP is not available:

- Fall back to manual instructions or local screenshots only if the user agrees.

## Validation

After edits:

1. Run `pnpm build`.
2. Review `git diff -- CHANGELOG.md package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml`.
3. Confirm screenshot files exist in `changelog-assets/`.
4. Summarize exactly what changed and whether anything was intentionally left unpushed/unreleased.

## Safety rules

- Preserve unrelated worktree changes.
- Do not rewrite older changelog entries unless the user asks.
- Do not claim a release was published unless tags/pushes actually happened.
- If the app screenshot flow is flaky, say so and keep the release notes accurate rather than inventing coverage.
