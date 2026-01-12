---
name: tdd
description: Test-Driven Development (TDD) best practices for pko-tools repository. Use this skill when implementing new features, fixing bugs, or refactoring code in either the Rust backend (src-tauri/) or TypeScript/React frontend (src/). Specifically use when (1) adding new functionality that needs tests, (2) writing tests before implementation (red-green-refactor), (3) debugging failing tests, (4) improving test coverage, or (5) setting up test infrastructure.
---

# Test-Driven Development (TDD)

## Overview

This skill provides TDD guidance for the pko-tools repository, covering both the Rust backend (Tauri) and TypeScript/React frontend. It enforces a test-first approach to ensure code quality, maintainability, and correctness in file format conversions (LAB/LGO ↔ glTF) and UI interactions.

## TDD Workflow

Follow the Red-Green-Refactor cycle for all new features and bug fixes:

```
1. RED:    Write a failing test that defines desired behavior
2. GREEN:  Write minimal code to make the test pass
3. REFACTOR: Improve code quality while keeping tests green
4. REPEAT: Continue until feature is complete
```

### When to Write Tests First

**Always write tests first for:**
- New file format parsing/serialization logic
- Data transformation between PKO formats and glTF
- Business logic in commands or state management
- Bug fixes (reproduce the bug with a test first)
- Critical path functionality (export/import, character loading)

**Tests can follow implementation for:**
- UI components with primarily visual behavior (test after for integration)
- Experimental prototypes (add tests when productionizing)
- Simple getters/setters with no logic

## Rust Backend Testing

### Test Organization

The Rust backend uses two test patterns:

1. **Integration tests** in `src-tauri/tests/` for end-to-end workflows
2. **Unit tests** with `#[cfg(test)]` modules inline for isolated logic

```rust
// Integration test: src-tauri/tests/my_feature_test.rs
use pko_tools_lib::character::model::CharacterGeometricModel;

#[test]
fn test_character_roundtrip() {
    // Test full workflow: load → convert → save → verify
}

// Unit test: src-tauri/src/math/mod.rs
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vec3_lerp_at_zero() {
        let a = LwVector3(Vector3::new(0.0, 0.0, 0.0));
        let b = LwVector3(Vector3::new(10.0, 20.0, 30.0));
        let result = a.lerp(&b, 0.0);
        assert!((result.0.x - 0.0).abs() < 0.001);
    }
}
```

### Rust TDD Best Practices

#### 1. Test File Format Parsing with Known-Good Files

```rust
// BAD: Testing with made-up data
#[test]
fn parse_lgo_file() {
    let bytes = vec![0x4C, 0x47, 0x4F, ...]; // Magic numbers
    let lgo: CharacterGeometricModel = parse(bytes)?;
    assert_eq!(lgo.header.version, 1);
}

// GOOD: Testing with real game files
#[test]
fn parse_character_789_lgo() {
    let test_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/known_good/0725000000.lgo");
    
    let mut file = fs::File::open(&test_path)?;
    let lgo: CharacterGeometricModel = file.read_le()?;
    
    assert_eq!(lgo.header.bone_index_num, 23);
    assert_eq!(lgo.mesh_info.unwrap().vertex_seq.len(), 1024);
}
```

Store test fixtures in `src-tauri/tests/fixtures/known_good/` or `src-tauri/test_artifacts/`.

#### 2. Test Round-Trip Conversions

Critical for file format tools: ensure data survives conversion cycles.

```rust
#[test]
fn roundtrip_lab_file_preserves_bone_hierarchy() {
    // 1. Load original LAB file
    let original_lab = load_lab("tests/fixtures/0000.lab")?;
    
    // 2. Export to glTF
    let gltf_doc = original_lab.to_gltf()?;
    
    // 3. Import glTF back to LAB
    let new_lab = LwBoneFile::from_gltf(&gltf_doc, &buffers, &images)?;
    
    // 4. Verify critical properties preserved
    assert_eq!(original_lab.base_seq.len(), new_lab.base_seq.len());
    
    for (orig, new) in original_lab.base_seq.iter().zip(&new_lab.base_seq) {
        assert_eq!(orig.name, new.name);
        assert_eq!(orig.parent_id, new.parent_id);
        assert_matrix_approx_eq(&orig.matrix, &new.matrix);
    }
    
    // 5. Byte-level comparison (ideal but not always achievable)
    // assert_eq!(original_bytes, new_bytes);
}
```

