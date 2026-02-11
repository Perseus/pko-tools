use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

use super::mapper::BoneMapping;
use super::skeleton::PkoStandardSkeleton;

/// Describes how to merge one bone into another
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoneMergeAction {
    /// Index of the bone to be removed
    pub source_index: usize,
    /// Name of the bone to be removed
    pub source_name: String,
    /// Index of the bone to merge into
    pub target_index: usize,
    /// Name of the bone to merge into
    pub target_name: String,
    /// Number of vertices affected by this merge
    pub affected_vertices: u32,
}

/// A plan for reducing bones to meet the PKO limit
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoneReductionPlan {
    /// Bones to merge
    pub merges: Vec<BoneMergeAction>,
    /// Final bone count after reduction
    pub final_bone_count: usize,
    /// Original bone count
    pub original_bone_count: usize,
    /// Whether the reduction will stay within limits
    pub within_limit: bool,
}

/// Maximum bones allowed by PKO engine
pub const PKO_MAX_BONES: usize = 25;

/// Create a bone reduction plan from a bone mapping.
///
/// Unmapped bones will be merged into their closest mapped ancestor.
/// If there's no mapped ancestor, they're merged into the root.
pub fn plan_bone_reduction(
    mapping: &BoneMapping,
    parents: &[Option<usize>],
    vertex_weights: Option<&[Vec<(usize, f32)>]>,
) -> BoneReductionPlan {
    let mapped_indices: HashSet<usize> = mapping.entries.iter()
        .filter(|e| e.target_index.is_some())
        .map(|e| e.source_index)
        .collect();

    let bone_count = mapping.entries.len();
    let mut merges = Vec::new();

    // For each unmapped bone, find the closest mapped ancestor
    for entry in &mapping.entries {
        if entry.target_index.is_some() {
            continue; // Already mapped, keep it
        }

        let merge_target = find_closest_mapped_ancestor(
            entry.source_index,
            parents,
            &mapped_indices,
        );

        if let Some(target_idx) = merge_target {
            let target_name = mapping.entries.iter()
                .find(|e| e.source_index == target_idx)
                .map(|e| e.source_name.clone())
                .unwrap_or_else(|| format!("bone_{}", target_idx));

            let affected = vertex_weights.map(|vw| {
                count_affected_vertices(entry.source_index, vw)
            }).unwrap_or(0);

            merges.push(BoneMergeAction {
                source_index: entry.source_index,
                source_name: entry.source_name.clone(),
                target_index: target_idx,
                target_name,
                affected_vertices: affected,
            });
        }
    }

    let final_count = mapped_indices.len();
    BoneReductionPlan {
        merges,
        final_bone_count: final_count,
        original_bone_count: bone_count,
        within_limit: final_count <= PKO_MAX_BONES,
    }
}

/// Find the closest ancestor bone that has a mapping
fn find_closest_mapped_ancestor(
    bone_index: usize,
    parents: &[Option<usize>],
    mapped_indices: &HashSet<usize>,
) -> Option<usize> {
    let mut current = parents.get(bone_index).copied().flatten();
    while let Some(parent_idx) = current {
        if mapped_indices.contains(&parent_idx) {
            return Some(parent_idx);
        }
        current = parents.get(parent_idx).copied().flatten();
    }
    // No mapped ancestor found - use first mapped bone (root)
    mapped_indices.iter().copied().min()
}

/// Count how many vertices are influenced by a given bone
fn count_affected_vertices(bone_index: usize, vertex_weights: &[Vec<(usize, f32)>]) -> u32 {
    vertex_weights.iter()
        .filter(|vw| vw.iter().any(|(bi, w)| *bi == bone_index && *w > 0.0))
        .count() as u32
}

/// Apply bone reduction: redistribute vertex weights from removed bones to their merge targets.
///
/// `weights` is indexed by vertex, each element is a list of (bone_index, weight) pairs.
/// Returns new weights with merged bones' weights transferred and renormalized.
pub fn apply_weight_redistribution(
    vertex_weights: &mut [Vec<(usize, f32)>],
    plan: &BoneReductionPlan,
) {
    // Build merge map: source_bone_index → target_bone_index
    let merge_map: HashMap<usize, usize> = plan.merges.iter()
        .map(|m| (m.source_index, m.target_index))
        .collect();

    for weights in vertex_weights.iter_mut() {
        // Redirect weights from merged bones to their targets
        for (bone_idx, _weight) in weights.iter_mut() {
            if let Some(target) = merge_map.get(bone_idx) {
                *bone_idx = *target;
            }
        }

        // Merge duplicate bone entries (same bone_idx may now appear multiple times)
        let mut merged: HashMap<usize, f32> = HashMap::new();
        for (bone_idx, weight) in weights.iter() {
            *merged.entry(*bone_idx).or_insert(0.0) += weight;
        }

        // Normalize weights
        let total: f32 = merged.values().sum();
        if total > 0.0 {
            *weights = merged.into_iter()
                .map(|(bi, w)| (bi, w / total))
                .collect();
        } else {
            *weights = merged.into_iter().collect();
        }

        // Sort by weight descending
        weights.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    }
}

