/// Decode fixed-width CRawData strings used by MindPower client table binaries.
///
/// The original clients store user-facing Chinese text in GBK-compatible byte
/// strings. ASCII paths remain unchanged under GBK, so this is also safe for
/// resource filenames in the same record structures.
pub fn decode_gbk_cstr(bytes: &[u8]) -> String {
    let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
    decode_gbk_text(&bytes[..end]).trim().to_string()
}

pub fn decode_gbk_text(bytes: &[u8]) -> String {
    let (decoded, _, _) = encoding_rs::GBK.decode(bytes);
    decoded.to_string()
}

pub fn read_gbk_cstr(data: &[u8], offset: usize, max_len: usize) -> Option<String> {
    data.get(offset..offset + max_len).map(decode_gbk_cstr)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_gbk_chinese_fixed_string() {
        // "测试" encoded as GBK, followed by a null terminator and padding.
        let bytes = [0xb2, 0xe2, 0xca, 0xd4, 0, b'x'];
        assert_eq!(decode_gbk_cstr(&bytes), "测试");
    }

    #[test]
    fn leaves_ascii_resource_paths_unchanged() {
        assert_eq!(
            decode_gbk_cstr(b"texture/effect/fire01.tga\0"),
            "texture/effect/fire01.tga"
        );
    }

    #[test]
    fn decodes_gbk_text_without_trimming_or_cstr_cutoff() {
        let bytes = [0xb2, 0xe2, 0xca, 0xd4, b'\n', b' '];
        assert_eq!(decode_gbk_text(&bytes), "测试\n ");
    }
}
