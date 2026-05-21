use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::path::Path;

const RBO_SUMMARY_SAMPLE_LIMIT: usize = 16;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct RboBounds {
    pub min_x: f32,
    pub min_y: f32,
    pub min_z: f32,
    pub max_x: f32,
    pub max_y: f32,
    pub max_z: f32,
}

impl RboBounds {
    fn from_record(record: &RboRecordInfo) -> Self {
        Self {
            min_x: record.x,
            min_y: record.y,
            min_z: record.z,
            max_x: record.x,
            max_y: record.y,
            max_z: record.z,
        }
    }

    fn include(&mut self, record: &RboRecordInfo) {
        self.min_x = self.min_x.min(record.x);
        self.min_y = self.min_y.min(record.y);
        self.min_z = self.min_z.min(record.z);
        self.max_x = self.max_x.max(record.x);
        self.max_y = self.max_y.max(record.y);
        self.max_z = self.max_z.max(record.z);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RboSummary {
    pub present: bool,
    pub byte_len: u64,
    pub record_count: u32,
    pub distinct_type_ids: Vec<i32>,
    pub sample_records: Vec<RboRecordSample>,
    pub bounds: Option<RboBounds>,
    pub warning_count: u32,
    pub first_warning: Option<String>,
}

impl RboSummary {
    pub fn missing() -> Self {
        Self {
            present: false,
            byte_len: 0,
            record_count: 0,
            distinct_type_ids: Vec::new(),
            sample_records: Vec::new(),
            bounds: None,
            warning_count: 0,
            first_warning: None,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct RboRecordSample {
    pub type_id: i32,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub yaw: f32,
    pub terrain_height: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RboParseResult {
    pub records: Vec<RboRecordInfo>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RboRecordPage {
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
    pub warning_count: u32,
    pub first_warning: Option<String>,
    pub items: Vec<RboRecordInfo>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct RboRecordInfo {
    pub index: u32,
    pub line_number: u32,
    pub type_id: i32,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub yaw: f32,
    pub qx: f32,
    pub qy: f32,
    pub qz: f32,
    pub terrain_height: f32,
}

impl RboRecordInfo {
    fn sample(self) -> RboRecordSample {
        RboRecordSample {
            type_id: self.type_id,
            x: self.x,
            y: self.y,
            z: self.z,
            yaw: self.yaw,
            terrain_height: self.terrain_height,
        }
    }
}

pub fn summarize_rbo_file(path: &Path) -> Result<RboSummary> {
    if !path.exists() {
        return Ok(RboSummary::missing());
    }

    let bytes = std::fs::read(path)?;
    Ok(summarize_rbo_bytes(&bytes, bytes.len() as u64))
}

pub fn summarize_rbo_bytes(bytes: &[u8], byte_len: u64) -> RboSummary {
    let mut type_ids = BTreeSet::new();
    let mut bounds: Option<RboBounds> = None;
    let mut sample_records = Vec::new();
    let parsed = parse_rbo_records(bytes);

    for record in &parsed.records {
        type_ids.insert(record.type_id);
        if sample_records.len() < RBO_SUMMARY_SAMPLE_LIMIT {
            sample_records.push(record.sample());
        }
        match &mut bounds {
            Some(bounds) => bounds.include(record),
            None => bounds = Some(RboBounds::from_record(record)),
        }
    }

    RboSummary {
        present: true,
        byte_len,
        record_count: parsed.records.len().min(u32::MAX as usize) as u32,
        distinct_type_ids: type_ids.into_iter().collect(),
        sample_records,
        bounds,
        warning_count: parsed.warnings.len().min(u32::MAX as usize) as u32,
        first_warning: parsed.warnings.first().cloned(),
    }
}

pub fn parse_rbo_records(bytes: &[u8]) -> RboParseResult {
    let text = String::from_utf8_lossy(bytes);
    let mut records = Vec::new();
    let mut warnings = Vec::new();
    let mut seen_content = false;

    for (line_index, line) in text.lines().enumerate() {
        let line_number = line_index + 1;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if !seen_content && trimmed.starts_with("\\\\") {
            seen_content = true;
            continue;
        }
        seen_content = true;

        let record_index = records.len().min(u32::MAX as usize) as u32;
        match parse_rbo_record_line(trimmed, line_number, record_index) {
            Ok(record) => {
                records.push(record);
            }
            Err(warning) => {
                warnings.push(warning);
            }
        }
    }

    RboParseResult { records, warnings }
}

fn parse_rbo_record_line(
    line: &str,
    line_number: usize,
    index: u32,
) -> std::result::Result<RboRecordInfo, String> {
    let fields: Vec<&str> = line.split_whitespace().collect();
    if fields.len() != 9 {
        return Err(format!(
            "line {line_number} has {} fields; expected 9",
            fields.len()
        ));
    }

    Ok(RboRecordInfo {
        index,
        line_number: line_number.min(u32::MAX as usize) as u32,
        type_id: parse_i32(fields[0], line_number, "typeID")?,
        x: parse_f32(fields[1], line_number, "x")?,
        y: parse_f32(fields[2], line_number, "y")?,
        z: parse_f32(fields[3], line_number, "z")?,
        yaw: parse_f32(fields[4], line_number, "yaw")?,
        qx: parse_f32(fields[5], line_number, "qx")?,
        qy: parse_f32(fields[6], line_number, "qy")?,
        qz: parse_f32(fields[7], line_number, "qz")?,
        terrain_height: parse_f32(fields[8], line_number, "terrainHeight")?,
    })
}

fn parse_i32(
    value: &str,
    line_number: usize,
    field_name: &str,
) -> std::result::Result<i32, String> {
    value
        .parse::<i32>()
        .map_err(|_| format!("line {line_number} field {field_name} is not a valid integer"))
}

fn parse_f32(
    value: &str,
    line_number: usize,
    field_name: &str,
) -> std::result::Result<f32, String> {
    let parsed = value
        .parse::<f32>()
        .map_err(|_| format!("line {line_number} field {field_name} is not a valid float"))?;

    if !parsed.is_finite() {
        return Err(format!(
            "line {line_number} field {field_name} is not a finite float"
        ));
    }

    Ok(parsed)
}
