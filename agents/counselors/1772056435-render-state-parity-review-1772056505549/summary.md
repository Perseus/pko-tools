# Run Summary

**Prompt:** file:prompt.md
**Tools:** claude-opus, claude-sonnet, claude-haiku, codex-5.3-high, codex-5.3-xhigh, codex-5.3-medium
**Policy:** read-only=bestEffort

## Results

### ✓ claude-opus

- Status: success
- Duration: 124.2s
- Word count: 1949
- Key sections:
  - Render State Parity Pipeline — Independent Review
  - 1. Shader Correctness (TOP_Effect.shader)
  - SRP Batcher Compatibility — PASS
  - DepthOnly Pass — CONCERN: Vertex colors not considered
  - DepthOnly when ZWrite=0 — CORRECT
  - SharpSparkle clip threshold — DESIGN QUESTION
  - Missing: `_AlphaTest` property not used in shader code
  - 2. Suffix Parsing Robustness (TOPMaterialReplacer.cs)
  - False positive risk with `__PKO_T` in texture names — REAL BUT LOW
  - Edge case: What if `name` itself contains `_A` or `_O`?

### ✓ claude-sonnet

- Status: success
- Duration: 203.1s
- Word count: 1462
- Key sections:
  - Review: Render State Parity Pipeline
  - 1. Shader Correctness (TOP_Effect.shader)
  - 2. Suffix Parsing Robustness (TryParsePkoSuffix)
  - 3. Rust Exporter Logic
  - 4. Visual Regressions
  - 5. Static Dictionary Cache
  - Summary Table

### ✓ claude-haiku

- Status: success
- Duration: 38.2s
- Word count: 1393
- Key sections:
  - Render State Parity Pipeline Review
  - 1. Shader Correctness for URP
  - 2. Suffix Parsing Robustness
  - 3. Rust Exporter Logic
  - 4. Visual Regression Risks
  - Summary & Recommendations

### ✓ codex-5.3-high

- Status: success
- Duration: 158.0s
- Word count: 431

### ✓ codex-5.3-xhigh

- Status: success
- Duration: 229.4s
- Word count: 522

### ✓ codex-5.3-medium

- Status: success
- Duration: 70.9s
- Word count: 454
