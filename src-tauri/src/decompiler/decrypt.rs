use crate::decompiler::error::{DecompilerError, Result};
use crate::decompiler::types::GameVersion;

/// XOR encryption key used by the game
/// From Lua decompiler: {152,157,159,104,224,102,171,112,233,209,224,224,203,221,209,203,213,207}
const ENCRYPTION_KEY: [u8; 18] = [
    152, 157, 159, 104, 224, 102, 171, 112, 233, 209, 224, 224, 203, 221, 209, 203, 213, 207,
];

/// Decrypt a buffer using XOR cipher with the encryption key
///
/// The algorithm from Lua:
/// decrypted_byte = ((encrypted_byte - encryption_key[i % 18]) + 256) % 256
pub fn decrypt_buffer(buffer: &mut [u8]) {
    let key_len = ENCRYPTION_KEY.len();

    for (i, byte) in buffer.iter_mut().enumerate() {
        let key_byte = ENCRYPTION_KEY[i % key_len];
        // Wrapping subtraction to handle underflow
        *byte = byte.wrapping_sub(key_byte);
    }
}

/// Detect game version by attempting to parse the first record
///
/// Strategy: CharacterInfo files have a Name field at offset 8 (72 bytes).
/// - Unencrypted (V1-V3): Name contains readable ASCII
/// - Encrypted (V4-V8): Name is garbage until decrypted
///
/// We try both and see which produces valid-looking text.
pub fn detect_version(data: &[u8]) -> Result<GameVersion> {
    if data.len() < 4 {
        return Err(DecompilerError::InvalidFormat(
            "File too short for version detection".to_string(),
        ));
    }

    // Read record size
    let record_size = u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as usize;

    if record_size < 2 {
        return Err(DecompilerError::InvalidFormat(
            "Invalid record size for version detection".to_string(),
        ));
    }

    let record_data_size = record_size - 1;

    // Check if we have at least one complete record
    if data.len() < 4 + record_data_size {
        return Err(DecompilerError::InvalidFormat(
            "File too short to contain one record".to_string(),
        ));
    }

    // Check if we have enough data for the Name field (offset 8, 72 bytes)
    if record_data_size < 8 + 72 {
        return Err(DecompilerError::InvalidFormat(
            "Record too short for CharacterInfo structure".to_string(),
        ));
    }

    // Get first record
    let first_record = &data[4..4 + record_data_size];

    // Try unencrypted first (V1-V3)
    if is_valid_name_field(&first_record[8..8 + 72]) {
        return Ok(GameVersion::V1);
    }

    // Try encrypted (V4-V8) - decrypt a copy and check
    let mut decrypted = first_record.to_vec();
    decrypt_buffer(&mut decrypted);

    if is_valid_name_field(&decrypted[8..8 + 72]) {
        // Default to V4 for encrypted files
        // Could be V5-V8, but they all use the same encryption
        return Ok(GameVersion::V4);
    }

    // If neither works, default to V1
    Ok(GameVersion::V1)
}

/// Check if a buffer looks like a valid character name
///
/// Valid names should:
/// - Start with printable ASCII (if not null-terminated at start)
/// - Contain mostly printable ASCII characters
/// - Be null-terminated or padded with nulls
fn is_valid_name_field(name_bytes: &[u8]) -> bool {
    // Empty name (all nulls) is valid
    if name_bytes.iter().all(|&b| b == 0) {
        return true;
    }

    // Find the null terminator
    let name_end = name_bytes
        .iter()
        .position(|&b| b == 0)
        .unwrap_or(name_bytes.len());

    if name_end == 0 {
        return true; // Empty name is valid
    }

    // Check if the name part contains valid ASCII
    let name_part = &name_bytes[0..name_end];

    // Count printable ASCII characters (space through ~)
    let printable_count = name_part
        .iter()
        .filter(|&&b| b >= 0x20 && b <= 0x7E)
        .count();

    // At least 80% should be printable ASCII, and at least one character
    name_part.len() > 0 && (printable_count as f32 / name_part.len() as f32) >= 0.8
}

