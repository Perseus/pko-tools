# Repository Guidelines

## Project Structure & Module Organization
- `src/` holds the React + TypeScript frontend, organized by feature (`src/features/`), pages (`src/pages/`), shared UI (`src/components/`), and state (`src/store/`).
- `src-tauri/` contains the Rust Tauri backend with domain modules like `character/`, `mesh/`, `animation/`, and `projects/`.
- `public/` stores static assets; generated files land in `exports/` and `imports/` at runtime.
- Path alias `@/` maps to `./src`.

## Build, Test, and Development Commands
- `pnpm install`: install JS dependencies.
- `pnpm tauri dev`: run the desktop app with hot reload (expects port 1420).
- `pnpm dev`: run the Vite web dev server only.
- `pnpm build`: type-check and build the frontend bundle.
- `pnpm tauri build`: build the production desktop app.
- `cd src-tauri && cargo build`: build the Rust backend.
- `cd src-tauri && cargo test`: run Rust tests.
- `cd src-tauri && cargo check`: fast compile check for Rust.

## Coding Style & Naming Conventions
- TypeScript uses 2-space indentation, double quotes, and PascalCase for components (for example `src/components/SideNav/SideNav.tsx`).
- Hooks, atoms, and variables use `camelCase` (for example `currentProjectAtom` in `src/store/`).
- Rust modules follow standard `snake_case` filenames and `CamelCase` types.
- TailwindCSS is the primary styling system; keep class lists readable and grouped by layout/spacing/visual intent.

## Testing Guidelines
- Rust tests live in `#[cfg(test)]` modules within `src-tauri/` sources.
- No frontend test harness is configured; focus on `cargo test` for backend changes and manual UI checks for frontend changes.
- When adding tests, name them descriptively (for example `is_able_to_convert_lab_back_to_gltf`).

## Commit & Pull Request Guidelines
- Commit messages follow a conventional prefix pattern: `feat:`, `fix:`, `chore:`, `build:`, `doc:`, `debug:`, `tauri:`, or similar. Optional scopes appear in parentheses (for example `(fix): ...`).
- PRs should include a clear summary, testing notes (`pnpm tauri dev`, `cargo test`, etc.), and screenshots or screen captures for UI changes.
- Link related issues when applicable and call out any limitations (for example, multi-mesh import gaps).

## Configuration & Asset Notes
- The app reads from a user-selected game client folder and expects `scripts/table/CharacterInfo.txt`.
- Exported glTF files go to `exports/gltf/`; imports are read from `imports/character/`.
