//! Raw Artifact Store with SHA-256 identity preservation
//! 
//! This crate provides registration and management of raw conversation export files
//! (ZIP archives, JSON dumps) with cryptographic identity tracking.

use chrono::{DateTime, Utc};
use hex::encode;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use thiserror::Error;

/// Error types for artifact store operations
#[derive(Debug, Error)]
pub enum ArtifactError {
    #[error("file not found: {0}")]
    FileNotFound(PathBuf),
    
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    
    #[error("artifact already registered with blob_id: {0}")]
    DuplicateRegistration(String),
    
    #[error("invalid artifact type: unsupported media type for {0}")]
    InvalidArtifactType(PathBuf),
    
    #[error("failed to read file: {0}")]
    ReadFailed(PathBuf),
}

/// Unique identifier for an artifact
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct BlobId(pub String); // SHA-256 hex string

/// Metadata about a registered artifact
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtifactMetadata {
    pub blob_id: String,
    pub sha256: String,
    pub original_filename: String,
    pub byte_length: u64,
    pub media_type: MediaType,
    pub source_platform: String,
    pub imported_at: DateTime<Utc>,
    pub archive_member_path: Option<String>,
}

/// Supported media types for artifact registration
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MediaType {
    ZipArchive,
    Json,
    Markdown,
    Text,
    Unknown,
}

impl MediaType {
    pub fn from_path(path: &Path) -> Self {
        match path.extension().and_then(|e| e.to_str()) {
            Some("zip") => MediaType::ZipArchive,
            Some("json") => MediaType::Json,
            Some("md") | Some("markdown") => MediaType::Markdown,
            Some("txt") => MediaType::Text,
            _ => MediaType::Unknown,
        }
    }
    
    pub fn as_str(&self) -> &'static str {
        match self {
            MediaType::ZipArchive => "application/zip",
            MediaType::Json => "application/json",
            MediaType::Markdown => "text/markdown",
            MediaType::Text => "text/plain",
            MediaType::Unknown => "application/octet-stream",
        }
    }
}

/// Registry for managing raw artifacts
pub struct ArtifactRegistry {
    artifacts: HashMap<String, ArtifactMetadata>, // blob_id -> metadata
    root_directory: PathBuf,
}

impl ArtifactRegistry {
    /// Create a new registry in the given directory
    pub fn new(root_directory: impl AsRef<Path>) -> Result<Self, ArtifactError> {
        let root = root_directory.as_ref().to_path_buf();
        fs::create_dir_all(&root)?;
        
        Ok(Self {
            artifacts: HashMap::new(),
            root_directory: root,
        })
    }
    
    /// Register a new artifact file
    pub fn register_artifact(&mut self, path: impl AsRef<Path>) -> Result<BlobId, ArtifactError> {
        let path = path.as_ref();
        
        if !path.exists() {
            return Err(ArtifactError::FileNotFound(path.to_path_buf()));
        }
        
        // Compute SHA-256 hash
        let bytes = fs::read(path).map_err(|_| ArtifactError::ReadFailed(path.to_path_buf()))?;
        let mut hasher = Sha256::new();
        hasher.update(&bytes);
        let hash_bytes = hasher.finalize();
        let sha256_hex = encode(hash_bytes);
        
        let blob_id = BlobId(sha256_hex.clone());
        
        // Check for duplicate
        if self.artifacts.contains_key(&sha256_hex) {
            return Err(ArtifactError::DuplicateRegistration(sha256_hex));
        }
        
        let metadata = ArtifactMetadata {
            blob_id: sha256_hex.clone(),
            sha256: sha256_hex.clone(),
            original_filename: path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string(),
            byte_length: bytes.len() as u64,
            media_type: MediaType::from_path(path),
            source_platform: "chatgpt-web".to_owned(),
            imported_at: Utc::now(),
            archive_member_path: None,
        };
        
        // Log the artifact identity (required by task book)
        eprintln!(
            "artifact_sha256={} path={} bytes={}",
            sha256_hex,
            path.display(),
            metadata.byte_length
        );
        
        self.artifacts.insert(sha256_hex.clone(), metadata);
        
        Ok(blob_id)
    }
}