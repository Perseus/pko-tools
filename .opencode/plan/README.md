# Bone Hierarchy Fix: Complete Implementation Plan

This directory contains comprehensive documentation for fixing the bone hierarchy issues in the glTF ↔ LAB/LGO conversion pipeline.

## 📚 Documentation Index

### 1. [Bug Analysis & Fix Plan](./BONE_HIERARCHY_FIX_PLAN.md)

**Purpose:** Understand what's broken and how to fix it.

**Contents:**
- **Executive Summary** - The core problem explained
- **How The Game Engine Works** - Analysis of actual game source code showing what's expected
- **5 Critical Bugs Identified** - Detailed breakdown of each bug with:
  - Current buggy code
  - What's wrong and why
  - Example failure scenarios
  - The exact fix with code
- **Detailed Fix Plan** - 8 implementation phases with precise code changes
- **Implementation Order** - Which changes to make in what sequence

**Read this first** to understand the problem space.

---

### 2. [Testing Strategy](./TESTING_STRATEGY.md)

**Purpose:** Verify fixes work correctly without access to game client.

**Contents:**
- **Testing Philosophy** - Fast feedback, high confidence, fully automated
- **Testing Pyramid** - 5 layers from fast unit tests to visual validation
- **Layer 1: Unit Tests** - Fast invariant checks (< 100ms)
- **Layer 2: Property-Based Testing** - Auto-generate 1000+ test cases to find edge cases
- **Layer 3: Snapshot Testing** - Binary comparison with known-good files
- **Layer 4: Visual Validation** - Alternatives to running game client:
  - Export to glTF viewers
  - Mathematical simulation
  - Round-trip testing
- **Test Organization** - File structure, fixtures, CI/CD integration
- **Practical Examples** - Copy-paste ready test code

**Read this second** to understand how to validate your fixes.

---

## 🎯 Quick Start Guide

### If You Want To...

#### **Understand the problem:**
→ Read [BONE_HIERARCHY_FIX_PLAN.md](./BONE_HIERARCHY_FIX_PLAN.md) sections:
- Executive Summary
- How The Game Engine Works
- Critical Bugs Identified

#### **Implement the fixes:**
→ Read [BONE_HIERARCHY_FIX_PLAN.md](./BONE_HIERARCHY_FIX_PLAN.md) sections:
- Detailed Fix Plan (8 phases)
- Implementation Plan (order of changes)

#### **Set up testing:**
→ Read [TESTING_STRATEGY.md](./TESTING_STRATEGY.md) sections:
- Layer 1: Unit Tests (must have)
- Layer 3: Snapshot Testing (must have)
- Test Organization

#### **Verify correctness:**
→ Read [TESTING_STRATEGY.md](./TESTING_STRATEGY.md) sections:
- Layer 2: Property-Based Testing
- Layer 4: Visual Validation
- Validation Criteria (from fix plan)

---

## 📋 Implementation Workflow

### Phase 1: Planning (You Are Here)
- ✅ Understand the bugs
- ✅ Review fix plan
- ✅ Review testing strategy
- ⏳ Answer clarifying questions (see below)

### Phase 2: Setup Testing Infrastructure
**Estimated time:** 2-4 hours

1. Create test directory structure (see Testing Strategy)
2. Copy known-good LAB/LGO files to `tests/fixtures/known_good/`
3. Implement core unit tests (index space, hierarchy consistency)
4. Set up snapshot test framework
5. Verify tests run and fail appropriately

**Why do this first?** Tests act as a safety net while implementing fixes.

### Phase 3: Implement Fixes
**Estimated time:** 4-8 hours

Follow the 8-phase plan in order:
1. Add `original_node_index` field
2. Switch to `skin.joints()` as source
3. Fix parent ID assignment
4. Fix parent remap after reordering
5. Fix inverse bind matrix assignment
6. Pass LAB data to mesh import
7. Fix `bone_index_seq` calculation
8. Remove duplicate code

After each phase:
- Run unit tests
- Run snapshot tests
- Fix any failures before continuing

### Phase 4: Validation
**Estimated time:** 2-4 hours

1. Run full test suite
2. Test with real character files
3. Export to glTF and inspect in viewer
4. Run property-based tests with high iteration count
5. Compare with known-good files

### Phase 5: Documentation & PR
**Estimated time:** 1-2 hours

1. Update AGENTS.md if needed
2. Add inline code comments explaining fixes
3. Create PR with detailed description
4. Link to this plan in PR description

---

## 🤔 Outstanding Questions

