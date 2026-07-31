use dcf_contract::{CanonicalSpan, EngineCapabilities, StorageComponent, TextId};
use std::path::Path;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum EngineError {
    #[error("unsupported operation: {0}")]
    Unsupported(&'static str),
    #[error("empty query is not allowed")]
    EmptyQuery,
    #[error("span validation failed: {0}")]
    InvalidSpan(String),
    #[error("engine binding mismatch: {0}")]
    BindingMismatch(String),
    #[error("engine protocol error: {0}")]
    Protocol(String),
    #[error("engine I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("engine data error: {0}")]
    Data(String),
}

pub type EngineResult<T> = Result<T, EngineError>;

pub trait Engine: Send + Sync {
    fn id(&self) -> &str;
    fn capabilities(&self) -> EngineCapabilities;
    fn text_id(&self) -> &TextId;
    fn canonical_len(&self) -> u64;
    fn dataset_sha256(&self) -> &str;

    fn count(&self, query: &[u8]) -> EngineResult<u64>;
    fn locate(&self, query: &[u8], limit: usize) -> EngineResult<Vec<CanonicalSpan>>;
    fn extract(&self, span: &CanonicalSpan) -> EngineResult<Vec<u8>>;
    fn recover_all(&self) -> EngineResult<Vec<u8>>;
    fn storage_components(&self) -> EngineResult<Vec<StorageComponent>>;

    fn clear_application_cache(&self) -> EngineResult<()> {
        Ok(())
    }

    fn verify_binding(&self, text_id: &TextId, canonical_len: u64, sha256: &str) -> EngineResult<()> {
        if self.text_id() != text_id {
            return Err(EngineError::BindingMismatch(format!(
                "text_id {} != {}",
                self.text_id().0, text_id.0
            )));
        }
        if self.canonical_len() != canonical_len {
            return Err(EngineError::BindingMismatch(format!(
                "canonical_len {} != {canonical_len}",
                self.canonical_len()
            )));
        }
        if self.dataset_sha256() != sha256 {
            return Err(EngineError::BindingMismatch(format!(
                "dataset_sha256 {} != {sha256}",
                self.dataset_sha256()
            )));
        }
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct TruthScanner {
    engine_id: String,
    text_id: TextId,
    dataset_sha256: String,
    bytes: Vec<u8>,
}

impl TruthScanner {
    pub fn from_bytes(text_id: TextId, dataset_sha256: impl Into<String>, bytes: Vec<u8>) -> Self {
        Self {
            engine_id: "truth-scan".to_owned(),
            text_id,
            dataset_sha256: dataset_sha256.into(),
            bytes,
        }
    }

    pub fn from_file(
        text_id: TextId,
        dataset_sha256: impl Into<String>,
        path: impl AsRef<Path>,
    ) -> EngineResult<Self> {
        Ok(Self::from_bytes(
            text_id,
            dataset_sha256,
            std::fs::read(path)?,
        ))
    }

    fn matching_offsets(&self, query: &[u8]) -> EngineResult<Vec<usize>> {
        if query.is_empty() {
            return Err(EngineError::EmptyQuery);
        }
        if query.len() > self.bytes.len() {
            return Ok(Vec::new());
        }

        Ok(self
            .bytes
            .windows(query.len())
            .enumerate()
            .filter_map(|(offset, window)| (window == query).then_some(offset))
            .collect())
    }
}

impl Engine for TruthScanner {
    fn id(&self) -> &str {
        &self.engine_id
    }

    fn capabilities(&self) -> EngineCapabilities {
        EngineCapabilities {
            count: true,
            locate: true,
            extract: true,
            recover_all: true,
            independent_text_store: true,
        }
    }

    fn text_id(&self) -> &TextId {
        &self.text_id
    }

    fn canonical_len(&self) -> u64 {
        self.bytes.len() as u64
    }

    fn dataset_sha256(&self) -> &str {
        &self.dataset_sha256
    }

    fn count(&self, query: &[u8]) -> EngineResult<u64> {
        Ok(self.matching_offsets(query)?.len() as u64)
    }

    fn locate(&self, query: &[u8], limit: usize) -> EngineResult<Vec<CanonicalSpan>> {
        let mut spans = Vec::new();
        for start in self.matching_offsets(query)?.into_iter().take(limit) {
            spans.push(CanonicalSpan {
                text_id: self.text_id.clone(),
                start: start as u64,
                end: (start + query.len()) as u64,
            });
        }
        Ok(spans)
    }

    fn extract(&self, span: &CanonicalSpan) -> EngineResult<Vec<u8>> {
        span.validate_within(&self.text_id, self.bytes.len() as u64)
            .map_err(|error| EngineError::InvalidSpan(error.to_string()))?;
        Ok(self.bytes[span.start as usize..span.end as usize].to_vec())
    }

    fn recover_all(&self) -> EngineResult<Vec<u8>> {
        Ok(self.bytes.clone())
    }

    fn storage_components(&self) -> EngineResult<Vec<StorageComponent>> {
        Ok(vec![StorageComponent {
            name: "truth_source_bytes".to_owned(),
            bytes: self.bytes.len() as u64,
        }])
    }
}

pub fn total_storage_bytes(components: &[StorageComponent]) -> u64 {
    components.iter().map(|component| component.bytes).sum()
}
