use crate::decompiler::error::Result;
use crate::decompiler::parser::ParserState;
use crate::decompiler::types::FieldValue;
use std::io::{Read, Seek};

/// Parser type enum defines all supported parsing operations
#[derive(Debug, Clone)]
pub enum ParserType {
    UByte,
    UShort,
    ULong,
    UQuad,
    Byte,
    Short,
    Long,
    Quad,
    Float,
    Double,
    /// Parse null-terminated string
    Char,
    /// Parse fixed-length string (max length, stops at null but advances full length)
    CharFixed(usize),
    /// Skip N bytes (padding)
    Pad(usize),
    /// Save current position to stack
    SavePos,
    /// Load saved position from stack
    LoadPos,
    /// Repeat a parser N times (only the last value is kept)
    Repeat(Box<ParserType>, usize),
    /// Repeat a parser N times and collect all values (comma-separated output)
    RepeatMulti(Box<ParserType>, usize),
    /// Sequence of parsers (only last value is kept)
    Sequence(Vec<ParserType>),
}

impl ParserType {
    /// Parse using this parser type and return the field value
    pub fn parse<R: Read + Seek>(&self, state: &mut ParserState<R>) -> Result<FieldValue> {
        match self {
            ParserType::UByte => state.parse_ubyte().map(FieldValue::UByte),
            ParserType::UShort => state.parse_ushort().map(FieldValue::UShort),
            ParserType::ULong => state.parse_ulong().map(FieldValue::ULong),
            ParserType::UQuad => state.parse_uquad().map(FieldValue::UQuad),
            ParserType::Byte => state.parse_byte().map(FieldValue::Byte),
            ParserType::Short => state.parse_short().map(FieldValue::Short),
            ParserType::Long => state.parse_long().map(FieldValue::Long),
            ParserType::Quad => state.parse_quad().map(FieldValue::Quad),
            ParserType::Float => state.parse_float().map(FieldValue::Float),
            ParserType::Double => state.parse_double().map(FieldValue::Double),
            ParserType::Char => state.parse_char().map(FieldValue::String),
            ParserType::CharFixed(len) => state.parse_char_fixed(*len).map(FieldValue::String),
            ParserType::Pad(count) => {
                state.pad(*count)?;
                Ok(FieldValue::Skip)
            }
            ParserType::SavePos => {
                state.save_position();
                Ok(FieldValue::Skip)
            }
            ParserType::LoadPos => {
                state.load_position()?;
                Ok(FieldValue::Skip)
            }
            ParserType::Repeat(parser, count) => {
                let mut last_value = FieldValue::Skip;
                for _ in 0..*count {
                    last_value = parser.parse(state)?;
                }
                Ok(last_value)
            }
            ParserType::RepeatMulti(parser, count) => {
                let mut values = Vec::new();
                for _ in 0..*count {
                    let value = parser.parse(state)?;
                    // Skip "Skip" values (padding, etc.)
                    if !matches!(value, FieldValue::Skip) {
                        values.push(value);
                    }
                }
                Ok(FieldValue::Multiple(values))
            }
            ParserType::Sequence(parsers) => {
                let mut last_value = FieldValue::Skip;
                for parser in parsers {
                    last_value = parser.parse(state)?;
                }
                Ok(last_value)
            }
        }
    }
}

/// Field definition - a named parser
#[derive(Debug, Clone)]
pub struct FieldDef {
    name: String,
    parser: ParserType,
}

impl FieldDef {
    pub fn new(name: impl Into<String>, parser: ParserType) -> Self {
        Self {
            name: name.into(),
            parser,
        }
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn parse<R: Read + Seek>(&self, state: &mut ParserState<R>) -> Result<FieldValue> {
        self.parser.parse(state)
    }
}

/// Structure definition for a binary record format
#[derive(Debug, Clone)]
pub struct Structure {
    name: String,
    fields: Vec<FieldDef>,
}

impl Structure {
    /// Get the structure name
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Get field names (excludes padding fields)
    pub fn field_names(&self) -> Vec<String> {
        self.fields
            .iter()
            .filter(|f| !f.name.starts_with('_'))
            .map(|f| f.name.clone())
            .collect()
    }

