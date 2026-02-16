use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Body region classification for bones
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum BodyRegion {
    Root,
    Spine,
    Head,
    LeftArm,
    RightArm,
    LeftLeg,
    RightLeg,
}

/// A bone in the PKO standard skeleton
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PkoBone {
    pub name: &'static str,
    pub parent: Option<&'static str>,
    pub region: BodyRegion,
    /// Depth-first order index
    pub depth_order: usize,
}

/// The PKO standard skeleton definition.
///
/// PKO uses 3ds Max Biped naming convention.
/// Max 25 bones, depth-first ordering, with Bip01 as root.
pub struct PkoStandardSkeleton;

impl PkoStandardSkeleton {
    /// The canonical PKO bone list in depth-first order.
    /// This represents the most common PKO character skeleton.
    pub const BONES: &'static [PkoBone] = &[
        PkoBone {
            name: "Bip01",
            parent: None,
            region: BodyRegion::Root,
            depth_order: 0,
        },
        PkoBone {
            name: "Bip01 Pelvis",
            parent: Some("Bip01"),
            region: BodyRegion::Root,
            depth_order: 1,
        },
        PkoBone {
            name: "Bip01 Spine",
            parent: Some("Bip01 Pelvis"),
            region: BodyRegion::Spine,
            depth_order: 2,
        },
        PkoBone {
            name: "Bip01 Spine1",
            parent: Some("Bip01 Spine"),
            region: BodyRegion::Spine,
            depth_order: 3,
        },
        PkoBone {
            name: "Bip01 Neck",
            parent: Some("Bip01 Spine1"),
            region: BodyRegion::Head,
            depth_order: 4,
        },
        PkoBone {
            name: "Bip01 Head",
            parent: Some("Bip01 Neck"),
            region: BodyRegion::Head,
            depth_order: 5,
        },
        PkoBone {
            name: "Bip01 L Clavicle",
            parent: Some("Bip01 Spine1"),
            region: BodyRegion::LeftArm,
            depth_order: 6,
        },
        PkoBone {
            name: "Bip01 L UpperArm",
            parent: Some("Bip01 L Clavicle"),
            region: BodyRegion::LeftArm,
            depth_order: 7,
        },
        PkoBone {
            name: "Bip01 L Forearm",
            parent: Some("Bip01 L UpperArm"),
            region: BodyRegion::LeftArm,
            depth_order: 8,
        },
        PkoBone {
            name: "Bip01 L Hand",
            parent: Some("Bip01 L Forearm"),
            region: BodyRegion::LeftArm,
            depth_order: 9,
        },
        PkoBone {
            name: "Bip01 R Clavicle",
            parent: Some("Bip01 Spine1"),
            region: BodyRegion::RightArm,
            depth_order: 10,
        },
        PkoBone {
            name: "Bip01 R UpperArm",
            parent: Some("Bip01 R Clavicle"),
            region: BodyRegion::RightArm,
            depth_order: 11,
        },
        PkoBone {
            name: "Bip01 R Forearm",
            parent: Some("Bip01 R UpperArm"),
            region: BodyRegion::RightArm,
            depth_order: 12,
        },
        PkoBone {
            name: "Bip01 R Hand",
            parent: Some("Bip01 R Forearm"),
            region: BodyRegion::RightArm,
            depth_order: 13,
        },
        PkoBone {
            name: "Bip01 L Thigh",
            parent: Some("Bip01 Pelvis"),
            region: BodyRegion::LeftLeg,
            depth_order: 14,
        },
        PkoBone {
            name: "Bip01 L Calf",
            parent: Some("Bip01 L Thigh"),
            region: BodyRegion::LeftLeg,
            depth_order: 15,
        },
        PkoBone {
            name: "Bip01 L Foot",
            parent: Some("Bip01 L Calf"),
            region: BodyRegion::LeftLeg,
            depth_order: 16,
        },
        PkoBone {
            name: "Bip01 L Toe0",
            parent: Some("Bip01 L Foot"),
            region: BodyRegion::LeftLeg,
            depth_order: 17,
        },
        PkoBone {
            name: "Bip01 R Thigh",
            parent: Some("Bip01 Pelvis"),
            region: BodyRegion::RightLeg,
            depth_order: 18,
        },
        PkoBone {
            name: "Bip01 R Calf",
            parent: Some("Bip01 R Thigh"),
            region: BodyRegion::RightLeg,
            depth_order: 19,
        },
        PkoBone {
            name: "Bip01 R Foot",
            parent: Some("Bip01 R Calf"),
            region: BodyRegion::RightLeg,
            depth_order: 20,
        },
        PkoBone {
            name: "Bip01 R Toe0",
            parent: Some("Bip01 R Foot"),
            region: BodyRegion::RightLeg,
            depth_order: 21,
        },
    ];

    /// Get a map from bone name → index for quick lookup
    pub fn bone_index_map() -> HashMap<&'static str, usize> {
        Self::BONES
            .iter()
            .enumerate()
            .map(|(i, b)| (b.name, i))
            .collect()
    }

    /// Get number of standard bones
    pub fn bone_count() -> usize {
        Self::BONES.len()
    }
}

