use dcf_contract::{CanonicalSpan, EngineCapabilities, StorageComponent, TextId};
use dcf_engine_api::{Engine, EngineError, EngineResult};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

const STORE_VERSION: &str = "dcf.zstd-text-store.v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZstdStoreManifest {
    pub version: String,
    pub text_id: TextId,
    pub canonical_sha256: String,
    pub canonical_bytes: u64,
    pub block_size: u64,
    pub compression_level: i32,
    pub blocks: Vec<ZstdBlockEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZstdBlockEntry {
    pub index: u32,
    pub canonical_start: u64,
    pub canonical_end: u64,
    pub original_bytes: u64,
    pub compressed_bytes: u64,
    pub original_sha256: String,
    pub file: String,
}

#[derive(Debug, Clone)]
pub struct ZstdBlockStoreBuilder {
    pub block_size: usize,
    pub compression_level: i32,
}

impl Default for ZstdBlockStoreBuilder {
    fn default() -> Self {
        Self {
            block_size: 256 * 1024,
            compression_level: 19,
        }
    }
}

impl ZstdBlockStoreBuilder {
    pub fn build(
        &self,
        text_id: TextId,
        canonical_sha256: &str,
        canonical: &[u8],
        output_dir: impl AsRef<Path>,
    ) -> EngineResult<ZstdBlockStore> {
        if self.block_size == 0 {
            return Err(EngineError::Data("zstd block_size must be non-zero".to_owned()));
        }
        let actual_sha = sha256_hex(canonical);
        if actual_sha != canonical_sha256 {
            return Err(EngineError::BindingMismatch(format!(
                "canonical source hash {actual_sha} != expected {canonical_sha256}"
            )));
        }

        let output_dir = output_dir.as_ref();
        if output_dir.exists() {
            return ZstdBlockStore::open(output_dir);
        }
        let parent = output_dir.parent().ok_or_else(|| {
            EngineError::Data(format!("output directory {} has no parent", output_dir.display()))
        })?;
        fs::create_dir_all(parent)?;
        let name = output_dir
            .file_name()
            .ok_or_else(|| EngineError::Data("output directory has no filename".to_owned()))?
            .to_string_lossy();
        let temp_dir = parent.join(format!(".{name}.building"));
        if temp_dir.exists() {
            fs::remove_dir_all(&temp_dir)?;
        }
        fs::create_dir_all(temp_dir.join("blocks"))?;

        let mut blocks = Vec::new();
        for (index, chunk) in canonical.chunks(self.block_size).enumerate() {
            let compressed = zstd::stream::encode_all(Cursor::new(chunk), self.compression_level)
                .map_err(|error| EngineError::Data(format!("zstd encode block {index}: {error}")))?;
            let file = format!("blocks/{index:08}.zst");
            atomic_write(&temp_dir.join(&file), &compressed)?;
            let start = index
                .checked_mul(self.block_size)
                .ok_or_else(|| EngineError::Data("block offset overflow".to_owned()))?
                as u64;
            blocks.push(ZstdBlockEntry {
                index: index as u32,
                canonical_start: start,
                canonical_end: start + chunk.len() as u64,
                original_bytes: chunk.len() as u64,
                compressed_bytes: compressed.len() as u64,
                original_sha256: sha256_hex(chunk),
                file,
            });
        }

        let manifest = ZstdStoreManifest {
            version: STORE_VERSION.to_owned(),
            text_id,
            canonical_sha256: canonical_sha256.to_owned(),
            canonical_bytes: canonical.len() as u64,
            block_size: self.block_size as u64,
            compression_level: self.compression_level,
            blocks,
        };
        let manifest_bytes = serde_json::to_vec_pretty(&manifest)
            .map_err(|error| EngineError::Data(format!("serialize zstd manifest: {error}")))?;
        atomic_write(&temp_dir.join("manifest.json"), &manifest_bytes)?;
        atomic_write(&temp_dir.join("COMPLETE"), canonical_sha256.as_bytes())?;
        fs::rename(&temp_dir, output_dir)?;
        ZstdBlockStore::open(output_dir)
    }
}

