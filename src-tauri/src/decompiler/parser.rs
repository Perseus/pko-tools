use crate::decompiler::error::{DecompilerError, Result};
use std::io::{Read, Seek, SeekFrom};

/// Parser state tracks position in the byte stream and manages parsing operations
pub struct ParserState<R: Read + Seek> {
    reader: R,
    position: usize,
    saved_positions: Vec<usize>,
}

impl<R: Read + Seek> ParserState<R> {
    /// Create a new parser state with the given reader
    pub fn new(reader: R) -> Self {
        Self {
            reader,
            position: 0,
            saved_positions: Vec::new(),
        }
    }

    /// Get current position in the stream
    pub fn position(&self) -> usize {
        self.position
    }

    // === Primitive Parsers (Little-Endian) ===

    /// Parse an unsigned 8-bit integer
    pub fn parse_ubyte(&mut self) -> Result<u8> {
        let mut buf = [0u8; 1];
        self.reader.read_exact(&mut buf)?;
        self.position += 1;
        Ok(buf[0])
    }

    /// Parse a signed 8-bit integer
    pub fn parse_byte(&mut self) -> Result<i8> {
        let mut buf = [0u8; 1];
        self.reader.read_exact(&mut buf)?;
        self.position += 1;
        Ok(i8::from_le_bytes(buf))
    }

    /// Parse an unsigned 16-bit integer (little-endian)
    pub fn parse_ushort(&mut self) -> Result<u16> {
        let mut buf = [0u8; 2];
        self.reader.read_exact(&mut buf)?;
        self.position += 2;
        Ok(u16::from_le_bytes(buf))
    }

    /// Parse a signed 16-bit integer (little-endian)
    pub fn parse_short(&mut self) -> Result<i16> {
        let mut buf = [0u8; 2];
        self.reader.read_exact(&mut buf)?;
        self.position += 2;
        Ok(i16::from_le_bytes(buf))
    }

    /// Parse an unsigned 32-bit integer (little-endian)
    pub fn parse_ulong(&mut self) -> Result<u32> {
        let mut buf = [0u8; 4];
        self.reader.read_exact(&mut buf)?;
        self.position += 4;
        Ok(u32::from_le_bytes(buf))
    }

    /// Parse a signed 32-bit integer (little-endian)
    pub fn parse_long(&mut self) -> Result<i32> {
        let mut buf = [0u8; 4];
        self.reader.read_exact(&mut buf)?;
        self.position += 4;
        Ok(i32::from_le_bytes(buf))
    }

    /// Parse an unsigned 64-bit integer (little-endian)
    pub fn parse_uquad(&mut self) -> Result<u64> {
        let mut buf = [0u8; 8];
        self.reader.read_exact(&mut buf)?;
        self.position += 8;
        Ok(u64::from_le_bytes(buf))
    }

    /// Parse a signed 64-bit integer (little-endian)
    pub fn parse_quad(&mut self) -> Result<i64> {
        let mut buf = [0u8; 8];
        self.reader.read_exact(&mut buf)?;
        self.position += 8;
        Ok(i64::from_le_bytes(buf))
    }

    /// Parse a 32-bit floating point number (little-endian)
    pub fn parse_float(&mut self) -> Result<f32> {
        let mut buf = [0u8; 4];
        self.reader.read_exact(&mut buf)?;
        self.position += 4;
        Ok(f32::from_le_bytes(buf))
    }

    /// Parse a 64-bit floating point number (little-endian)
    pub fn parse_double(&mut self) -> Result<f64> {
        let mut buf = [0u8; 8];
        self.reader.read_exact(&mut buf)?;
        self.position += 8;
        Ok(f64::from_le_bytes(buf))
    }

    /// Parse a null-terminated string
    ///
    /// Reads bytes until a null byte (0x00) is encountered.
    /// The null byte is consumed but not included in the result.
    /// Returns a UTF-8 string (lossy conversion for invalid UTF-8).
    pub fn parse_char(&mut self) -> Result<String> {
        let mut bytes = Vec::new();
        loop {
            let mut buf = [0u8; 1];
            self.reader.read_exact(&mut buf)?;
            self.position += 1;

            if buf[0] == 0 {
                break;
            }
            bytes.push(buf[0]);
        }

        Ok(String::from_utf8_lossy(&bytes).into_owned())
    }