/// Source skeleton type detection
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SkeletonSourceType {
    /// Mixamo (mixamorig: prefix, ~65 bones)
    Mixamo,
    /// Unreal Engine (root, pelvis, spine_01...)
    Unreal,
    /// 3ds Max Biped (Bip01, already PKO-compatible)
    Biped,
    /// Unity Mecanim (Hips, Spine, etc.)
    Unity,
    /// Unknown source
    Unknown,
}

/// An analyzed bone from an external model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalBone {
    pub name: String,
    pub index: usize,
    pub parent_index: Option<usize>,
    pub children: Vec<usize>,
    pub depth: u32,
    pub vertex_count: u32,
}

/// Result of analyzing an external skeleton
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalyzedSkeleton {
    pub bones: Vec<ExternalBone>,
    pub source_type: SkeletonSourceType,
    pub bone_count: usize,
    pub max_depth: u32,
    pub has_root: bool,
}

/// Detect the skeleton source type from bone names
pub fn detect_source_type(bone_names: &[String]) -> SkeletonSourceType {
    let has_mixamo = bone_names.iter().any(|n| n.starts_with("mixamorig:"));
    let has_biped = bone_names
        .iter()
        .any(|n| n.starts_with("Bip01") || n.starts_with("Bip02"));
    let has_unreal = bone_names
        .iter()
        .any(|n| n == "pelvis" || n.starts_with("spine_0") || n.starts_with("clavicle_"));
    let has_unity = bone_names
        .iter()
        .any(|n| n == "Hips" || n == "LeftUpLeg" || n == "RightUpLeg");

    if has_mixamo {
        SkeletonSourceType::Mixamo
    } else if has_biped {
        SkeletonSourceType::Biped
    } else if has_unreal {
        SkeletonSourceType::Unreal
    } else if has_unity {
        SkeletonSourceType::Unity
    } else {
        SkeletonSourceType::Unknown
    }
}

/// Analyze a skeleton from glTF joint data
pub fn analyze_skeleton(
    joint_names: &[String],
    joint_parents: &[Option<usize>],
) -> AnalyzedSkeleton {
    let source_type = detect_source_type(joint_names);
    let mut bones = Vec::with_capacity(joint_names.len());
    let mut max_depth = 0u32;
    let mut has_root = false;

    // Build children lists
    let mut children_map: HashMap<usize, Vec<usize>> = HashMap::new();
    for (i, parent) in joint_parents.iter().enumerate() {
        if let Some(p) = parent {
            children_map.entry(*p).or_default().push(i);
        }
    }

    // Calculate depths
    let depths = calculate_depths(joint_parents);

    for (i, name) in joint_names.iter().enumerate() {
        let depth = depths[i];
        if depth > max_depth {
            max_depth = depth;
        }
        if joint_parents[i].is_none() {
            has_root = true;
        }
        bones.push(ExternalBone {
            name: name.clone(),
            index: i,
            parent_index: joint_parents[i],
            children: children_map.get(&i).cloned().unwrap_or_default(),
            depth,
            vertex_count: 0,
        });
    }

    AnalyzedSkeleton {
        bone_count: bones.len(),
        bones,
        source_type,
        max_depth,
        has_root,
    }
}

