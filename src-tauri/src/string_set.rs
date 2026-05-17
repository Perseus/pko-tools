use std::collections::BTreeMap;
use std::path::Path;

use anyhow::Context;

use crate::text_encoding;

/// Parse Mindpower3D language string tables stored as GBK text with a `.bin`
/// extension. Demon Online's `StringSet.bin` uses lines like:
/// `[123]\t"Chinese text %d\n"`.
pub fn parse_string_set_bytes(data: &[u8]) -> anyhow::Result<BTreeMap<u32, String>> {
    let text = text_encoding::decode_gbk_text(data);
    let mut strings = BTreeMap::new();

    for (line_number, raw_line) in text.lines().enumerate() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }

        let id_end = line.find(']').with_context(|| {
            format!(
                "StringSet line {} is missing closing id bracket",
                line_number + 1
            )
        })?;
        let id = line
            .strip_prefix('[')
            .and_then(|line| line[..id_end - 1].parse::<u32>().ok())
            .with_context(|| format!("StringSet line {} has invalid id", line_number + 1))?;
        let rest = line[id_end + 1..].trim_start();
        let value_start = rest
            .find('"')
            .with_context(|| format!("StringSet line {} is missing value", line_number + 1))?;
        let value = parse_quoted_value(&rest[value_start..]).with_context(|| {
            format!(
                "StringSet line {} has invalid quoted value",
                line_number + 1
            )
        })?;
        strings.insert(id, value);
    }

    Ok(strings)
}

pub fn parse_string_set_file(path: impl AsRef<Path>) -> anyhow::Result<BTreeMap<u32, String>> {
    let path = path.as_ref();
    let data = std::fs::read(path).with_context(|| format!("read {}", path.display()))?;
    parse_string_set_bytes(&data)
}

fn parse_quoted_value(value: &str) -> anyhow::Result<String> {
    anyhow::ensure!(value.starts_with('"'), "quoted value must start with quote");
    let end = value[1..]
        .rfind('"')
        .map(|offset| offset + 1)
        .ok_or_else(|| anyhow::anyhow!("unterminated quoted value"))?;
    Ok(value[1..end].to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_gbk_string_set_lines() {
        let data = [
            b"[0]\t\"chs\"\n".as_slice(),
            b"[1]\t\"".as_slice(),
            &[0xce, 0xde, 0xb7, 0xa8],
            b" ID = %d\\n\"\n".as_slice(),
        ]
        .concat();

        let strings = parse_string_set_bytes(&data).unwrap();

        assert_eq!(strings.len(), 2);
        assert_eq!(strings.get(&0).unwrap(), "chs");
        assert_eq!(strings.get(&1).unwrap(), "无法 ID = %d\\n");
    }

    #[test]
    fn treats_the_last_quote_as_the_string_set_terminator() {
        let strings = parse_string_set_bytes(b"[771]\t\"help\\n\\label\\\"\n").unwrap();

        assert_eq!(strings.get(&771).unwrap(), "help\\n\\label\\");
    }
}