    /// Parse a fixed-length string of up to `max_len` bytes
    ///
    /// Reads up to `max_len` bytes, stopping at the first null byte.
    /// Advances position by exactly `max_len` bytes regardless of where null is found.
    pub fn parse_char_fixed(&mut self, max_len: usize) -> Result<String> {
        let mut bytes = Vec::new();
        let mut found_null = false;

        for _ in 0..max_len {
            let mut buf = [0u8; 1];
            self.reader.read_exact(&mut buf)?;
            self.position += 1;

            if buf[0] == 0 {
                found_null = true;
            }

            if !found_null {
                bytes.push(buf[0]);
            }
        }

        Ok(String::from_utf8_lossy(&bytes).into_owned())
    }

    // === Special Parsers ===

    /// Skip `count` bytes forward in the stream
    pub fn pad(&mut self, count: usize) -> Result<()> {
        self.reader.seek(SeekFrom::Current(count as i64))?;
        self.position += count;
        Ok(())
    }

    /// Save current position to the stack
    pub fn save_position(&mut self) {
        self.saved_positions.push(self.position);
    }

    /// Load and seek to the most recently saved position
    ///
    /// Peeks at the top of the stack (does not pop) and seeks to it.
    /// This allows the same position to be loaded multiple times.
    pub fn load_position(&mut self) -> Result<()> {
        if let Some(&pos) = self.saved_positions.last() {
            self.reader.seek(SeekFrom::Start(pos as u64))?;
            self.position = pos;
            Ok(())
        } else {
            Err(DecompilerError::Parse {
                position: self.position,
                message: "No saved position to load".to_string(),
            })
        }
    }

