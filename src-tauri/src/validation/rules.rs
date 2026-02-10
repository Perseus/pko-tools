use super::limits::*;
use super::report::*;

/// Validate bone count against engine limit.
pub fn validate_bone_count(bone_count: u32) -> Option<ValidationItem> {
    if bone_count > LW_MAX_BONE_NUM {
        Some(ValidationItem {
            code: "BONE_COUNT_EXCEEDED".to_string(),
            message: format!(
                "Bone count ({}) exceeds engine limit ({}). Bones must be reduced before import.",
                bone_count, LW_MAX_BONE_NUM
            ),
            severity: ValidationSeverity::Error,
            category: ValidationCategory::Skeleton,
            auto_fixable: false,
        })
    } else if bone_count > 20 {
        Some(ValidationItem {
            code: "BONE_COUNT_HIGH".to_string(),
            message: format!(
                "Bone count ({}) is close to the engine limit ({}). Consider reducing for compatibility.",
                bone_count, LW_MAX_BONE_NUM
            ),
            severity: ValidationSeverity::Warning,
            category: ValidationCategory::Skeleton,
            auto_fixable: false,
        })
    } else {
        None
    }
}

/// Validate subset/material count against engine limit.
pub fn validate_subset_count(subset_count: u32) -> Option<ValidationItem> {
    if subset_count > LW_MAX_SUBSET_NUM {
        Some(ValidationItem {
            code: "SUBSET_COUNT_EXCEEDED".to_string(),
            message: format!(
                "Subset count ({}) exceeds engine limit ({}). Materials must be merged.",
                subset_count, LW_MAX_SUBSET_NUM
            ),
            severity: ValidationSeverity::Error,
            category: ValidationCategory::Mesh,
            auto_fixable: false,
        })
    } else {
        None
    }
}

/// Validate triangle count against recommended limit.
pub fn validate_triangle_count(triangle_count: u32) -> Option<ValidationItem> {
    if triangle_count > RECOMMENDED_MAX_TRIANGLES * 2 {
        Some(ValidationItem {
            code: "TRIANGLE_COUNT_VERY_HIGH".to_string(),
            message: format!(
                "Triangle count ({}) is very high. The game may have performance issues. Recommended: {}.",
                triangle_count, RECOMMENDED_MAX_TRIANGLES
            ),
            severity: ValidationSeverity::Warning,
            category: ValidationCategory::Mesh,
            auto_fixable: false,
        })
    } else if triangle_count > RECOMMENDED_MAX_TRIANGLES {
        Some(ValidationItem {
            code: "TRIANGLE_COUNT_HIGH".to_string(),
            message: format!(
                "Triangle count ({}) exceeds recommended limit ({}). Consider optimizing.",
                triangle_count, RECOMMENDED_MAX_TRIANGLES
            ),
            severity: ValidationSeverity::Info,
            category: ValidationCategory::Mesh,
            auto_fixable: false,
        })
    } else {
        None
    }
}

/// Validate blend weight count per vertex.
pub fn validate_blend_weights(max_influences: u32) -> Option<ValidationItem> {
    if max_influences > LW_MAX_BLENDWEIGHT_NUM {
        Some(ValidationItem {
            code: "BLEND_WEIGHT_EXCEEDED".to_string(),
            message: format!(
                "Some vertices have {} bone influences. Engine limit is {}. Extra weights will be normalized.",
                max_influences, LW_MAX_BLENDWEIGHT_NUM
            ),
            severity: ValidationSeverity::Warning,
            category: ValidationCategory::Mesh,
            auto_fixable: true,
        })
    } else {
        None
    }
}

/// Validate texture dimensions.
pub fn validate_texture_dimensions(width: u32, height: u32) -> Vec<ValidationItem> {
    let mut items = vec![];

    if width > MAX_TEXTURE_DIMENSION || height > MAX_TEXTURE_DIMENSION {
        items.push(ValidationItem {
            code: "TEXTURE_TOO_LARGE".to_string(),
            message: format!(
                "Texture dimensions ({}x{}) exceed maximum ({}). Will be resized.",
                width, height, MAX_TEXTURE_DIMENSION
            ),
            severity: ValidationSeverity::Warning,
            category: ValidationCategory::Texture,
            auto_fixable: true,
        });
    }

    if !width.is_power_of_two() || !height.is_power_of_two() {
        items.push(ValidationItem {
            code: "TEXTURE_NOT_POT".to_string(),
            message: format!(
                "Texture dimensions ({}x{}) are not power-of-two. Will be resized.",
                width, height
            ),
            severity: ValidationSeverity::Warning,
            category: ValidationCategory::Texture,
            auto_fixable: true,
        });
    }

    items
}