See `src-tauri/tests/roundtrip_test.rs` for examples.

#### 3. Test Boundary Conditions and Invariants

```rust
#[test]
fn bone_indices_must_be_in_bounds() {
    let lab = load_lab("tests/fixtures/0000.lab")?;
    let lgo = load_lgo("tests/fixtures/0000000000.lgo")?;
    
    let mesh = lgo.mesh_info.unwrap();
    
    // All bone_index_seq values must reference valid LAB bones
    for (idx, &bone_ref) in mesh.bone_index_seq.iter().enumerate() {
        assert!(
            bone_ref < lab.base_seq.len() as u32,
            "bone_index_seq[{}] = {} but LAB only has {} bones",
            idx, bone_ref, lab.base_seq.len()
        );
    }
}

#[test]
fn bone_weights_sum_to_one() {
    let lgo = load_lgo("tests/fixtures/0000000000.lgo")?;
    let mesh = lgo.mesh_info.unwrap();
    
    for (vertex_idx, blend) in mesh.blend_seq.iter().enumerate() {
        let sum: f32 = blend.weight.iter().sum();
        
        assert!(
            (sum - 1.0).abs() < 0.01,
            "Vertex {} weights sum to {} (expected ~1.0)",
            vertex_idx, sum
        );
    }
}
```

See `src-tauri/tests/skinning_tests.rs` for more examples.

#### 4. Use Descriptive Test Names

```rust
// BAD
#[test]
fn test1() { ... }

#[test]
fn test_character() { ... }

// GOOD
#[test]
fn bone_index_seq_values_are_in_bounds() { ... }

#[test]
fn roundtrip_preserves_vertex_count() { ... }

#[test]
fn parse_fails_on_invalid_magic_number() { ... }
```

#### 5. Test Error Paths

```rust
#[test]
#[should_panic(expected = "Invalid magic number")]
fn parse_rejects_non_lgo_file() {
    let mut cursor = std::io::Cursor::new(vec![0xFF, 0xFF, 0xFF, 0xFF]);
    let _: CharacterGeometricModel = cursor.read_le().unwrap();
}

#[test]
fn from_gltf_returns_error_for_missing_skin() {
    let gltf_doc = create_gltf_without_skin();
    let result = LwBoneFile::from_gltf(&gltf_doc, &[], &[]);
    
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("No skin found"));
}
```

#### 6. Use Test Helpers and Common Modules

Extract shared test utilities to `src-tauri/tests/common/mod.rs`:

```rust
// src-tauri/tests/common/mod.rs
pub fn load_test_lab(filename: &str) -> LwBoneFile {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/known_good")
        .join(filename);
    
    let mut file = fs::File::open(&path).expect("Test fixture not found");
    file.read_le().expect("Failed to parse test fixture")
}

// src-tauri/tests/my_test.rs
#[path = "common/mod.rs"]
mod common;

#[test]
fn my_test() {
    let lab = common::load_test_lab("0000.lab");
    // ...
}
```

### Running Rust Tests

```bash
# Run all tests
cd src-tauri && cargo test

# Run specific test
cargo test bone_indices_must_be_in_bounds

# Run tests with output
cargo test -- --nocapture

# Run tests in a specific file
cargo test --test roundtrip_test
```

## Frontend Testing (Future)

Currently, the frontend has no test harness configured. When adding tests:

### Recommended Setup

1. **Unit/Component Testing**: Vitest + React Testing Library
2. **E2E Testing**: Playwright or Cypress (for Tauri app testing)

```bash
pnpm add -D vitest @testing-library/react @testing-library/jest-dom jsdom
```

### Frontend TDD Guidelines

#### 1. Test Component Behavior, Not Implementation