    /// Peek at the saved positions stack (for debugging)
    #[allow(dead_code)]
    pub fn saved_positions(&self) -> &[usize] {
        &self.saved_positions
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn test_parse_ubyte() {
        let data = vec![0x42, 0xFF, 0x00];
        let mut state = ParserState::new(Cursor::new(data));

        assert_eq!(state.parse_ubyte().unwrap(), 0x42);
        assert_eq!(state.parse_ubyte().unwrap(), 0xFF);
        assert_eq!(state.parse_ubyte().unwrap(), 0x00);
        assert_eq!(state.position(), 3);
    }

    #[test]
    fn test_parse_byte() {
        let data = vec![0x7F, 0x80, 0xFF]; // 127, -128, -1
        let mut state = ParserState::new(Cursor::new(data));

        assert_eq!(state.parse_byte().unwrap(), 127);
        assert_eq!(state.parse_byte().unwrap(), -128);
        assert_eq!(state.parse_byte().unwrap(), -1);
    }

    #[test]
    fn test_parse_ushort() {
        let data = vec![0x01, 0x02, 0xFF, 0xFF]; // little-endian: 0x0201, 0xFFFF
        let mut state = ParserState::new(Cursor::new(data));

        assert_eq!(state.parse_ushort().unwrap(), 0x0201);
        assert_eq!(state.parse_ushort().unwrap(), 0xFFFF);
        assert_eq!(state.position(), 4);
    }

    #[test]
    fn test_parse_short() {
        let data = vec![0xFF, 0xFF, 0x00, 0x80]; // -1, -32768
        let mut state = ParserState::new(Cursor::new(data));

        assert_eq!(state.parse_short().unwrap(), -1);
        assert_eq!(state.parse_short().unwrap(), -32768);
    }

    #[test]
    fn test_parse_ulong() {
        let data = vec![0x01, 0x02, 0x03, 0x04]; // little-endian: 0x04030201
        let mut state = ParserState::new(Cursor::new(data));

        assert_eq!(state.parse_ulong().unwrap(), 0x04030201);
        assert_eq!(state.position(), 4);
    }

    #[test]
    fn test_parse_long() {
        let data = vec![0xFF, 0xFF, 0xFF, 0xFF]; // -1
        let mut state = ParserState::new(Cursor::new(data));

        assert_eq!(state.parse_long().unwrap(), -1);
    }

    #[test]
    fn test_parse_uquad() {
        let data = vec![0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08];
        let mut state = ParserState::new(Cursor::new(data));

        assert_eq!(state.parse_uquad().unwrap(), 0x0807060504030201);
        assert_eq!(state.position(), 8);
    }

    #[test]
    fn test_parse_float() {
        let data = 3.14_f32.to_le_bytes().to_vec();
        let mut state = ParserState::new(Cursor::new(data));

        let result = state.parse_float().unwrap();
        assert!((result - 3.14).abs() < 0.001);
        assert_eq!(state.position(), 4);
    }

    #[test]
    fn test_parse_double() {
        let data = 3.141592653589793_f64.to_le_bytes().to_vec();
        let mut state = ParserState::new(Cursor::new(data));

        let result = state.parse_double().unwrap();
        assert!((result - 3.141592653589793).abs() < 1e-10);
        assert_eq!(state.position(), 8);
    }

    #[test]
    fn test_parse_char() {
        let data = vec![b'H', b'e', b'l', b'l', b'o', 0x00, b'W', b'o', b'r', b'l', b'd', 0x00];
        let mut state = ParserState::new(Cursor::new(data));

        assert_eq!(state.parse_char().unwrap(), "Hello");
        assert_eq!(state.position(), 6);
        assert_eq!(state.parse_char().unwrap(), "World");
        assert_eq!(state.position(), 12);
    }

    #[test]
    fn test_parse_char_empty() {
        let data = vec![0x00];
        let mut state = ParserState::new(Cursor::new(data));

        assert_eq!(state.parse_char().unwrap(), "");
        assert_eq!(state.position(), 1);
    }

    #[test]
    fn test_parse_char_fixed() {
        let data = vec![b'H', b'e', b'l', b'l', b'o', 0x00, b'X', b'X', b'W', b'o', b'r', b'l'];
        let mut state = ParserState::new(Cursor::new(data));

        // Read 8 bytes, but stop at null
        assert_eq!(state.parse_char_fixed(8).unwrap(), "Hello");
        assert_eq!(state.position(), 8); // Advanced full 8 bytes

        // Read 4 bytes without null
        assert_eq!(state.parse_char_fixed(4).unwrap(), "Worl");
        assert_eq!(state.position(), 12);
    }

    #[test]
    fn test_pad() {
        let data = vec![1, 2, 3, 4, 5, 6, 7, 8];
        let mut state = ParserState::new(Cursor::new(data));

        state.pad(3).unwrap();
        assert_eq!(state.position(), 3);
        assert_eq!(state.parse_ubyte().unwrap(), 4); // Should read byte at position 3
    }

    #[test]
    fn test_save_load_position() {
        let data = vec![1, 2, 3, 4, 5, 6];
        let mut state = ParserState::new(Cursor::new(data));

        state.parse_ubyte().unwrap(); // pos = 1
        state.save_position(); // save pos 1

        state.parse_ubyte().unwrap(); // pos = 2
        state.parse_ubyte().unwrap(); // pos = 3

        state.load_position().unwrap(); // back to pos 1

        assert_eq!(state.position(), 1);
        assert_eq!(state.parse_ubyte().unwrap(), 2); // Read byte at position 1
    }

    #[test]
    fn test_save_load_multiple() {
        let data = vec![1, 2, 3, 4, 5, 6, 7, 8];
        let mut state = ParserState::new(Cursor::new(data));

        state.parse_ubyte().unwrap(); // pos = 1
        state.save_position(); // save pos 1

        state.parse_ubyte().unwrap(); // pos = 2
        state.save_position(); // save pos 2

        state.parse_ubyte().unwrap(); // pos = 3

        // Load peeks at top of stack (pos 2), doesn't pop
        state.load_position().unwrap();
        assert_eq!(state.position(), 2);

        // Load again - still peeks at top (pos 2)
        state.load_position().unwrap();
        assert_eq!(state.position(), 2);

        // Can still read forward from the loaded position
        state.parse_ubyte().unwrap(); // pos = 3
        state.load_position().unwrap(); // back to pos 2 again
        assert_eq!(state.position(), 2);
    }

    #[test]
    fn test_load_position_empty_stack() {
        let data = vec![1, 2, 3];
        let mut state = ParserState::new(Cursor::new(data));

        let result = state.load_position();
        assert!(result.is_err());
    }
}
