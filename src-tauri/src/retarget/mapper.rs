use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::skeleton::{AnalyzedSkeleton, PkoStandardSkeleton, SkeletonSourceType};

/// Confidence level for a bone mapping
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MappingConfidence {
    /// Exact name match
    Exact,
    /// High-confidence heuristic match
    High,
    /// Moderate-confidence heuristic match
    Medium,
    /// Low-confidence guess
    Low,
    /// User-provided manual override
    Manual,
    /// No mapping found
    Unmapped,
}

/// A single bone mapping entry from source to target
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoneMappingEntry {
    /// Source bone name from external model
    pub source_name: String,
    /// Source bone index in the external skeleton
    pub source_index: usize,
    /// Target PKO bone name (None if unmapped)
    pub target_name: Option<String>,
    /// Target PKO bone index (None if unmapped)
    pub target_index: Option<usize>,
    /// Confidence of this mapping
    pub confidence: MappingConfidence,
}

/// Complete bone mapping from source to PKO skeleton
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoneMapping {
    pub entries: Vec<BoneMappingEntry>,
    pub source_type: SkeletonSourceType,
    /// Count of successfully mapped bones
    pub mapped_count: usize,
    /// Count of unmapped source bones
    pub unmapped_count: usize,
    /// Count of PKO bones without a source mapping
    pub missing_target_count: usize,
}

impl BoneMapping {
    /// Get the target bone index for a given source bone index
    pub fn get_target_index(&self, source_index: usize) -> Option<usize> {
        self.entries
            .iter()
            .find(|e| e.source_index == source_index)
            .and_then(|e| e.target_index)
    }

    /// Check if all critical bones are mapped
    pub fn has_critical_mappings(&self) -> bool {
        let critical_pko_bones = ["Bip01", "Bip01 Pelvis", "Bip01 Spine", "Bip01 Spine1"];
        critical_pko_bones.iter().all(|name| {
            self.entries.iter().any(|e| {
                e.target_name.as_deref() == Some(name)
                    && e.confidence != MappingConfidence::Unmapped
            })
        })
    }
}

/// Mixamo bone name → PKO bone name mapping table
fn mixamo_mapping_table() -> HashMap<&'static str, &'static str> {
    HashMap::from([
        ("mixamorig:Hips", "Bip01 Pelvis"),
        ("mixamorig:Spine", "Bip01 Spine"),
        ("mixamorig:Spine1", "Bip01 Spine1"),
        ("mixamorig:Spine2", "Bip01 Spine1"), // Merge into Spine1
        ("mixamorig:Neck", "Bip01 Neck"),
        ("mixamorig:Head", "Bip01 Head"),
        ("mixamorig:LeftShoulder", "Bip01 L Clavicle"),
        ("mixamorig:LeftArm", "Bip01 L UpperArm"),
        ("mixamorig:LeftForeArm", "Bip01 L Forearm"),
        ("mixamorig:LeftHand", "Bip01 L Hand"),
        ("mixamorig:RightShoulder", "Bip01 R Clavicle"),
        ("mixamorig:RightArm", "Bip01 R UpperArm"),
        ("mixamorig:RightForeArm", "Bip01 R Forearm"),
        ("mixamorig:RightHand", "Bip01 R Hand"),
        ("mixamorig:LeftUpLeg", "Bip01 L Thigh"),
        ("mixamorig:LeftLeg", "Bip01 L Calf"),
        ("mixamorig:LeftFoot", "Bip01 L Foot"),
        ("mixamorig:LeftToeBase", "Bip01 L Toe0"),
        ("mixamorig:RightUpLeg", "Bip01 R Thigh"),
        ("mixamorig:RightLeg", "Bip01 R Calf"),
        ("mixamorig:RightFoot", "Bip01 R Foot"),
        ("mixamorig:RightToeBase", "Bip01 R Toe0"),
    ])
}