```typescript
// BAD: Testing implementation details
test('CharacterList sets state on mount', () => {
  const wrapper = mount(<CharacterList />);
  expect(wrapper.state('loading')).toBe(true);
});

// GOOD: Testing user-visible behavior
test('CharacterList shows loading spinner initially', () => {
  render(<CharacterList />);
  expect(screen.getByRole('status')).toBeInTheDocument();
});

test('CharacterList displays characters after loading', async () => {
  render(<CharacterList />);
  
  await waitFor(() => {
    expect(screen.getByText('Character 789')).toBeInTheDocument();
  });
});
```

#### 2. Test Jotai Atoms in Isolation

```typescript
// src/store/project.test.ts
import { describe, it, expect } from 'vitest';
import { createStore } from 'jotai';
import { currentProjectAtom, projectCharactersAtom } from './project';

describe('currentProjectAtom', () => {
  it('starts as null', () => {
    const store = createStore();
    expect(store.get(currentProjectAtom)).toBeNull();
  });
  
  it('can be set to a project', () => {
    const store = createStore();
    const project = { id: '123', name: 'Test Project' };
    
    store.set(currentProjectAtom, project);
    
    expect(store.get(currentProjectAtom)).toEqual(project);
  });
});
```

#### 3. Mock Tauri Commands

```typescript
// src/commands/__mocks__/character.ts
import { vi } from 'vitest';

export const listCharacters = vi.fn().mockResolvedValue([
  { id: '0000', name: 'Test Character', parts: [] },
]);

// src/features/characters/CharacterList.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import CharacterList from './CharacterList';

vi.mock('@/commands/character');

test('loads and displays characters', async () => {
  render(<CharacterList />);
  
  await waitFor(() => {
    expect(screen.getByText('Test Character')).toBeInTheDocument();
  });
});
```

#### 4. Test Three.js/R3F Components Carefully

For 3D viewer components using `@react-three/fiber`:

```typescript
// Option 1: Mock the Canvas
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: any) => <div data-testid="canvas">{children}</div>,
  useFrame: vi.fn(),
  useThree: () => ({ camera: {}, scene: {} }),
}));

// Option 2: Test logic separately from rendering
// Extract mesh/bone logic to pure functions, test those
describe('createBoneHelpers', () => {
  it('creates helper for each bone', () => {
    const bones = [{ name: 'Root' }, { name: 'Spine' }];
    const helpers = createBoneHelpers(bones);
    
    expect(helpers).toHaveLength(2);
  });
});
```

#### 5. Test User Interactions

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

test('exporting character shows progress toast', async () => {
  const user = userEvent.setup();
  render(<CharacterExporter characterId="0000" />);
  
  // Click export button
  await user.click(screen.getByRole('button', { name: /export/i }));
  
  // Toast appears
  expect(screen.getByText(/exporting/i)).toBeInTheDocument();
  
  // Success message after completion
  await waitFor(() => {
    expect(screen.getByText(/export complete/i)).toBeInTheDocument();
  });
});
```

## Test Fixtures and Artifacts

### Organizing Test Files

```
src-tauri/
├── tests/
│   ├── fixtures/
│   │   └── known_good/          # Real game files for testing
│   │       ├── 0000.lab
│   │       ├── 0000000000.lgo
│   │       ├── 0725.lab
│   │       └── 0725000000.lgo
│   ├── test_artifacts/          # Generated test outputs
│   │   ├── test.gltf
│   │   └── test.lab
│   ├── common/
│   │   └── mod.rs               # Shared test utilities
│   ├── roundtrip_test.rs
│   └── skinning_tests.rs
└── src/
    └── character/
        └── model.rs             # Contains #[cfg(test)] inline tests
```

### Adding Test Fixtures

When adding new test files:

1. Use real game files from `scripts/table/CharacterInfo.txt`
2. Pick diverse examples (simple, complex, edge cases)
3. Document what makes each fixture interesting

```rust
// In test file
/// Tests character 789 (0725.lab / 0725000000.lgo)
/// This character is interesting because:
/// - Has 23 bones (moderate complexity)
/// - Uses blend weights (skinned mesh)
/// - Known working in-game (gold standard)
#[test]
fn parse_character_789() { ... }
```

## Continuous Testing Workflow

### Local Development

```bash
# Terminal 1: Frontend dev server with hot reload
pnpm dev

