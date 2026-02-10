use serde::{Deserialize, Serialize};

/// Severity level for a validation item.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ValidationSeverity {
    Error,
    Warning,
    Info,
}

/// Category of a validation item.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ValidationCategory {
    Mesh,
    Skeleton,
    Texture,
    Material,
    Animation,
}

/// A single validation finding.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationItem {
    /// Unique code for this validation rule (e.g. "BONE_COUNT_EXCEEDED").
    pub code: String,
    /// Human-readable description.
    pub message: String,
    /// Severity level.
    pub severity: ValidationSeverity,
    /// Category of the issue.
    pub category: ValidationCategory,
    /// Whether this issue can be automatically fixed.
    pub auto_fixable: bool,
}

/// Complete validation report for a model.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationReport {
    /// All validation findings.
    pub items: Vec<ValidationItem>,
    /// Whether the model passes validation (no errors).
    pub is_valid: bool,
    /// Count of errors.
    pub error_count: u32,
    /// Count of warnings.
    pub warning_count: u32,
    /// Count of info items.
    pub info_count: u32,
}

impl ValidationReport {
    /// Create a new empty report.
    pub fn new() -> Self {
        Self {
            items: vec![],
            is_valid: true,
            error_count: 0,
            warning_count: 0,
            info_count: 0,
        }
    }

    /// Add a validation item and update counts.
    pub fn add(&mut self, item: ValidationItem) {
        match item.severity {
            ValidationSeverity::Error => {
                self.error_count += 1;
                self.is_valid = false;
            }
            ValidationSeverity::Warning => {
                self.warning_count += 1;
            }
            ValidationSeverity::Info => {
                self.info_count += 1;
            }
        }
        self.items.push(item);
    }

    /// Merge another report into this one.
    pub fn merge(&mut self, other: ValidationReport) {
        for item in other.items {
            self.add(item);
        }
    }
}