    /// Parse a complete record using this structure
    pub fn parse_record<R: Read + Seek>(
        &self,
        state: &mut ParserState<R>,
    ) -> Result<Vec<FieldValue>> {
        let mut values = Vec::new();

        for field in &self.fields {
            let value = field.parse(state)?;
            values.push(value);
        }

        Ok(values)
    }
}

/// Builder for constructing Structure definitions
pub struct StructureBuilder {
    name: String,
    fields: Vec<FieldDef>,
}

impl StructureBuilder {
    /// Create a new structure builder
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            fields: Vec::new(),
        }
    }

    // === Primitive field builders ===

    /// Add an unsigned byte field
    pub fn field_ubyte(mut self, name: impl Into<String>) -> Self {
        self.fields.push(FieldDef::new(name, ParserType::UByte));
        self
    }

    /// Add an unsigned short (u16) field
    pub fn field_ushort(mut self, name: impl Into<String>) -> Self {
        self.fields.push(FieldDef::new(name, ParserType::UShort));
        self
    }

    /// Add an unsigned long (u32) field
    pub fn field_ulong(mut self, name: impl Into<String>) -> Self {
        self.fields.push(FieldDef::new(name, ParserType::ULong));
        self
    }

    /// Add an unsigned quad (u64) field
    pub fn field_uquad(mut self, name: impl Into<String>) -> Self {
        self.fields.push(FieldDef::new(name, ParserType::UQuad));
        self
    }

    /// Add a signed byte (i8) field
    pub fn field_byte(mut self, name: impl Into<String>) -> Self {
        self.fields.push(FieldDef::new(name, ParserType::Byte));
        self
    }

    /// Add a signed short (i16) field
    pub fn field_short(mut self, name: impl Into<String>) -> Self {
        self.fields.push(FieldDef::new(name, ParserType::Short));
        self
    }

    /// Add a signed long (i32) field
    pub fn field_long(mut self, name: impl Into<String>) -> Self {
        self.fields.push(FieldDef::new(name, ParserType::Long));
        self
    }

    /// Add a signed quad (i64) field
    pub fn field_quad(mut self, name: impl Into<String>) -> Self {
        self.fields.push(FieldDef::new(name, ParserType::Quad));
        self
    }

    /// Add a float (f32) field
    pub fn field_float(mut self, name: impl Into<String>) -> Self {
        self.fields.push(FieldDef::new(name, ParserType::Float));
        self
    }

    /// Add a double (f64) field
    pub fn field_double(mut self, name: impl Into<String>) -> Self {
        self.fields.push(FieldDef::new(name, ParserType::Double));
        self
    }

    /// Add a null-terminated string field
    pub fn field_char(mut self, name: impl Into<String>) -> Self {
        self.fields.push(FieldDef::new(name, ParserType::Char));
        self
    }

    /// Add a fixed-length string field (reads up to max_len bytes, stops at null)
    pub fn field_char_fixed(mut self, name: impl Into<String>, max_len: usize) -> Self {
        self.fields
            .push(FieldDef::new(name, ParserType::CharFixed(max_len)));
        self
    }

    // === Special operations ===

    /// Skip N bytes (padding)
    pub fn pad(mut self, count: usize) -> Self {
        self.fields.push(FieldDef::new(
            format!("_pad{}", self.fields.len()),
            ParserType::Pad(count),
        ));
        self
    }

    /// Save current position to stack
    pub fn save_pos(mut self) -> Self {
        self.fields.push(FieldDef::new(
            format!("_save{}", self.fields.len()),
            ParserType::SavePos,
        ));
        self
    }

    /// Load saved position from stack
    pub fn load_pos(mut self) -> Self {
        self.fields.push(FieldDef::new(
            format!("_load{}", self.fields.len()),
            ParserType::LoadPos,
        ));
        self
    }

    // === Combinators ===

    /// Add a field that repeats a parser N times
    pub fn field_repeat(
        mut self,
        name: impl Into<String>,
        parser: ParserType,
        count: usize,
    ) -> Self {
        self.fields.push(FieldDef::new(
            name,
            ParserType::Repeat(Box::new(parser), count),
        ));
        self
    }

    /// Add a custom parser type directly
    pub fn field_custom(mut self, name: impl Into<String>, parser: ParserType) -> Self {
        self.fields.push(FieldDef::new(name, parser));
        self
    }

    // === Convenience methods for repeated fields ===

    /// Add a field that reads N unsigned bytes (comma-separated output)
    pub fn field_ubyte_repeat(mut self, name: impl Into<String>, count: usize) -> Self {
        self.fields.push(FieldDef::new(
            name,
            ParserType::RepeatMulti(Box::new(ParserType::UByte), count),
        ));
        self
    }

    /// Add a field that reads N unsigned shorts (comma-separated output)
    pub fn field_ushort_repeat(mut self, name: impl Into<String>, count: usize) -> Self {
        self.fields.push(FieldDef::new(
            name,
            ParserType::RepeatMulti(Box::new(ParserType::UShort), count),
        ));
        self
    }

    /// Add a field that reads N unsigned longs (comma-separated output)
    pub fn field_ulong_repeat(mut self, name: impl Into<String>, count: usize) -> Self {
        self.fields.push(FieldDef::new(
            name,
            ParserType::RepeatMulti(Box::new(ParserType::ULong), count),
        ));
        self
    }

    /// Add a field that reads N signed bytes (comma-separated output)
    pub fn field_byte_repeat(mut self, name: impl Into<String>, count: usize) -> Self {
        self.fields.push(FieldDef::new(
            name,
            ParserType::RepeatMulti(Box::new(ParserType::Byte), count),
        ));
        self
    }

    /// Add a field that reads N signed shorts (comma-separated output)
    pub fn field_short_repeat(mut self, name: impl Into<String>, count: usize) -> Self {
        self.fields.push(FieldDef::new(
            name,
            ParserType::RepeatMulti(Box::new(ParserType::Short), count),
        ));
        self
    }

    /// Add a field that reads N signed longs (comma-separated output)
    pub fn field_long_repeat(mut self, name: impl Into<String>, count: usize) -> Self {
        self.fields.push(FieldDef::new(
            name,
            ParserType::RepeatMulti(Box::new(ParserType::Long), count),
        ));
        self
    }

    /// Add a field that reads N floats (comma-separated output)
    pub fn field_float_repeat(mut self, name: impl Into<String>, count: usize) -> Self {
        self.fields.push(FieldDef::new(
            name,
            ParserType::RepeatMulti(Box::new(ParserType::Float), count),
        ));
        self
    }

    /// Build the final Structure
    pub fn build(self) -> Structure {
        Structure {
            name: self.name,
            fields: self.fields,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn test_structure_builder_simple() {
        let structure = StructureBuilder::new("Test")
            .field_ubyte("id")
            .field_char("name")
            .field_ulong("value")
            .build();

        assert_eq!(structure.name(), "Test");
        assert_eq!(structure.field_names(), vec!["id", "name", "value"]);
    }

    #[test]
    fn test_structure_builder_with_padding() {
        let structure = StructureBuilder::new("Test")
            .field_ubyte("id")
            .pad(4)
            .field_ushort("value")
            .build();

        let names = structure.field_names();
        assert_eq!(names, vec!["id", "value"]); // Padding fields excluded
    }

    #[test]
    fn test_parse_simple_record() {
        let structure = StructureBuilder::new("Test")
            .field_ubyte("id")
            .field_ushort("value")
            .build();

        let data = vec![0x42, 0x01, 0x02]; // id=0x42, value=0x0201
        let mut state = ParserState::new(Cursor::new(data));

        let values = structure.parse_record(&mut state).unwrap();
        assert_eq!(values.len(), 2);
        assert_eq!(values[0], FieldValue::UByte(0x42));
        assert_eq!(values[1], FieldValue::UShort(0x0201));
    }

    #[test]
    fn test_parse_with_padding() {
        let structure = StructureBuilder::new("Test")
            .field_ubyte("id")
            .pad(2) // Skip 2 bytes
            .field_ubyte("value")
            .build();

        let data = vec![0x42, 0xFF, 0xFF, 0x99]; // id=0x42, [skip 2], value=0x99
        let mut state = ParserState::new(Cursor::new(data));

        let values = structure.parse_record(&mut state).unwrap();
        assert_eq!(values.len(), 3); // id, skip, value
        assert_eq!(values[0], FieldValue::UByte(0x42));
        assert_eq!(values[1], FieldValue::Skip); // padding
        assert_eq!(values[2], FieldValue::UByte(0x99));
    }

    #[test]
    fn test_parse_with_string() {
        let structure = StructureBuilder::new("Test")
            .field_ulong("id")
            .field_char("name")
            .build();

        let mut data = vec![0x01, 0x00, 0x00, 0x00]; // id = 1
        data.extend_from_slice(b"Hello\0"); // name = "Hello"

        let mut state = ParserState::new(Cursor::new(data));

        let values = structure.parse_record(&mut state).unwrap();
        assert_eq!(values.len(), 2);
        assert_eq!(values[0], FieldValue::ULong(1));
        assert_eq!(values[1], FieldValue::String("Hello".to_string()));
    }

    #[test]
    fn test_parse_with_save_load() {
        let structure = StructureBuilder::new("Test")
            .field_ubyte("first")
            .save_pos()
            .field_ubyte("second")
            .load_pos()
            .field_ubyte("repeat_second")
            .build();

        let data = vec![0x01, 0x02, 0x03];
        let mut state = ParserState::new(Cursor::new(data));

        let values = structure.parse_record(&mut state).unwrap();
        assert_eq!(values[0], FieldValue::UByte(0x01)); // first
        assert_eq!(values[1], FieldValue::Skip); // save
        assert_eq!(values[2], FieldValue::UByte(0x02)); // second
        assert_eq!(values[3], FieldValue::Skip); // load
        assert_eq!(values[4], FieldValue::UByte(0x02)); // repeat_second (same as second)
    }

    #[test]
    fn test_repeat_parser() {
        let structure = StructureBuilder::new("Test")
            .field_repeat("sum", ParserType::UByte, 3)
            .build();

        let data = vec![0x01, 0x02, 0x03];
        let mut state = ParserState::new(Cursor::new(data));

        let values = structure.parse_record(&mut state).unwrap();
        assert_eq!(values.len(), 1);
        // Repeat keeps only the last value
        assert_eq!(values[0], FieldValue::UByte(0x03));
    }

    #[test]
    fn test_sequence_parser() {
        let sequence = ParserType::Sequence(vec![ParserType::Pad(2), ParserType::UShort]);

        let structure = StructureBuilder::new("Test")
            .field_custom("value", sequence)
            .build();

        let data = vec![0xFF, 0xFF, 0x01, 0x02]; // skip 2, read ushort
        let mut state = ParserState::new(Cursor::new(data));

        let values = structure.parse_record(&mut state).unwrap();
        assert_eq!(values.len(), 1);
        assert_eq!(values[0], FieldValue::UShort(0x0201));
    }

    #[test]
    fn test_repeat_multi_parser() {
        let structure = StructureBuilder::new("Test")
            .field_ushort_repeat("values", 3)
            .build();

        let data = vec![0x01, 0x00, 0x02, 0x00, 0x03, 0x00]; // 3 ushorts: 1, 2, 3
        let mut state = ParserState::new(Cursor::new(data));

        let values = structure.parse_record(&mut state).unwrap();
        assert_eq!(values.len(), 1);
        assert_eq!(
            values[0],
            FieldValue::Multiple(vec![
                FieldValue::UShort(1),
                FieldValue::UShort(2),
                FieldValue::UShort(3),
            ])
        );

        // Test TSV output
        assert_eq!(values[0].to_tsv_string(), "1,2,3");
    }
}