# Terminal 2: Backend with hot reload
pnpm tauri dev

# Terminal 3: Watch mode for Rust tests
cd src-tauri && cargo watch -x test
```

### Before Committing

```bash
# Run all tests
cd src-tauri && cargo test
# (Future: pnpm test for frontend)

# Type check
pnpm build

# Format check
cd src-tauri && cargo fmt --check
```

## Common Patterns

### Testing Tauri Commands

```rust
// src-tauri/src/character/commands.rs
#[tauri::command]
pub async fn load_character(id: String) -> Result<Character, String> {
    // ... implementation
}

// Inline test (for business logic, not IPC)
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_character_returns_error_for_invalid_id() {
        // Test the function directly, not via Tauri IPC
        let result = load_character_internal("invalid_id");
        assert!(result.is_err());
    }
}
```

Extract testable logic from Tauri commands when possible:

```rust
// Testable pure function
fn validate_character_id(id: &str) -> Result<u32, String> {
    id.parse::<u32>()
        .map_err(|_| format!("Invalid character ID: {}", id))
}

// Tauri command (thin wrapper)
#[tauri::command]
pub async fn load_character(id: String) -> Result<Character, String> {
    let id_num = validate_character_id(&id)?;
    load_character_internal(id_num).await
}

#[cfg(test)]
mod tests {
    #[test]
    fn validate_character_id_accepts_numeric_strings() {
        assert_eq!(validate_character_id("0000").unwrap(), 0);
        assert_eq!(validate_character_id("123").unwrap(), 123);
    }
    
    #[test]
    fn validate_character_id_rejects_non_numeric() {
        assert!(validate_character_id("abc").is_err());
    }
}
```

### Testing Binary Parsing (binrw)

```rust
use binrw::{BinRead, BinWrite};
use std::io::Cursor;

#[test]
fn parse_and_serialize_lgo_header() {
    let original_bytes = include_bytes!("../tests/fixtures/known_good/0000000000.lgo");
    
    // Parse
    let mut cursor = Cursor::new(original_bytes);
    let lgo: CharacterGeometricModel = cursor.read_le().unwrap();
    
    // Serialize
    let mut output = Cursor::new(Vec::new());
    lgo.write_le(&mut output).unwrap();
    
    // Compare (at least header)
    let output_bytes = output.into_inner();
    assert_eq!(&original_bytes[..100], &output_bytes[..100]);
}
```

### Testing Math Functions

```rust
#[cfg(test)]
mod tests {
    use super::*;
    
    // Use small epsilon for floating point comparison
    const EPSILON: f32 = 0.001;
    
    fn assert_vec3_eq(a: &LwVector3, b: &LwVector3) {
        assert!((a.0.x - b.0.x).abs() < EPSILON);
        assert!((a.0.y - b.0.y).abs() < EPSILON);
        assert!((a.0.z - b.0.z).abs() < EPSILON);
    }
    
    #[test]
    fn matrix_multiplication_is_associative() {
        let a = Matrix4::from_scale(2.0);
        let b = Matrix4::from_angle_x(Rad(1.0));
        let c = Matrix4::from_translation(Vector3::new(1.0, 2.0, 3.0));
        
        let ab_c = (a * b) * c;
        let a_bc = a * (b * c);
        
        assert_matrix_eq(&ab_c, &a_bc);
    }
}
```

## Coverage Goals

While not enforced, aim for:

- **Critical path**: 100% (file parsing, serialization, round-trips)
- **Business logic**: 80%+ (commands, transformations)
- **UI components**: 60%+ (when test harness is added)

Use coverage tools:

```bash
# Rust coverage (requires tarpaulin)
cargo install cargo-tarpaulin
cargo tarpaulin --out Html

