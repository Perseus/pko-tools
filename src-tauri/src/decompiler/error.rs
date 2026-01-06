use std::io;

/// Decompiler error types
#[derive(Debug)]
pub enum DecompilerError {
    /// IO error occurred
    Io(io::Error),

    /// Parse error at specific position
    Parse { position: usize, message: String },

    /// Invalid file format
    InvalidFormat(String),

    /// Decryption error
    Decryption(String),

    /// Type conversion error
    TypeConversion(String),
}

impl std::fmt::Display for DecompilerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DecompilerError::Io(e) => write!(f, "IO error: {}", e),
            DecompilerError::Parse { position, message } => {
                write!(f, "Parse error at position {}: {}", position, message)
            }
            DecompilerError::InvalidFormat(msg) => write!(f, "Invalid file format: {}", msg),
            DecompilerError::Decryption(msg) => write!(f, "Decryption error: {}", msg),
            DecompilerError::TypeConversion(msg) => write!(f, "Type conversion error: {}", msg),
        }
    }
}

impl std::error::Error for DecompilerError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            DecompilerError::Io(e) => Some(e),
            _ => None,
        }
    }
}

impl From<io::Error> for DecompilerError {
    fn from(err: io::Error) -> Self {
        DecompilerError::Io(err)
    }
}

/// Result type for decompiler operations
pub type Result<T> = std::result::Result<T, DecompilerError>;