Before implementation, please clarify:

### 1. Dummy Bones
**Question:** Should dummy nodes be in `_base_seq` or kept separate in `_dummy_seq`?

**Current behavior:** They're kept separate

**Recommendation:** Keep separate (current behavior is correct per game engine)

---

### 2. Multiple Skins
**Question:** Should we support multiple skins per glTF file?

**Options:**
- A) Assume one skin per character (simplest)
- B) Support multiple, take first one
- C) Full multi-skin support

**Recommendation:** Option B - support multiple but use first one, with warning if multiple exist

---

### 3. Root Bones
**Question:** Can there be multiple root bones, or always exactly one?

**Current code:** Allows multiple roots

**Need to verify:** Does the game support multiple root bones?

---

### 4. Bone Matching
**Question:** When matching bones between glTF and LAB, use:
- A) Node names (current approach)
- B) Node indices
- C) Both (validate name matches index)

**Recommendation:** Option C - use indices primarily, validate names match for debugging

---

### 5. Known-Good Files
**Questions:**
- How many known-good LAB/LGO files do you have?
- Are they from actual game characters that work in-game?
- Do you have corresponding glTF exports?

**Need:** At least 3-5 test cases covering:
- Simple hierarchy (3-5 bones)
- Complex hierarchy (10+ bones with branches)
- Character with partial bone usage in mesh

---

### 6. Export Pipeline
**Question:** Do you already have LAB/LGO → glTF export working?

**Impact:** If yes, we can do round-trip testing immediately. If no, we need to implement export first or rely on other validation methods.

---

## 📊 Success Criteria

Implementation is complete when:

### Must Have (Required)
- ✅ All unit tests pass
- ✅ Snapshot tests match golden files (or new golden files approved)
- ✅ All 5 bugs fixed (verified by specific tests)
- ✅ Known-good files round-trip successfully
- ✅ No panics or unwrap failures

### Should Have (Highly Recommended)
- ✅ Property-based tests pass (1000+ cases)
- ✅ Visual inspection in glTF viewer looks correct
- ✅ CI/CD pipeline green

### Nice To Have (Future Improvements)
- ✅ Performance benchmarks
- ✅ Additional test coverage for edge cases
- ✅ Documentation improvements

---

## 🚨 Common Pitfalls To Avoid

### During Implementation

1. **Don't skip the tests** - Implement test infrastructure FIRST
2. **Don't batch changes** - Fix one bug at a time, verify, then move on
3. **Don't update golden files blindly** - Inspect diffs before updating
4. **Don't panic on test failures** - Read the error message, it tells you exactly what's wrong

### During Testing

1. **Don't test only happy path** - Test edge cases (empty bones, single bone, non-sequential indices)
2. **Don't assume visual correctness** - Run mathematical validation
3. **Don't ignore warnings** - Warnings often indicate semantic issues

### During Validation

1. **Don't rely on single test case** - Use multiple character files
2. **Don't skip visual inspection** - Export to glTF viewer at least once
3. **Don't merge without CI passing** - Automated tests catch regressions

---

## 🔧 Tools & Resources

### Testing Tools
- **proptest** - Property-based testing: `cargo add --dev proptest`
- **insta** - Snapshot testing (optional): `cargo add --dev insta`
- **cargo-watch** - Auto-run tests on save: `cargo install cargo-watch`

### Visual Validation
- **glTF Viewer**: https://gltf-viewer.donmccurdy.com/
- **Babylon Sandbox**: https://sandbox.babylonjs.com/
- **Blender**: For detailed skeleton inspection

### CI/CD
- GitHub Actions workflow included in Testing Strategy
- Runs all tests automatically on push/PR
- Uploads artifacts on failure for debugging

---

## 📝 Next Steps

1. **Review both documents** - Read the fix plan and testing strategy
2. **Answer the questions** - Clarify the 6 outstanding questions above
3. **Set up test infrastructure** - Create directories, copy known-good files
4. **Begin implementation** - Follow the 8-phase plan

Once you've reviewed everything and answered the questions, we can begin implementation!

---

## 📞 Need Help?

If you get stuck during implementation:

1. **Check the debug helpers** - Both documents include debugging tips
2. **Read test failure messages** - They're designed to be descriptive
3. **Use visual validation** - Export to glTF and inspect in viewer
4. **Review the game engine code** - When in doubt, check what the game expects

---

**Document Version:** 1.0  
**Last Updated:** 2026-01-11  
**Status:** Planning Phase - Ready for Implementation