# View coverage report
open tarpaulin-report.html
```

## Debugging Test Failures

### Print Detailed Output

```rust
#[test]
fn debug_bone_hierarchy() {
    let lab = load_lab("0000.lab").unwrap();
    
    println!("\n🦴 Bone Hierarchy:");
    for (i, bone) in lab.base_seq.iter().enumerate() {
        println!("  [{:2}] id={:2} parent={:2} name='{}'",
                 i, bone.id, bone.parent_id, bone.name);
    }
    
    // Run with: cargo test debug_bone_hierarchy -- --nocapture
}
```

### Compare Byte Diffs

```rust
fn print_byte_diff(original: &[u8], new: &[u8], context: usize) {
    for (i, (o, n)) in original.iter().zip(new).enumerate() {
        if o != n {
            let start = i.saturating_sub(context);
            let end = (i + context).min(original.len());
            
            println!("Difference at offset 0x{:X} ({}):", i, i);
            println!("  Original: {:02X?}", &original[start..end]);
            println!("  New:      {:02X?}", &new[start..end]);
            return;
        }
    }
}
```

### Visualize Test Artifacts

When debugging glTF exports, open generated files in a viewer:

```bash
# Generated test files are in:
ls src-tauri/test_artifacts/

# View in Blender, Three.js editor, or:
npx gltf-viewer src-tauri/test_artifacts/test.gltf
```

## Anti-Patterns to Avoid

### ❌ Testing Private Implementation Details

```rust
// BAD: Relying on internal state
#[test]
fn parser_sets_internal_offset() {
    let parser = Parser::new();
    parser.parse_header();
    assert_eq!(parser.offset, 64); // Fragile!
}
```

### ❌ Testing Multiple Things in One Test

```rust
// BAD: Test explosion (which assertion failed?)
#[test]
fn test_everything() {
    let lab = load_lab("0000.lab").unwrap();
    assert_eq!(lab.header.bone_num, 23);
    assert_eq!(lab.base_seq.len(), 23);
    assert_eq!(lab.base_seq[0].name, "Root");
    assert!(lab.invmat_seq.len() > 0);
    // 50 more assertions...
}

// GOOD: Focused tests
#[test]
fn lab_header_bone_num_matches_base_seq_length() {
    let lab = load_lab("0000.lab").unwrap();
    assert_eq!(lab.header.bone_num as usize, lab.base_seq.len());
}

#[test]
fn lab_first_bone_is_root() {
    let lab = load_lab("0000.lab").unwrap();
    assert_eq!(lab.base_seq[0].name, "Root");
}
```

### ❌ Flaky Tests with Random Data

```rust
// BAD: Non-deterministic
#[test]
fn test_transform_matrix() {
    let random_matrix = generate_random_matrix(); // Different every run!
    let result = transform(random_matrix);
    assert!(result.is_valid());
}

// GOOD: Fixed test cases
#[test]
fn transform_identity_matrix_returns_identity() {
    let identity = Matrix4::identity();
    let result = transform(identity);
    assert_matrix_eq(&result, &identity);
}
```

### ❌ Tests That Depend on External State

```rust
// BAD: Tests that modify shared state
static mut COUNTER: u32 = 0;

#[test]
fn test_a() {
    unsafe { COUNTER += 1; }
    assert_eq!(unsafe { COUNTER }, 1); // Fails if test_b runs first!
}

// GOOD: Isolated tests
#[test]
fn test_a() {
    let mut counter = 0;
    counter += 1;
    assert_eq!(counter, 1);
}
```

## Resources

### Internal References

- See `src-tauri/tests/roundtrip_test.rs` for round-trip conversion examples
- See `src-tauri/tests/skinning_tests.rs` for invariant testing examples
- See inline tests in `src-tauri/src/math/mod.rs` for unit test patterns

### External Resources

- [Rust Testing Documentation](https://doc.rust-lang.org/book/ch11-00-testing.html)
- [binrw Testing Guide](https://docs.rs/binrw/latest/binrw/#testing)
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [Vitest Documentation](https://vitest.dev/guide/)
- [cargo-tarpaulin (Coverage Tool)](https://github.com/xd009642/tarpaulin)
