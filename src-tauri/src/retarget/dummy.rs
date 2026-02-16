use cgmath::{Matrix4, SquareMatrix};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::math::LwMatrix44;

/// Dummy point definition matching PKO's LINK_ID system.
/// See CharacterModel.h for LINK_ID_* enum.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DummyDefinition {
    pub id: u32,
    pub name: &'static str,
    /// Which PKO bone this dummy attaches to
    pub parent_bone: &'static str,
}

/// The 16 standard dummy points used by PKO characters.
/// Additional dummy points 16-23 exist but are less commonly used.
pub const STANDARD_DUMMIES: &[DummyDefinition] = &[
    DummyDefinition {
        id: 0,
        name: "dummy_base",
        parent_bone: "Bip01",
    },
    DummyDefinition {
        id: 1,
        name: "dummy_head",
        parent_bone: "Bip01 Head",
    },
    DummyDefinition {
        id: 2,
        name: "dummy_chest",
        parent_bone: "Bip01 Spine1",
    },
    DummyDefinition {
        id: 3,
        name: "dummy_pelvis",
        parent_bone: "Bip01 Pelvis",
    },
    DummyDefinition {
        id: 4,
        name: "dummy_l_clavicle",
        parent_bone: "Bip01 L Clavicle",
    },
    DummyDefinition {
        id: 5,
        name: "dummy_l_arm",
        parent_bone: "Bip01 L UpperArm",
    },
    DummyDefinition {
        id: 6,
        name: "dummy_l_hand",
        parent_bone: "Bip01 L Hand",
    },
    DummyDefinition {
        id: 7,
        name: "dummy_r_clavicle",
        parent_bone: "Bip01 R Clavicle",
    },
    DummyDefinition {
        id: 8,
        name: "dummy_r_arm",
        parent_bone: "Bip01 R UpperArm",
    },
    DummyDefinition {
        id: 9,
        name: "dummy_r_hand",
        parent_bone: "Bip01 R Hand",
    },
    DummyDefinition {
        id: 10,
        name: "dummy_l_thigh",
        parent_bone: "Bip01 L Thigh",
    },
    DummyDefinition {
        id: 11,
        name: "dummy_l_calf",
        parent_bone: "Bip01 L Calf",
    },
    DummyDefinition {
        id: 12,
        name: "dummy_l_foot",
        parent_bone: "Bip01 L Foot",
    },
    DummyDefinition {
        id: 13,
        name: "dummy_r_thigh",
        parent_bone: "Bip01 R Thigh",
    },
    DummyDefinition {
        id: 14,
        name: "dummy_r_calf",
        parent_bone: "Bip01 R Calf",
    },
    DummyDefinition {
        id: 15,
        name: "dummy_r_foot",
        parent_bone: "Bip01 R Foot",
    },
];

/// Total dummy count matching PKO's LINK_ID_NUM = 24
pub const PKO_DUMMY_COUNT: u32 = 24;

/// Generated dummy node info ready for LAB file
#[derive(Debug, Clone)]
pub struct GeneratedDummy {
    pub id: u32,
    pub parent_bone_id: u32,
    pub matrix: LwMatrix44,
}

/// Generate standard dummy nodes for a retargeted character.
///
/// `bone_name_to_index` maps PKO bone names to their final array indices.
/// Generates dummies at the identity transform relative to their parent bones.
pub fn generate_standard_dummies(bone_name_to_index: &HashMap<String, u32>) -> Vec<GeneratedDummy> {
    let mut dummies = Vec::new();

    for def in STANDARD_DUMMIES {
        let parent_id = bone_name_to_index
            .get(def.parent_bone)
            .copied()
            .unwrap_or(0); // Fallback to root bone if parent not found

        dummies.push(GeneratedDummy {
            id: def.id,
            parent_bone_id: parent_id,
            matrix: LwMatrix44(Matrix4::identity()),
        });
    }

    // Generate additional dummies (16-23) with no specific assignment
    // These are attached to the root bone with identity transform
    let root_id = bone_name_to_index.get("Bip01").copied().unwrap_or(0);
    for id in 16..PKO_DUMMY_COUNT {
        dummies.push(GeneratedDummy {
            id,
            parent_bone_id: root_id,
            matrix: LwMatrix44(Matrix4::identity()),
        });
    }

    dummies
}

/// Convert generated dummies to the format expected by LwBoneDummyInfo
pub fn to_bone_dummy_info(
    dummies: &[GeneratedDummy],
) -> Vec<crate::animation::character::LwBoneDummyInfo> {
    dummies
        .iter()
        .map(|d| crate::animation::character::LwBoneDummyInfo {
            id: d.id,
            parent_bone_id: d.parent_bone_id,
            mat: d.matrix.clone(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::retarget::skeleton::PkoStandardSkeleton;

    #[test]
    fn test_generate_standard_dummies() {
        // Build a bone name → index map from the standard skeleton
        let mut bone_map = HashMap::new();
        for (i, bone) in PkoStandardSkeleton::BONES.iter().enumerate() {
            bone_map.insert(bone.name.to_string(), i as u32);
        }

        let dummies = generate_standard_dummies(&bone_map);

        // Should generate all 24 dummies
        assert_eq!(dummies.len(), PKO_DUMMY_COUNT as usize);

        // Check dummy 0 (base) is attached to Bip01 (index 0)
        assert_eq!(dummies[0].id, 0);
        assert_eq!(dummies[0].parent_bone_id, 0);

        // Check dummy 1 (head) is attached to Bip01 Head (index 5)
        assert_eq!(dummies[1].id, 1);
        assert_eq!(dummies[1].parent_bone_id, 5);

        // Check dummy 9 (right hand) is attached to Bip01 R Hand (index 13)
        assert_eq!(dummies[9].id, 9);
        assert_eq!(dummies[9].parent_bone_id, 13);

        // Check extra dummies (16-23) are attached to root
        for dummy in &dummies[16..] {
            assert_eq!(dummy.parent_bone_id, 0);
        }
    }

    #[test]
    fn test_dummy_ids_unique() {
        let mut bone_map = HashMap::new();
        bone_map.insert("Bip01".to_string(), 0u32);

        let dummies = generate_standard_dummies(&bone_map);

        let mut ids: Vec<u32> = dummies.iter().map(|d| d.id).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), PKO_DUMMY_COUNT as usize);
    }

    #[test]
    fn test_fallback_to_root() {
        // If bone names don't match, should fall back to bone 0
        let bone_map = HashMap::from([("Bip01".to_string(), 0u32)]);
        let dummies = generate_standard_dummies(&bone_map);

        // All dummies should be on bone 0 since only root exists
        for dummy in &dummies {
            assert_eq!(dummy.parent_bone_id, 0);
        }
    }

    #[test]
    fn test_to_bone_dummy_info_conversion() {
        let mut bone_map = HashMap::new();
        bone_map.insert("Bip01".to_string(), 0u32);
        bone_map.insert("Bip01 Head".to_string(), 1u32);

        let generated = generate_standard_dummies(&bone_map);
        let bone_dummies = to_bone_dummy_info(&generated);

        assert_eq!(bone_dummies.len(), generated.len());
        assert_eq!(bone_dummies[0].id, 0);
        assert_eq!(bone_dummies[1].id, 1);
        assert_eq!(bone_dummies[1].parent_bone_id, 1); // Head
    }
}