/// Remap bone indices after reduction to form a contiguous 0..N range.
///
/// Takes the set of remaining bone indices (those that survived reduction)
/// and creates a mapping from old index → new contiguous index.
pub fn create_index_remap(
    mapping: &BoneMapping,
) -> HashMap<usize, usize> {
    let pko_index_map = PkoStandardSkeleton::bone_index_map();
    let mut remap = HashMap::new();

    // Map source bones to their PKO target index (depth-first order)
    for entry in &mapping.entries {
        if let (Some(target_name), Some(_target_idx)) = (&entry.target_name, entry.target_index) {
            if let Some(&pko_idx) = pko_index_map.get(target_name.as_str()) {
                remap.insert(entry.source_index, pko_idx);
            }
        }
    }

    remap
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::retarget::skeleton::analyze_skeleton;
    use crate::retarget::mapper::auto_map_bones;

    #[test]
    fn test_bone_reduction_plan() {
        // A skeleton with extra bones that truly don't match any PKO keyword
        let names = vec![
            "mixamorig:Hips".to_string(),
            "mixamorig:Spine".to_string(),
            "mixamorig:LeftUpLeg".to_string(),
            "mixamorig:LeftHandRing1".to_string(),  // Finger with "ring" - won't match PKO
            "mixamorig:LeftHandRing2".to_string(),  // Finger with "ring" - won't match PKO
        ];
        let parents = vec![None, Some(0), Some(0), Some(2), Some(3)];
        let skeleton = analyze_skeleton(&names, &parents);
        let mapping = auto_map_bones(&skeleton);

        let plan = plan_bone_reduction(&mapping, &parents, None);

        // Check unmapped bones get merged into closest mapped ancestor
        assert_eq!(plan.original_bone_count, 5);
        assert!(plan.within_limit);
        // At least 3 bones mapped (Hips, Spine, LeftUpLeg) - finger bones may or may not match
        assert!(plan.final_bone_count >= 3);
        assert!(plan.merges.len() >= 1); // At least some merges needed
    }

    #[test]
    fn test_weight_redistribution() {
        let mut weights = vec![
            vec![(0, 0.5), (1, 0.3), (2, 0.2)],  // vertex 0
            vec![(1, 0.8), (2, 0.2)],              // vertex 1
            vec![(0, 1.0)],                        // vertex 2
        ];

        let plan = BoneReductionPlan {
            merges: vec![
                BoneMergeAction {
                    source_index: 2,
                    source_name: "extra_bone".to_string(),
                    target_index: 1,
                    target_name: "parent_bone".to_string(),
                    affected_vertices: 2,
                },
            ],
            final_bone_count: 2,
            original_bone_count: 3,
            within_limit: true,
        };

        apply_weight_redistribution(&mut weights, &plan);

        // Vertex 0: bone 2 (weight 0.2) merged into bone 1 (weight 0.3) → bone 1 has 0.5
        assert_eq!(weights[0].len(), 2); // now only bones 0 and 1
        let bone_1_weight: f32 = weights[0].iter().filter(|(bi, _)| *bi == 1).map(|(_, w)| w).sum();
        assert!((bone_1_weight - 0.5).abs() < 0.01);

        // Vertex 1: bone 2 (weight 0.2) merged into bone 1 (weight 0.8) → bone 1 has 1.0
        assert_eq!(weights[1].len(), 1);
        assert_eq!(weights[1][0].0, 1);
        assert!((weights[1][0].1 - 1.0).abs() < 0.01);

        // Vertex 2: only bone 0, unaffected
        assert_eq!(weights[2].len(), 1);
        assert_eq!(weights[2][0].0, 0);
    }

    #[test]
    fn test_weight_normalization() {
        let mut weights = vec![
            vec![(0, 0.6), (1, 0.2), (2, 0.2)],
        ];

        let plan = BoneReductionPlan {
            merges: vec![
                BoneMergeAction {
                    source_index: 1,
                    source_name: "b1".to_string(),
                    target_index: 0,
                    target_name: "b0".to_string(),
                    affected_vertices: 1,
                },
                BoneMergeAction {
                    source_index: 2,
                    source_name: "b2".to_string(),
                    target_index: 0,
                    target_name: "b0".to_string(),
                    affected_vertices: 1,
                },
            ],
            final_bone_count: 1,
            original_bone_count: 3,
            within_limit: true,
        };

        apply_weight_redistribution(&mut weights, &plan);

        // All weights merged into bone 0, should sum to 1.0
        assert_eq!(weights[0].len(), 1);
        assert_eq!(weights[0][0].0, 0);
        assert!((weights[0][0].1 - 1.0).abs() < 0.001);
    }
}