#[derive(Debug)]
pub struct ZstdBlockStore {
    root: PathBuf,
    manifest: ZstdStoreManifest,
    cache: Mutex<BTreeMap<u32, Arc<Vec<u8>>>>,
}

impl ZstdBlockStore {
    pub fn open(root: impl AsRef<Path>) -> EngineResult<Self> {
        let root = root.as_ref().to_path_buf();
        if !root.join("COMPLETE").is_file() {
            return Err(EngineError::Data(format!(
                "zstd text store {} is incomplete",
                root.display()
            )));
        }
        let bytes = fs::read(root.join("manifest.json"))?;
        let manifest: ZstdStoreManifest = serde_json::from_slice(&bytes)
            .map_err(|error| EngineError::Data(format!("parse zstd manifest: {error}")))?;
        if manifest.version != STORE_VERSION {
            return Err(EngineError::Data(format!(
                "unsupported zstd store version {}",
                manifest.version
            )));
        }
        validate_manifest(&manifest)?;
        Ok(Self {
            root,
            manifest,
            cache: Mutex::new(BTreeMap::new()),
        })
    }

    pub fn manifest(&self) -> &ZstdStoreManifest {
        &self.manifest
    }

    pub fn clear_application_cache(&self) {
        if let Ok(mut cache) = self.cache.lock() {
            cache.clear();
        }
    }

    pub fn extract_bytes(&self, start: u64, end: u64) -> EngineResult<Vec<u8>> {
        if start > end || end > self.manifest.canonical_bytes {
            return Err(EngineError::InvalidSpan(format!(
                "requested [{start}, {end}) for canonical length {}",
                self.manifest.canonical_bytes
            )));
        }
        if start == end {
            return Ok(Vec::new());
        }

        let first = (start / self.manifest.block_size) as usize;
        let last = ((end - 1) / self.manifest.block_size) as usize;
        let mut output = Vec::with_capacity((end - start) as usize);
        for block_index in first..=last {
            let entry = self
                .manifest
                .blocks
                .get(block_index)
                .ok_or_else(|| EngineError::Data(format!("missing block entry {block_index}")))?;
            let block = self.load_block(entry)?;
            let local_start = start.saturating_sub(entry.canonical_start) as usize;
            let local_end = (end.min(entry.canonical_end) - entry.canonical_start) as usize;
            if local_end > block.len() || local_start > local_end {
                return Err(EngineError::Data(format!(
                    "invalid local slice [{local_start}, {local_end}) for block {} length {}",
                    entry.index,
                    block.len()
                )));
            }
            output.extend_from_slice(&block[local_start..local_end]);
        }
        Ok(output)
    }

    fn load_block(&self, entry: &ZstdBlockEntry) -> EngineResult<Arc<Vec<u8>>> {
        if let Some(cached) = self
            .cache
            .lock()
            .map_err(|_| EngineError::Data("zstd cache mutex poisoned".to_owned()))?
            .get(&entry.index)
            .cloned()
        {
            return Ok(cached);
        }

        let compressed = fs::read(self.root.join(&entry.file))?;
        if compressed.len() as u64 != entry.compressed_bytes {
            return Err(EngineError::Data(format!(
                "compressed block {} size mismatch",
                entry.index
            )));
        }
        let decoded = zstd::stream::decode_all(Cursor::new(compressed))
            .map_err(|error| EngineError::Data(format!("zstd decode block {}: {error}", entry.index)))?;
        if decoded.len() as u64 != entry.original_bytes {
            return Err(EngineError::Data(format!(
                "decoded block {} size mismatch",
                entry.index
            )));
        }
        let actual_sha = sha256_hex(&decoded);
        if actual_sha != entry.original_sha256 {
            return Err(EngineError::Data(format!(
                "decoded block {} hash mismatch",
                entry.index
            )));
        }
        let decoded = Arc::new(decoded);
        self.cache
            .lock()
            .map_err(|_| EngineError::Data("zstd cache mutex poisoned".to_owned()))?
            .insert(entry.index, decoded.clone());
        Ok(decoded)
    }

