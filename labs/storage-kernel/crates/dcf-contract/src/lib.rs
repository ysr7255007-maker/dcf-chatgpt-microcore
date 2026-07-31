use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

pub const CONTRACT_VERSION: &str = "dcf.storage-lab.contract.v1";
pub const ENGINE_PROTOCOL_VERSION: &str = "dcf.storage-lab.engine.v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DatasetVariant {
    ZhClean,
    HybridClean,
    RawJson,
}

impl DatasetVariant {
    pub const ALL: [Self; 3] = [Self::ZhClean, Self::HybridClean, Self::RawJson];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::ZhClean => "zh_clean",
            Self::HybridClean => "hybrid_clean",
            Self::RawJson => "raw_json",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct TextId(pub String);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CanonicalSpan {
    pub text_id: TextId,
    pub start: u64,
    pub end: u64,
}

impl CanonicalSpan {
    pub fn new(text_id: TextId, start: u64, end: u64) -> Result<Self, SpanError> {
        if start > end {
            return Err(SpanError::Reversed { start, end });
        }
        Ok(Self { text_id, start, end })
    }

    pub fn len(&self) -> u64 {
        self.end - self.start
    }

    pub fn is_empty(&self) -> bool {
        self.start == self.end
    }

    pub fn validate_within(&self, expected_text: &TextId, canonical_len: u64) -> Result<(), SpanError> {
        if &self.text_id != expected_text {
            return Err(SpanError::WrongText {
                expected: expected_text.0.clone(),
                actual: self.text_id.0.clone(),
            });
        }
        if self.end > canonical_len {
            return Err(SpanError::OutOfBounds {
                end: self.end,
                canonical_len,
            });
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SpanError {
    Reversed { start: u64, end: u64 },
    WrongText { expected: String, actual: String },
    OutOfBounds { end: u64, canonical_len: u64 },
}

impl std::fmt::Display for SpanError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Reversed { start, end } => write!(f, "span start {start} exceeds end {end}"),
            Self::WrongText { expected, actual } => {
                write!(f, "span belongs to {actual}, expected {expected}")
            }
            Self::OutOfBounds { end, canonical_len } => {
                write!(f, "span end {end} exceeds canonical length {canonical_len}")
            }
        }
    }
}

impl std::error::Error for SpanError {}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CorpusProfile {
    pub canonical_bytes: u64,
    pub unicode_scalars: u64,
    pub ascii_bytes: u64,
    pub ascii_byte_share: f64,
    pub han_scalars: u64,
    pub han_scalar_share: f64,
    pub line_count: u64,
    pub longest_line_bytes: u64,
    pub unique_unicode_scalars: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatasetManifest {
    pub contract_version: String,
    pub dataset_id: String,
    pub source_set_id: String,
    pub variant: DatasetVariant,
    pub text_id: TextId,
    pub canonical_file: String,
    pub canonical_sha256: String,
    pub canonical_bytes: u64,
    pub record_map_file: Option<String>,
    pub provenance_map_file: Option<String>,
    pub profile: CorpusProfile,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EngineKind {
    Utf8SelfIndex,
    UnicodeByteAwareSelfIndex,
    Utf8LocateZstd,
    UnicodeLocateZstd,
}

impl EngineKind {
    pub fn uses_independent_text_store(self) -> bool {
        matches!(self, Self::Utf8LocateZstd | Self::UnicodeLocateZstd)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineCapabilities {
    pub count: bool,
    pub locate: bool,
    pub extract: bool,
    pub recover_all: bool,
    pub independent_text_store: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineBinding {
    pub engine_id: String,
    pub engine_kind: EngineKind,
    pub run_id: String,
    pub dataset_id: String,
    pub dataset_sha256: String,
    pub config_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageComponent {
    pub name: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryCase {
    pub id: String,
    pub query: String,
    #[serde(default = "default_locate_limit")]
    pub locate_limit: usize,
    #[serde(default)]
    pub tags: Vec<String>,
}

fn default_locate_limit() -> usize {
    10
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Percentiles {
    pub samples: usize,
    pub p50_ms: f64,
    pub p95_ms: f64,
    pub min_ms: f64,
    pub max_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryCorrectness {
    pub query_id: String,
    pub expected_count: u64,
    pub actual_count: Option<u64>,
    pub count_matches: bool,
    pub locate_matches: bool,
    pub extracted_bytes_match: bool,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CorrectnessSummary {
    pub passed: bool,
    pub recovery_sha256_matches: bool,
    pub manifest_binding_matches: bool,
    pub query_results: Vec<QueryCorrectness>,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowBenchmark {
    pub window_bytes: u64,
    pub cache_state: String,
    pub distribution: String,
    pub timing: Percentiles,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineRunReport {
    pub contract_version: String,
    pub run_id: String,
    pub dataset_id: String,
    pub source_set_id: String,
    pub variant: DatasetVariant,
    pub engine_id: String,
    pub engine_kind: EngineKind,
    pub capabilities: EngineCapabilities,
    pub correctness: CorrectnessSummary,
    pub source_bytes: u64,
    pub storage_components: Vec<StorageComponent>,
    pub storage_bytes_total: u64,
    pub bytes_per_input_byte: f64,
    pub build_ms: Option<f64>,
    pub open_ms: Option<f64>,
    pub count_timing: Option<Percentiles>,
    pub locate_timing: Option<Percentiles>,
    pub window_benchmarks: Vec<WindowBenchmark>,
    pub full_recovery_ms: Option<f64>,
    pub machine: BTreeMap<String, Value>,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExperimentReport {
    pub contract_version: String,
    pub generated_at: String,
    pub source_set_id: String,
    pub runs: Vec<EngineRunReport>,
}

impl ExperimentReport {
    pub fn all_correct(&self) -> bool {
        !self.runs.is_empty() && self.runs.iter().all(|run| run.correctness.passed)
    }
}