fn calculate_depths(parents: &[Option<usize>]) -> Vec<u32> {
    let n = parents.len();
    let mut depths = vec![0u32; n];
    let mut computed = vec![false; n];

    fn compute_depth(
        idx: usize,
        parents: &[Option<usize>],
        depths: &mut Vec<u32>,
        computed: &mut Vec<bool>,
    ) -> u32 {
        if computed[idx] {
            return depths[idx];
        }
        let d = match parents[idx] {
            None => 0,
            Some(p) => compute_depth(p, parents, depths, computed) + 1,
        };
        depths[idx] = d;
        computed[idx] = true;
        d
    }

    for i in 0..n {
        compute_depth(i, parents, &mut depths, &mut computed);
    }
    depths
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_mixamo() {
        let names = vec![
            "mixamorig:Hips".to_string(),
            "mixamorig:Spine".to_string(),
            "mixamorig:LeftUpLeg".to_string(),
        ];
        assert_eq!(detect_source_type(&names), SkeletonSourceType::Mixamo);
    }

    #[test]
    fn test_detect_biped() {
        let names = vec![
            "Bip01".to_string(),
            "Bip01 Pelvis".to_string(),
            "Bip01 Spine".to_string(),
        ];
        assert_eq!(detect_source_type(&names), SkeletonSourceType::Biped);
    }

    #[test]
    fn test_detect_unreal() {
        let names = vec![
            "root".to_string(),
            "pelvis".to_string(),
            "spine_01".to_string(),
        ];
        assert_eq!(detect_source_type(&names), SkeletonSourceType::Unreal);
    }

    #[test]
    fn test_detect_unity() {
        let names = vec![
            "Hips".to_string(),
            "Spine".to_string(),
            "LeftUpLeg".to_string(),
            "RightUpLeg".to_string(),
        ];
        assert_eq!(detect_source_type(&names), SkeletonSourceType::Unity);
    }

    #[test]
    fn test_detect_unknown() {
        let names = vec!["bone_root".to_string(), "bone_spine".to_string()];
        assert_eq!(detect_source_type(&names), SkeletonSourceType::Unknown);
    }

    #[test]
    fn test_standard_skeleton_bone_count() {
        assert_eq!(PkoStandardSkeleton::bone_count(), 22);
    }

    #[test]
    fn test_standard_skeleton_depth_first_order() {
        // Verify every bone's parent appears before it in the list
        let index_map = PkoStandardSkeleton::bone_index_map();
        for bone in PkoStandardSkeleton::BONES.iter() {
            if let Some(parent_name) = bone.parent {
                let parent_idx = index_map[parent_name];
                let self_idx = index_map[bone.name];
                assert!(
                    parent_idx < self_idx,
                    "Bone '{}' at {} has parent '{}' at {} (should be before)",
                    bone.name,
                    self_idx,
                    parent_name,
                    parent_idx
                );
            }
        }
    }

    #[test]
    fn test_analyze_skeleton() {
        let names = vec![
            "root".to_string(),
            "spine".to_string(),
            "head".to_string(),
            "left_arm".to_string(),
            "right_arm".to_string(),
        ];
        let parents = vec![None, Some(0), Some(1), Some(1), Some(1)];
        let result = analyze_skeleton(&names, &parents);

        assert_eq!(result.bone_count, 5);
        assert!(result.has_root);
        assert_eq!(result.max_depth, 2);
        assert_eq!(result.bones[0].children.len(), 1); // root has 1 child (spine)
        assert_eq!(result.bones[1].children.len(), 3); // spine has 3 children
    }
}
