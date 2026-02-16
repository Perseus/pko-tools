//! GLB (Binary glTF) container writer.
//!
//! Writes a glTF JSON string and binary buffer into the standard GLB format:
//! - 12-byte file header (magic, version 2, total length)
//! - JSON chunk (type 0x4E4F534A, padded to 4-byte alignment with spaces)
//! - BIN chunk (type 0x004E4942, padded to 4-byte alignment with \0)

use std::io::Write;
use std::path::Path;

use anyhow::{Context, Result};

const GLB_MAGIC: u32 = 0x46546C67; // "glTF"
const GLB_VERSION: u32 = 2;
const GLB_HEADER_SIZE: u32 = 12;
const CHUNK_HEADER_SIZE: u32 = 8;
const CHUNK_TYPE_JSON: u32 = 0x4E4F534A;
const CHUNK_TYPE_BIN: u32 = 0x004E4942;

/// Write a GLB file from a glTF JSON string and binary buffer.
pub fn write_glb(json_str: &str, bin_data: &[u8], path: &Path) -> Result<()> {
    let json_bytes = json_str.as_bytes();

    // Pad JSON to 4-byte alignment with spaces (0x20)
    let json_padding = (4 - (json_bytes.len() % 4)) % 4;
    let json_chunk_length = json_bytes.len() + json_padding;

    // Pad BIN to 4-byte alignment with null bytes (0x00)
    let bin_padding = (4 - (bin_data.len() % 4)) % 4;
    let bin_chunk_length = bin_data.len() + bin_padding;

    let total_length = GLB_HEADER_SIZE
        + CHUNK_HEADER_SIZE
        + json_chunk_length as u32
        + CHUNK_HEADER_SIZE
        + bin_chunk_length as u32;

    let file =
        std::fs::File::create(path).with_context(|| format!("Failed to create GLB: {}", path.display()))?;
    let mut w = std::io::BufWriter::new(file);

    // File header
    w.write_all(&GLB_MAGIC.to_le_bytes())?;
    w.write_all(&GLB_VERSION.to_le_bytes())?;
    w.write_all(&total_length.to_le_bytes())?;

    // JSON chunk
    w.write_all(&(json_chunk_length as u32).to_le_bytes())?;
    w.write_all(&CHUNK_TYPE_JSON.to_le_bytes())?;
    w.write_all(json_bytes)?;
    for _ in 0..json_padding {
        w.write_all(&[0x20])?;
    }

    // BIN chunk
    w.write_all(&(bin_chunk_length as u32).to_le_bytes())?;
    w.write_all(&CHUNK_TYPE_BIN.to_le_bytes())?;
    w.write_all(bin_data)?;
    for _ in 0..bin_padding {
        w.write_all(&[0x00])?;
    }

    w.flush()?;
    Ok(())
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_write_glb_valid_header() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("test.glb");

        let json = r#"{"asset":{"version":"2.0"}}"#;
        let bin = vec![0u8; 16];

        write_glb(json, &bin, &path).unwrap();

        let data = std::fs::read(&path).unwrap();

        // Check magic
        let magic = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
        assert_eq!(magic, GLB_MAGIC);

        // Check version
        let version = u32::from_le_bytes([data[4], data[5], data[6], data[7]]);
        assert_eq!(version, 2);

        // Check total length matches file size
        let total_len = u32::from_le_bytes([data[8], data[9], data[10], data[11]]);
        assert_eq!(total_len as usize, data.len());

        // Check JSON chunk type
        let json_chunk_type = u32::from_le_bytes([data[16], data[17], data[18], data[19]]);
        assert_eq!(json_chunk_type, CHUNK_TYPE_JSON);
    }

    #[test]
    fn test_write_glb_alignment() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("aligned.glb");

        // JSON that's not 4-byte aligned (25 bytes → needs 3 bytes padding)
        let json = r#"{"asset":{"version":"2"}}"#;
        // BIN that's not 4-byte aligned (5 bytes → needs 3 bytes padding)
        let bin = vec![1, 2, 3, 4, 5];

        write_glb(json, &bin, &path).unwrap();

        let data = std::fs::read(&path).unwrap();

        // Total length must be 4-byte aligned
        assert_eq!(data.len() % 4, 0);

        // JSON chunk length (at offset 12) must be 4-byte aligned
        let json_chunk_len = u32::from_le_bytes([data[12], data[13], data[14], data[15]]);
        assert_eq!(json_chunk_len % 4, 0);

        // BIN chunk starts after header + JSON chunk header + JSON data
        let bin_offset = (GLB_HEADER_SIZE + CHUNK_HEADER_SIZE + json_chunk_len) as usize;
        let bin_chunk_len =
            u32::from_le_bytes([data[bin_offset], data[bin_offset + 1], data[bin_offset + 2], data[bin_offset + 3]]);
        assert_eq!(bin_chunk_len % 4, 0);
    }

    #[test]
    fn test_write_glb_roundtrip_json() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("roundtrip.glb");

        let json = r#"{"asset":{"version":"2.0"},"scene":0}"#;
        let bin = vec![0u8; 8];

        write_glb(json, &bin, &path).unwrap();

        let data = std::fs::read(&path).unwrap();

        // Extract JSON chunk
        let json_chunk_len =
            u32::from_le_bytes([data[12], data[13], data[14], data[15]]) as usize;
        let json_bytes = &data[20..20 + json_chunk_len];

        // Trim padding spaces
        let json_str = std::str::from_utf8(json_bytes).unwrap().trim_end();
        assert_eq!(json_str, json);
    }
}