/// Unity Mecanim bone name → PKO bone name mapping table
fn unity_mapping_table() -> HashMap<&'static str, &'static str> {
    HashMap::from([
        ("Hips", "Bip01 Pelvis"),
        ("Spine", "Bip01 Spine"),
        ("Chest", "Bip01 Spine1"),
        ("UpperChest", "Bip01 Spine1"),
        ("Neck", "Bip01 Neck"),
        ("Head", "Bip01 Head"),
        ("LeftShoulder", "Bip01 L Clavicle"),
        ("LeftUpperArm", "Bip01 L UpperArm"),
        ("LeftLowerArm", "Bip01 L Forearm"),
        ("LeftHand", "Bip01 L Hand"),
        ("RightShoulder", "Bip01 R Clavicle"),
        ("RightUpperArm", "Bip01 R UpperArm"),
        ("RightLowerArm", "Bip01 R Forearm"),
        ("RightHand", "Bip01 R Hand"),
        ("LeftUpLeg", "Bip01 L Thigh"),
        ("LeftLeg", "Bip01 L Calf"),
        ("LeftFoot", "Bip01 L Foot"),
        ("LeftToes", "Bip01 L Toe0"),
        ("RightUpLeg", "Bip01 R Thigh"),
        ("RightLeg", "Bip01 R Calf"),
        ("RightFoot", "Bip01 R Foot"),
        ("RightToes", "Bip01 R Toe0"),
    ])
}

/// Unreal Engine bone name → PKO bone name mapping table
fn unreal_mapping_table() -> HashMap<&'static str, &'static str> {
    HashMap::from([
        ("pelvis", "Bip01 Pelvis"),
        ("spine_01", "Bip01 Spine"),
        ("spine_02", "Bip01 Spine1"),
        ("spine_03", "Bip01 Spine1"),
        ("neck_01", "Bip01 Neck"),
        ("head", "Bip01 Head"),
        ("clavicle_l", "Bip01 L Clavicle"),
        ("upperarm_l", "Bip01 L UpperArm"),
        ("lowerarm_l", "Bip01 L Forearm"),
        ("hand_l", "Bip01 L Hand"),
        ("clavicle_r", "Bip01 R Clavicle"),
        ("upperarm_r", "Bip01 R UpperArm"),
        ("lowerarm_r", "Bip01 R Forearm"),
        ("hand_r", "Bip01 R Hand"),
        ("thigh_l", "Bip01 L Thigh"),
        ("calf_l", "Bip01 L Calf"),
        ("foot_l", "Bip01 L Foot"),
        ("ball_l", "Bip01 L Toe0"),
        ("thigh_r", "Bip01 R Thigh"),
        ("calf_r", "Bip01 R Calf"),
        ("foot_r", "Bip01 R Foot"),
        ("ball_r", "Bip01 R Toe0"),
    ])
}

