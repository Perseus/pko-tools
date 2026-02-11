use super::report::{ValidationItem, ValidationReport, ValidationSeverity, ValidationCategory};

/// Reduce blend weights per vertex to the maximum allowed (4).
///
/// Takes weights as [f32; N] per vertex, keeps only the top 4 and renormalizes.
pub fn fix_blend_weights(weights: &mut Vec<[f32; 4]>, indices: &mut Vec<[u16; 4]>, raw_weights: &[[f32; 8]], raw_indices: &[[u16; 8]]) -> u32 {
    let mut fixed_count = 0u32;

    for (i, (rw, ri)) in raw_weights.iter().zip(raw_indices.iter()).enumerate() {
        // Collect all non-zero weight/index pairs
        let mut pairs: Vec<(f32, u16)> = rw.iter()
            .zip(ri.iter())
            .filter(|(&w, _)| w > 0.0)
            .map(|(&w, &idx)| (w, idx))
            .collect();

        if pairs.len() <= 4 {
            // Already within limit, just normalize
            let mut w = [0.0f32; 4];
            let mut j = [0u16; 4];
            for (k, (pw, pj)) in pairs.iter().enumerate().take(4) {
                w[k] = *pw;
                j[k] = *pj;
            }
            normalize_weights(&mut w);
            weights[i] = w;
            indices[i] = j;
            continue;
        }

        fixed_count += 1;

        // Sort by weight descending, keep top 4
        pairs.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        pairs.truncate(4);

        let mut w = [0.0f32; 4];
        let mut j = [0u16; 4];
        for (k, (pw, pj)) in pairs.iter().enumerate() {
            w[k] = *pw;
            j[k] = *pj;
        }
        normalize_weights(&mut w);
        weights[i] = w;
        indices[i] = j;
    }

    fixed_count
}

/// Normalize a set of weights so they sum to 1.0.
pub fn normalize_weights(weights: &mut [f32; 4]) {
    let sum: f32 = weights.iter().sum();
    if sum > 0.0 {
        for w in weights.iter_mut() {
            *w /= sum;
        }
    } else {
        // If all weights are zero, assign full weight to first bone
        weights[0] = 1.0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_weights_basic() {
        let mut w = [0.5, 0.3, 0.2, 0.0];
        normalize_weights(&mut w);
        let sum: f32 = w.iter().sum();
        assert!((sum - 1.0).abs() < 0.001);
    }

    #[test]
    fn normalize_weights_all_zero() {
        let mut w = [0.0, 0.0, 0.0, 0.0];
        normalize_weights(&mut w);
        assert_eq!(w[0], 1.0);
    }

    #[test]
    fn normalize_weights_already_normalized() {
        let mut w = [0.5, 0.3, 0.15, 0.05];
        normalize_weights(&mut w);
        let sum: f32 = w.iter().sum();
        assert!((sum - 1.0).abs() < 0.001);
    }

    #[test]
    fn fix_blend_weights_reduces() {
        // 6 influences → should keep top 4
        let raw_weights = vec![[0.1, 0.2, 0.3, 0.15, 0.05, 0.2, 0.0, 0.0]];
        let raw_indices = vec![[0, 1, 2, 3, 4, 5, 0, 0]];
        let mut weights = vec![[0.0f32; 4]];
        let mut indices = vec![[0u16; 4]];

        let fixed = fix_blend_weights(&mut weights, &mut indices, &raw_weights, &raw_indices);
        assert_eq!(fixed, 1);

        // Weights should be normalized
        let sum: f32 = weights[0].iter().sum();
        assert!((sum - 1.0).abs() < 0.001);
    }

    #[test]
    fn fix_blend_weights_within_limit() {
        let raw_weights = vec![[0.5, 0.3, 0.2, 0.0, 0.0, 0.0, 0.0, 0.0]];
        let raw_indices = vec![[0, 1, 2, 0, 0, 0, 0, 0]];
        let mut weights = vec![[0.0f32; 4]];
        let mut indices = vec![[0u16; 4]];

        let fixed = fix_blend_weights(&mut weights, &mut indices, &raw_weights, &raw_indices);
        assert_eq!(fixed, 0);
    }
}
