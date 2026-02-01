use serde::{Deserialize, Serialize};

/// Game version determines encryption and structure definitions
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GameVersion {
    V1 = 1,
    V2 = 2,
    V3 = 3,
    V4 = 4,
    V5 = 5,
    V6 = 6,
    V7 = 7,
    V8 = 8,
}

impl GameVersion {
    /// Returns true if this version uses encryption
    pub fn uses_encryption(&self) -> bool {
        matches!(
            self,
            GameVersion::V4 | GameVersion::V5 | GameVersion::V6 | GameVersion::V7 | GameVersion::V8
        )
    }
}

/// Field value types parsed from binary data
#[derive(Debug, Clone, PartialEq)]
pub enum FieldValue {
    UByte(u8),
    UShort(u16),
    ULong(u32),
    UQuad(u64),
    Byte(i8),
    Short(i16),
    Long(i32),
    Quad(i64),
    Float(f32),
    Double(f64),
    String(String),
    /// Multiple values (comma-separated in TSV output)
    Multiple(Vec<FieldValue>),
    Skip, // For padding and other non-output fields
}

impl FieldValue {
    /// Convert to TSV string representation
    pub fn to_tsv_string(&self) -> String {
        match self {
            FieldValue::UByte(v) => v.to_string(),
            FieldValue::UShort(v) => v.to_string(),
            FieldValue::ULong(v) => v.to_string(),
            FieldValue::UQuad(v) => v.to_string(),
            FieldValue::Byte(v) => v.to_string(),
            FieldValue::Short(v) => v.to_string(),
            FieldValue::Long(v) => v.to_string(),
            FieldValue::Quad(v) => v.to_string(),
            FieldValue::Float(v) => {
                // Format floats with at least one decimal place
                if v.fract() == 0.0 {
                    format!("{:.1}", v)
                } else {
                    v.to_string()
                }
            }
            FieldValue::Double(v) => {
                // Format doubles with at least one decimal place
                if v.fract() == 0.0 {
                    format!("{:.1}", v)
                } else {
                    v.to_string()
                }
            }
            FieldValue::String(s) => {
                // Replace control characters (newlines, tabs, etc.) with spaces for TSV compatibility
                s.chars()
                    .map(|c| if c.is_control() { ' ' } else { c })
                    .collect()
            }
            FieldValue::Multiple(values) => {
                // Join multiple values with commas (matching Lua decompiler behavior)
                values
                    .iter()
                    .map(|v| v.to_tsv_string())
                    .collect::<Vec<_>>()
                    .join(",")
            }
            FieldValue::Skip => String::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_game_version_encryption() {
        assert!(!GameVersion::V1.uses_encryption());
        assert!(!GameVersion::V2.uses_encryption());
        assert!(!GameVersion::V3.uses_encryption());
        assert!(GameVersion::V4.uses_encryption());
        assert!(GameVersion::V5.uses_encryption());
        assert!(GameVersion::V6.uses_encryption());
        assert!(GameVersion::V7.uses_encryption());
        assert!(GameVersion::V8.uses_encryption());
    }

    #[test]
    fn test_field_value_to_tsv() {
        assert_eq!(FieldValue::UByte(42).to_tsv_string(), "42");
        assert_eq!(FieldValue::UShort(1000).to_tsv_string(), "1000");
        assert_eq!(FieldValue::Long(-123).to_tsv_string(), "-123");
        assert_eq!(FieldValue::Float(3.14).to_tsv_string(), "3.14");
        assert_eq!(FieldValue::Float(5.0).to_tsv_string(), "5.0");
        assert_eq!(
            FieldValue::String("test".to_string()).to_tsv_string(),
            "test"
        );
        assert_eq!(FieldValue::Skip.to_tsv_string(), "");

        // Test multiple values
        let multi = FieldValue::Multiple(vec![
            FieldValue::UShort(100),
            FieldValue::UShort(200),
            FieldValue::UShort(300),
        ]);
        assert_eq!(multi.to_tsv_string(), "100,200,300");
    }
}