/// Read and decrypt records from binary file
///
/// File format:
/// - First 4 bytes: record size (little-endian u32) - includes the 4-byte size itself
/// - Remaining bytes: records of (record_size - 1) bytes each
///
/// Returns a vector of decrypted record buffers
pub fn read_encrypted_records(data: &[u8], version: GameVersion) -> Result<Vec<Vec<u8>>> {
    if data.len() < 4 {
        return Err(DecompilerError::InvalidFormat(
            "File too short for size header".to_string(),
        ));
    }

    // Read record size from first 4 bytes (little-endian)
    let record_size = u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as usize;

    if record_size == 0 {
        return Err(DecompilerError::InvalidFormat(
            "Invalid record size: 0".to_string(),
        ));
    }

    // The record size from the header is the actual size of each record
    // (not including the 4-byte header itself)
    let record_data_size = record_size;

    // Split into records
    let record_data = &data[4..];
    let num_records = record_data.len() / record_data_size;

    let mut records = Vec::with_capacity(num_records);

    for i in 0..num_records {
        let start = i * record_data_size;
        let end = start + record_data_size;

        if end > record_data.len() {
            // Partial record at end of file - skip it
            break;
        }

        let mut record = record_data[start..end].to_vec();

        // Decrypt if version requires it
        if version.uses_encryption() {
            decrypt_buffer(&mut record);
        }

        records.push(record);
    }

    Ok(records)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decrypt_buffer() {
        // Test basic XOR decryption
        let mut data = vec![152, 157, 159]; // First 3 bytes of key
        decrypt_buffer(&mut data);
        assert_eq!(data, vec![0, 0, 0]); // Should decrypt to zeros

        // Test wrapping behavior
        let mut data = vec![0, 0, 0];
        decrypt_buffer(&mut data);
        assert_eq!(data, vec![104, 99, 97]); // wrapping_sub with key bytes
    }

    #[test]
    fn test_read_encrypted_records_invalid() {
        // Too short
        let data = vec![1, 2, 3];
        assert!(read_encrypted_records(&data, GameVersion::V1).is_err());

        // Zero size
        let data = vec![0, 0, 0, 0, 1, 2, 3];
        assert!(read_encrypted_records(&data, GameVersion::V1).is_err());
    }

    #[test]
    fn test_read_encrypted_records_simple() {
        // Record size: 4 (means 4 bytes per record)
        // 2 records of 4 bytes each
        let data = vec![
            4, 0, 0, 0, // size = 4
            1, 2, 3, 4, // record 1
            5, 6, 7, 8, // record 2
        ];

        let records = read_encrypted_records(&data, GameVersion::V1).unwrap();
        assert_eq!(records.len(), 2);
        assert_eq!(records[0], vec![1, 2, 3, 4]);
        assert_eq!(records[1], vec![5, 6, 7, 8]);
    }

    #[test]
    fn test_read_encrypted_records_with_encryption() {
        // Record size: 4 (means 4 bytes per record)
        // 1 record that will be decrypted
        let mut encrypted_data: Vec<u8> = vec![1, 2, 3, 4];
        let original_data = encrypted_data.clone();

        // Encrypt it first (apply encryption)
        for (i, byte) in encrypted_data.iter_mut().enumerate() {
            *byte = (*byte).wrapping_add(ENCRYPTION_KEY[i % ENCRYPTION_KEY.len()]);
        }

        let data = vec![
            4,
            0,
            0,
            0, // size = 4
            encrypted_data[0],
            encrypted_data[1],
            encrypted_data[2],
            encrypted_data[3],
        ];

        // V4 uses encryption
        let records = read_encrypted_records(&data, GameVersion::V4).unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0], original_data);
    }

    #[test]
    fn test_partial_record_handling() {
        // Record size: 4 (means 4 bytes per record)
        // 1.5 records - should only get 1 record
        let data = vec![
            4, 0, 0, 0, // size = 4
            1, 2, 3, 4, // record 1 (complete)
            5, 6, // partial record 2 (incomplete)
        ];

        let records = read_encrypted_records(&data, GameVersion::V1).unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0], vec![1, 2, 3, 4]);
    }

    #[test]
    fn test_is_valid_name_field() {
        // All nulls - valid
        let nulls = vec![0u8; 72];
        assert!(is_valid_name_field(&nulls));

        // Valid ASCII name
        let mut valid_name = vec![0u8; 72];
        valid_name[..4].copy_from_slice(b"Test");
        assert!(is_valid_name_field(&valid_name));

        // Valid longer name
        let mut valid_name2 = vec![0u8; 72];
        valid_name2[..12].copy_from_slice(b"TestCharName");
        assert!(is_valid_name_field(&valid_name2));

        // Random garbage - should be invalid
        let garbage = vec![0xFF, 0xFE, 0xFD, 0xFC, 0xFB, 0xFA, 0xF9, 0xF8];
        let mut garbage_name = vec![0u8; 72];
        garbage_name[..8].copy_from_slice(&garbage);
        assert!(!is_valid_name_field(&garbage_name));
    }

    #[test]
    fn test_detect_version_unencrypted() {
        // Create a mock CharacterInfo record (unencrypted)
        let record_size = 1000u32; // Large enough for CharacterInfo
        let record_data_size = (record_size - 1) as usize;

        let mut data = Vec::new();
        data.extend_from_slice(&record_size.to_le_bytes());

        // Create one record with Name at offset 8
        let mut record = vec![0u8; record_data_size];
        record[0..4].copy_from_slice(&1u32.to_le_bytes()); // padding
        record[4..8].copy_from_slice(&12345u32.to_le_bytes()); // ID
        record[8..20].copy_from_slice(b"TestCharName"); // Name (valid ASCII)

        data.extend_from_slice(&record);

        let version = detect_version(&data).unwrap();
        assert_eq!(version, GameVersion::V1);
    }

    #[test]
    fn test_detect_version_encrypted() {
        // Create a mock CharacterInfo record (encrypted)
        let record_size = 1000u32;
        let record_data_size = (record_size - 1) as usize;

        let mut data = Vec::new();
        data.extend_from_slice(&record_size.to_le_bytes());

        // Create one record with Name at offset 8
        let mut record = vec![0u8; record_data_size];
        record[0..4].copy_from_slice(&1u32.to_le_bytes()); // padding
        record[4..8].copy_from_slice(&12345u32.to_le_bytes()); // ID
        record[8..20].copy_from_slice(b"TestCharName"); // Name (valid ASCII)

        // Encrypt it
        for (i, byte) in record.iter_mut().enumerate() {
            *byte = (*byte).wrapping_add(ENCRYPTION_KEY[i % ENCRYPTION_KEY.len()]);
        }

        data.extend_from_slice(&record);

        let version = detect_version(&data).unwrap();
        assert_eq!(version, GameVersion::V4);
    }
}