    fn measured_components(&self) -> EngineResult<Vec<StorageComponent>> {
        let manifest_bytes = fs::metadata(self.root.join("manifest.json"))?.len();
        let completion_bytes = fs::metadata(self.root.join("COMPLETE"))?.len();
        let block_bytes = self
            .manifest
            .blocks
            .iter()
            .try_fold(0u64, |total, entry| -> EngineResult<u64> {
                Ok(total + fs::metadata(self.root.join(&entry.file))?.len())
            })?;
        Ok(vec![
            StorageComponent {
                name: "zstd_blocks".to_owned(),
                bytes: block_bytes,
            },
            StorageComponent {
                name: "zstd_directory_manifest".to_owned(),
                bytes: manifest_bytes,
            },
            StorageComponent {
                name: "zstd_completion_marker".to_owned(),
                bytes: completion_bytes,
            },
        ])
    }
}

impl Engine for ZstdBlockStore {
    fn id(&self) -> &str {
        "zstd-text-store"
    }

    fn capabilities(&self) -> EngineCapabilities {
        EngineCapabilities {
            count: false,
            locate: false,
            extract: true,
            recover_all: true,
            independent_text_store: true,
        }
    }

    fn text_id(&self) -> &TextId {
        &self.manifest.text_id
    }

    fn canonical_len(&self) -> u64 {
        self.manifest.canonical_bytes
    }

    fn dataset_sha256(&self) -> &str {
        &self.manifest.canonical_sha256
    }

    fn count(&self, _query: &[u8]) -> EngineResult<u64> {
        Err(EngineError::Unsupported("count"))
    }

    fn locate(&self, _query: &[u8], _limit: usize) -> EngineResult<Vec<CanonicalSpan>> {
        Err(EngineError::Unsupported("locate"))
    }

    fn extract(&self, span: &CanonicalSpan) -> EngineResult<Vec<u8>> {
        span.validate_within(&self.manifest.text_id, self.manifest.canonical_bytes)
            .map_err(|error| EngineError::InvalidSpan(error.to_string()))?;
        self.extract_bytes(span.start, span.end)
    }

    fn recover_all(&self) -> EngineResult<Vec<u8>> {
        self.extract_bytes(0, self.manifest.canonical_bytes)
    }

    fn storage_components(&self) -> EngineResult<Vec<StorageComponent>> {
        self.measured_components()
    }
}

fn validate_manifest(manifest: &ZstdStoreManifest) -> EngineResult<()> {
    if manifest.block_size == 0 {
        return Err(EngineError::Data("manifest block_size is zero".to_owned()));
    }
    let mut expected_start = 0u64;
    for entry in &manifest.blocks {
        if entry.canonical_start != expected_start || entry.canonical_end < entry.canonical_start {
            return Err(EngineError::Data(format!(
                "non-contiguous block directory at block {}",
                entry.index
            )));
        }
        expected_start = entry.canonical_end;
    }
    if expected_start != manifest.canonical_bytes {
        return Err(EngineError::Data(format!(
            "block directory covers {expected_start} bytes, expected {}",
            manifest.canonical_bytes
        )));
    }
    Ok(())
}

fn atomic_write(path: &Path, bytes: &[u8]) -> EngineResult<()> {
    let name = path
        .file_name()
        .ok_or_else(|| EngineError::Data("atomic write target has no filename".to_owned()))?
        .to_string_lossy();
    let temp = path.with_file_name(format!(".{name}.tmp"));
    let mut file = File::create(&temp)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    fs::rename(temp, path)?;
    Ok(())
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}