/// Check for missing normals.
pub fn validate_normals(has_normals: bool) -> Option<ValidationItem> {
    if !has_normals {
        Some(ValidationItem {
            code: "MISSING_NORMALS".to_string(),
            message: "Model has no vertex normals. Lighting will not work correctly in game.".to_string(),
            severity: ValidationSeverity::Error,
            category: ValidationCategory::Mesh,
            auto_fixable: false,
        })
    } else {
        None
    }
}

/// Check for missing texture coordinates.
pub fn validate_texcoords(has_texcoords: bool) -> Option<ValidationItem> {
    if !has_texcoords {
        Some(ValidationItem {
            code: "MISSING_TEXCOORDS".to_string(),
            message: "Model has no texture coordinates. Textures will not display.".to_string(),
            severity: ValidationSeverity::Warning,
            category: ValidationCategory::Mesh,
            auto_fixable: false,
        })
    } else {
        None
    }
}

/// Check for missing base color texture.
pub fn validate_has_texture(has_texture: bool) -> Option<ValidationItem> {
    if !has_texture {
        Some(ValidationItem {
            code: "MISSING_TEXTURE".to_string(),
            message: "Material has no base color texture. A default texture will be used.".to_string(),
            severity: ValidationSeverity::Info,
            category: ValidationCategory::Material,
            auto_fixable: false,
        })
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bone_count_below_limit() {
        assert!(validate_bone_count(10).is_none());
    }

    #[test]
    fn bone_count_at_limit() {
        // At-limit should produce a warning (close to limit), not an error
        let item = validate_bone_count(25).unwrap();
        assert_eq!(item.severity, ValidationSeverity::Warning);
    }

    #[test]
    fn bone_count_above_limit() {
        let item = validate_bone_count(30).unwrap();
        assert_eq!(item.severity, ValidationSeverity::Error);
        assert_eq!(item.code, "BONE_COUNT_EXCEEDED");
    }

    #[test]
    fn bone_count_near_limit_warns() {
        let item = validate_bone_count(22).unwrap();
        assert_eq!(item.severity, ValidationSeverity::Warning);
    }

    #[test]
    fn subset_count_below_limit() {
        assert!(validate_subset_count(5).is_none());
    }

    #[test]
    fn subset_count_above_limit() {
        let item = validate_subset_count(20).unwrap();
        assert_eq!(item.severity, ValidationSeverity::Error);
    }

    #[test]
    fn triangle_count_below_recommended() {
        assert!(validate_triangle_count(2000).is_none());
    }

    #[test]
    fn triangle_count_above_recommended() {
        let item = validate_triangle_count(4000).unwrap();
        assert_eq!(item.severity, ValidationSeverity::Info);
    }

    #[test]
    fn triangle_count_very_high() {
        let item = validate_triangle_count(8000).unwrap();
        assert_eq!(item.severity, ValidationSeverity::Warning);
    }

    #[test]
    fn blend_weights_within_limit() {
        assert!(validate_blend_weights(4).is_none());
    }

    #[test]
    fn blend_weights_exceeded() {
        let item = validate_blend_weights(6).unwrap();
        assert!(item.auto_fixable);
    }

    #[test]
    fn texture_dimensions_pot() {
        assert!(validate_texture_dimensions(256, 512).is_empty());
    }

    #[test]
    fn texture_dimensions_npot() {
        let items = validate_texture_dimensions(300, 500);
        assert!(items.iter().any(|i| i.code == "TEXTURE_NOT_POT"));
    }

    #[test]
    fn texture_dimensions_too_large() {
        let items = validate_texture_dimensions(4096, 4096);
        assert!(items.iter().any(|i| i.code == "TEXTURE_TOO_LARGE"));
    }

    #[test]
    fn missing_normals_error() {
        let item = validate_normals(false).unwrap();
        assert_eq!(item.severity, ValidationSeverity::Error);
    }

    #[test]
    fn has_normals_ok() {
        assert!(validate_normals(true).is_none());
    }
}