/// Generic keyword-based mapping for unknown skeleton types.
/// Returns (pko_bone_name, confidence) if matched.
fn generic_keyword_match(name: &str) -> Option<(&'static str, MappingConfidence)> {
    let lower = name.to_lowercase();

    // Try to identify the bone by keywords
    // Order matters: check more specific patterns first

    // Root / Hips
    if lower == "hips" || lower == "pelvis" || lower.ends_with("_pelvis") {
        return Some(("Bip01 Pelvis", MappingConfidence::Medium));
    }
    if lower == "root" || lower == "armature" {
        return Some(("Bip01", MappingConfidence::Medium));
    }

    // Head / Neck
    if lower == "head" || lower.ends_with("_head") {
        return Some(("Bip01 Head", MappingConfidence::Medium));
    }
    if lower == "neck" || lower.ends_with("_neck") {
        return Some(("Bip01 Neck", MappingConfidence::Medium));
    }

    // Spine
    if lower == "spine2" || lower == "spine1" || lower == "chest" || lower.contains("upper_spine") {
        return Some(("Bip01 Spine1", MappingConfidence::Medium));
    }
    if lower == "spine" || lower.contains("lower_spine") {
        return Some(("Bip01 Spine", MappingConfidence::Medium));
    }

    // Left arm chain
    if contains_left(&lower) {
        if lower.contains("shoulder") || lower.contains("clavicle") {
            return Some(("Bip01 L Clavicle", MappingConfidence::Medium));
        }
        if lower.contains("upper") && lower.contains("arm") {
            return Some(("Bip01 L UpperArm", MappingConfidence::Medium));
        }
        if (lower.contains("fore") || lower.contains("lower")) && lower.contains("arm") {
            return Some(("Bip01 L Forearm", MappingConfidence::Medium));
        }
        if lower.contains("hand") || lower.contains("wrist") {
            return Some(("Bip01 L Hand", MappingConfidence::Medium));
        }
    }

    // Right arm chain
    if contains_right(&lower) {
        if lower.contains("shoulder") || lower.contains("clavicle") {
            return Some(("Bip01 R Clavicle", MappingConfidence::Medium));
        }
        if lower.contains("upper") && lower.contains("arm") {
            return Some(("Bip01 R UpperArm", MappingConfidence::Medium));
        }
        if (lower.contains("fore") || lower.contains("lower")) && lower.contains("arm") {
            return Some(("Bip01 R Forearm", MappingConfidence::Medium));
        }
        if lower.contains("hand") || lower.contains("wrist") {
            return Some(("Bip01 R Hand", MappingConfidence::Medium));
        }
    }

    // Left leg chain
    if contains_left(&lower) {
        if lower.contains("thigh")
            || (lower.contains("upper") && lower.contains("leg"))
            || lower.contains("upleg")
        {
            return Some(("Bip01 L Thigh", MappingConfidence::Medium));
        }
        if lower.contains("calf")
            || lower.contains("shin")
            || (lower.contains("lower") && lower.contains("leg"))
        {
            return Some(("Bip01 L Calf", MappingConfidence::Medium));
        }
        if lower.contains("toe") {
            return Some(("Bip01 L Toe0", MappingConfidence::Medium));
        }
        if lower.contains("foot") || lower.contains("ankle") {
            return Some(("Bip01 L Foot", MappingConfidence::Medium));
        }
    }

    // Right leg chain
    if contains_right(&lower) {
        if lower.contains("thigh")
            || (lower.contains("upper") && lower.contains("leg"))
            || lower.contains("upleg")
        {
            return Some(("Bip01 R Thigh", MappingConfidence::Medium));
        }
        if lower.contains("calf")
            || lower.contains("shin")
            || (lower.contains("lower") && lower.contains("leg"))
        {
            return Some(("Bip01 R Calf", MappingConfidence::Medium));
        }
        if lower.contains("toe") {
            return Some(("Bip01 R Toe0", MappingConfidence::Medium));
        }
        if lower.contains("foot") || lower.contains("ankle") {
            return Some(("Bip01 R Foot", MappingConfidence::Medium));
        }
    }

    // Ambiguous arm (no left/right qualifier) - skip
    // Ambiguous leg (no left/right qualifier) - skip

    None
}

fn contains_left(s: &str) -> bool {
    s.contains("left")
        || s.contains("_l_")
        || s.starts_with("l_")
        || s.ends_with("_l")
        || s.contains(".l")
        || s.starts_with("l.")
}

fn contains_right(s: &str) -> bool {
    s.contains("right")
        || s.contains("_r_")
        || s.starts_with("r_")
        || s.ends_with("_r")
        || s.contains(".r")
        || s.starts_with("r.")
}

/// Auto-map bones from an analyzed external skeleton to the PKO standard skeleton.
pub fn auto_map_bones(skeleton: &AnalyzedSkeleton) -> BoneMapping {
    let pko_index_map = PkoStandardSkeleton::bone_index_map();
    let mut entries = Vec::with_capacity(skeleton.bones.len());
    let mut mapped_targets: HashMap<String, usize> = HashMap::new();

    // Choose mapping strategy based on source type
    let table: Option<HashMap<&str, &str>> = match skeleton.source_type {
        SkeletonSourceType::Mixamo => Some(mixamo_mapping_table()),
        SkeletonSourceType::Unity => Some(unity_mapping_table()),
        SkeletonSourceType::Unreal => Some(unreal_mapping_table()),
        SkeletonSourceType::Biped => None,   // Identity mapping
        SkeletonSourceType::Unknown => None, // Generic keyword matching
    };

    for bone in &skeleton.bones {
        let (target_name, confidence) = if skeleton.source_type == SkeletonSourceType::Biped {
            // Direct identity mapping for Biped sources
            if pko_index_map.contains_key(bone.name.as_str()) {
                (Some(bone.name.clone()), MappingConfidence::Exact)
            } else {
                (None, MappingConfidence::Unmapped)
            }
        } else if let Some(ref table) = table {
            // Use pre-defined mapping table
            if let Some(target) = table.get(bone.name.as_str()) {
                (Some(target.to_string()), MappingConfidence::High)
            } else {
                // Fall back to generic matching
                match generic_keyword_match(&bone.name) {
                    Some((target, conf)) => (Some(target.to_string()), conf),
                    None => (None, MappingConfidence::Unmapped),
                }
            }
        } else {
            // Generic keyword matching
            match generic_keyword_match(&bone.name) {
                Some((target, conf)) => (Some(target.to_string()), conf),
                None => (None, MappingConfidence::Unmapped),
            }
        };

        // Resolve target index and handle duplicate mappings
        let (final_target_name, final_target_index, final_confidence) =
            if let Some(ref name) = target_name {
                if mapped_targets.contains_key(name) {
                    // Duplicate mapping - keep the first one, mark this as unmapped
                    (None, None, MappingConfidence::Unmapped)
                } else {
                    let idx = pko_index_map.get(name.as_str()).copied();
                    if idx.is_some() {
                        mapped_targets.insert(name.clone(), bone.index);
                    }
                    (Some(name.clone()), idx, confidence)
                }
            } else {
                (None, None, MappingConfidence::Unmapped)
            };

        entries.push(BoneMappingEntry {
            source_name: bone.name.clone(),
            source_index: bone.index,
            target_name: final_target_name,
            target_index: final_target_index,
            confidence: final_confidence,
        });
    }

    let mapped_count = entries.iter().filter(|e| e.target_index.is_some()).count();
    let unmapped_count = entries.len() - mapped_count;
    let missing_target_count = PkoStandardSkeleton::bone_count() - mapped_targets.len();

    BoneMapping {
        entries,
        source_type: skeleton.source_type,
        mapped_count,
        unmapped_count,
        missing_target_count,
    }
}

