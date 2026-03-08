**Findings (by severity)**

1. **High: PR 8 and PR 9 are ordered in a risky way**
   - PR 9 depends on reusing LMO conversion logic (`convert_geometry_chunk()`), but PR 8 deletes `lmo.rs`.
   - If PR 8 removes or reshapes conversion internals before PR 9 lands, PR 9 will either duplicate logic or reintroduce churn.
   - Fix: split PR 8 into:
     - `8a`: extract shared `lmo_types` + shared geometry conversion module (no deletion)
     - `8b`: switch default to Kaitai + delete native LMO only after PR 9 is green.

2. **High: Kaitai codegen patching is under-specified for scale**
   - Manual patched generated `.rs` for 3 new formats will drift quickly.
   - Current plan lacks a reproducible patch pipeline and CI guard.
   - Fix: add a “codegen hygiene” PR early:
     - deterministic regenerate script
     - patch application script
     - CI check to fail on uncommitted diffs after regeneration.

3. **High: Native deletion safety is optimistic**
   - Deletion scopes list parser functions, but not all call-site/trait/serde/binwrite dependencies.
   - Hidden dependencies are likely in conversion/export paths, editor tooling, and tests.
   - Fix: require per-format pre-delete checklist:
     - `rg` call-site audit
     - trait impl audit (`BinRead`, `BinWrite`, conversion traits)
     - fixture parity + smoke integration test before removal.

4. **Medium: “Parity” depth is uneven**
   - MAP parity on two files is weak for a structural format.
   - OBJ/LAB/LGO “exhaustive” is good, but MAP should also be exhaustive over available fixtures.
   - Fix: define a minimum parity matrix per format (versions, empty sections, max counts, malformed input).

5. **Medium: Golden tests are too late (PR 11)**
   - Snapshots only after all adapters/deletions reduces rollback safety.
   - Fix: introduce format-level snapshots in each adapter PR, then keep PR 11 for cross-format consolidated suite.

6. **Medium: PR 6/7 LAB split may still hide runtime coupling**
   - Keeping native parser temporarily is reasonable, but BinWrite/BinRead interactions often leak assumptions.
   - Fix: in PR 6 add explicit compatibility tests for write-path after Kaitai read conversion.

7. **Medium: LGO adapter reuse assumption may not hold directly**
   - Binary chunk compatibility does not guarantee domain-model compatibility.
   - `CharacterGeometricModel` may need mapping differences vs map-side LMO types.
   - Fix: reuse lower-level geometry decode, but keep separate domain mapping layer for character types.

---

**Direct answers to your focus points**

1. **Completeness**
   - Missing: malformed/corrupt input behavior, version-skew tests, fuzz/smoke tests, and codegen drift controls.

2. **Ordering & dependencies**
   - Main issue is PR 8 before PR 9 deletion-wise. Extract shared pieces first, delete later.

3. **Risk**
   - Biggest risks: PR 8/9 coupling, codegen patch drift, hidden native dependencies during deletion.

4. **Kaitai codegen scaling**
   - Not safe as-is for 3 formats without scripted regeneration+patching+CI diff checks.

5. **Native deletion safety**
   - Direction is right, but deletion scope should be gated by explicit call-site and trait audits per format.

6. **LMO extraction safety (PR 8)**
   - Safe only if done as non-breaking extraction first with transitional re-exports/type aliases, then delete in follow-up.

7. **LGO adapter feasibility (PR 9)**
   - Reuse is feasible at geometry decode layer; risky at full model conversion layer unless split cleanly.

8. **Incremental delivery**
   - Mostly good, but PRs are not all truly stand-alone yet. Add per-PR invariant tests and move some snapshot coverage earlier.

---

**Recommended graph adjustment (minimal)**
1. PR 1  
2. PR 2 + codegen reproducibility/CI guard  
3. PR 3/4/5/6 (format adapters)  
4. PR 8a (extract shared LMO types + geometry conversion, no deletion)  
5. PR 9 (LGO adapter + parity)  
6. PR 8b (LMO native deletion + default switch)  
7. PR 7 (LAB native deletion, if still independent)  
8. PR 10 → PR 11 → PR 12