/// Apply a manual override to a bone mapping
pub fn apply_manual_override(
    mapping: &mut BoneMapping,
    source_index: usize,
    target_name: Option<String>,
) {
    let pko_index_map = PkoStandardSkeleton::bone_index_map();

    if let Some(entry) = mapping
        .entries
        .iter_mut()
        .find(|e| e.source_index == source_index)
    {
        entry.target_name = target_name.clone();
        entry.target_index = target_name
            .as_deref()
            .and_then(|n| pko_index_map.get(n).copied());
        entry.confidence = if target_name.is_some() {
            MappingConfidence::Manual
        } else {
            MappingConfidence::Unmapped
        };
    }

    // Recount
    mapping.mapped_count = mapping
        .entries
        .iter()
        .filter(|e| e.target_index.is_some())
        .count();
    mapping.unmapped_count = mapping.entries.len() - mapping.mapped_count;

    let mapped_targets: std::collections::HashSet<_> = mapping
        .entries
        .iter()
        .filter_map(|e| e.target_name.as_ref())
        .collect();
    mapping.missing_target_count = PkoStandardSkeleton::bone_count() - mapped_targets.len();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::retarget::skeleton::analyze_skeleton;

    fn make_mixamo_skeleton() -> AnalyzedSkeleton {
        let names = vec![
            "mixamorig:Hips".to_string(),
            "mixamorig:Spine".to_string(),
            "mixamorig:Spine1".to_string(),
            "mixamorig:Spine2".to_string(),
            "mixamorig:Neck".to_string(),
            "mixamorig:Head".to_string(),
            "mixamorig:LeftShoulder".to_string(),
            "mixamorig:LeftArm".to_string(),
            "mixamorig:LeftForeArm".to_string(),
            "mixamorig:LeftHand".to_string(),
            "mixamorig:RightShoulder".to_string(),
            "mixamorig:RightArm".to_string(),
            "mixamorig:RightForeArm".to_string(),
            "mixamorig:RightHand".to_string(),
            "mixamorig:LeftUpLeg".to_string(),
            "mixamorig:LeftLeg".to_string(),
            "mixamorig:LeftFoot".to_string(),
            "mixamorig:LeftToeBase".to_string(),
            "mixamorig:RightUpLeg".to_string(),
            "mixamorig:RightLeg".to_string(),
            "mixamorig:RightFoot".to_string(),
            "mixamorig:RightToeBase".to_string(),
        ];
        let parents = vec![
            None,
            Some(0),
            Some(1),
            Some(2),
            Some(3),
            Some(4),
            Some(3),
            Some(6),
            Some(7),
            Some(8),
            Some(3),
            Some(10),
            Some(11),
            Some(12),
            Some(0),
            Some(14),
            Some(15),
            Some(16),
            Some(0),
            Some(18),
            Some(19),
            Some(20),
        ];
        analyze_skeleton(&names, &parents)
    }

    #[test]
    fn test_mixamo_auto_mapping() {
        let skeleton = make_mixamo_skeleton();
        let mapping = auto_map_bones(&skeleton);

        assert_eq!(mapping.source_type, SkeletonSourceType::Mixamo);
        // Mixamo has 22 bones, but Spine2 maps to same target as Spine1 → 21 mapped
        // (Spine2 gets unmapped due to duplicate target)
        assert!(mapping.mapped_count >= 20);

        // Check specific critical mappings
        let hips = mapping
            .entries
            .iter()
            .find(|e| e.source_name == "mixamorig:Hips")
            .unwrap();
        assert_eq!(hips.target_name.as_deref(), Some("Bip01 Pelvis"));
        assert_eq!(hips.confidence, MappingConfidence::High);

        let head = mapping
            .entries
            .iter()
            .find(|e| e.source_name == "mixamorig:Head")
            .unwrap();
        assert_eq!(head.target_name.as_deref(), Some("Bip01 Head"));
    }

    #[test]
    fn test_biped_identity_mapping() {
        let names = vec![
            "Bip01".to_string(),
            "Bip01 Pelvis".to_string(),
            "Bip01 Spine".to_string(),
            "Bip01 Spine1".to_string(),
            "Bip01 Neck".to_string(),
            "Bip01 Head".to_string(),
        ];
        let parents = vec![None, Some(0), Some(1), Some(2), Some(3), Some(4)];
        let skeleton = analyze_skeleton(&names, &parents);
        let mapping = auto_map_bones(&skeleton);

        assert_eq!(mapping.source_type, SkeletonSourceType::Biped);
        assert_eq!(mapping.mapped_count, 6);

        for entry in &mapping.entries {
            assert_eq!(
                entry.target_name.as_deref(),
                Some(entry.source_name.as_str())
            );
            assert_eq!(entry.confidence, MappingConfidence::Exact);
        }
    }

    #[test]
    fn test_generic_keyword_mapping() {
        let names = vec![
            "root".to_string(),
            "left_upper_arm".to_string(),
            "right_foot".to_string(),
            "random_bone_xyz".to_string(),
        ];
        let parents = vec![None, Some(0), Some(0), Some(0)];
        let skeleton = analyze_skeleton(&names, &parents);
        let mapping = auto_map_bones(&skeleton);

        let root = mapping
            .entries
            .iter()
            .find(|e| e.source_name == "root")
            .unwrap();
        assert_eq!(root.target_name.as_deref(), Some("Bip01"));

        let arm = mapping
            .entries
            .iter()
            .find(|e| e.source_name == "left_upper_arm")
            .unwrap();
        assert_eq!(arm.target_name.as_deref(), Some("Bip01 L UpperArm"));

        let foot = mapping
            .entries
            .iter()
            .find(|e| e.source_name == "right_foot")
            .unwrap();
        assert_eq!(foot.target_name.as_deref(), Some("Bip01 R Foot"));

        let unknown = mapping
            .entries
            .iter()
            .find(|e| e.source_name == "random_bone_xyz")
            .unwrap();
        assert_eq!(unknown.confidence, MappingConfidence::Unmapped);
    }

    #[test]
    fn test_manual_override() {
        let names = vec!["some_bone".to_string()];
        let parents = vec![None];
        let skeleton = analyze_skeleton(&names, &parents);
        let mut mapping = auto_map_bones(&skeleton);

        assert_eq!(mapping.entries[0].confidence, MappingConfidence::Unmapped);

        apply_manual_override(&mut mapping, 0, Some("Bip01 Head".to_string()));

        assert_eq!(
            mapping.entries[0].target_name.as_deref(),
            Some("Bip01 Head")
        );
        assert_eq!(mapping.entries[0].confidence, MappingConfidence::Manual);
        assert_eq!(mapping.mapped_count, 1);
    }

    #[test]
    fn test_has_critical_mappings() {
        let skeleton = make_mixamo_skeleton();
        let mapping = auto_map_bones(&skeleton);

        // Mixamo doesn't have a direct "Bip01" mapping (Hips → Pelvis, no root)
        // So critical mappings check will fail for "Bip01"
        // This is expected - the root bone needs special handling
        assert!(!mapping.has_critical_mappings());
    }
}
