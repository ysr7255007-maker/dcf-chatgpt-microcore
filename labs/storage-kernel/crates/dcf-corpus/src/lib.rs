use anyhow::{bail, Context, Result};
use dcf_contract::{CorpusProfile, DatasetManifest, DatasetVariant, TextId, CONTRACT_VERSION};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExperimentSpec {
    pub source_set_id: String,
    pub variants: Vec<VariantInputSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VariantInputSpec {
    pub variant: DatasetVariant,
    pub path: PathBuf,
    pub record_map: Option<PathBuf>,
    pub provenance_map: Option<PathBuf>,
}

#[derive(Debug, Clone)]
pub struct LoadedExperimentSpec {
    pub spec_path: PathBuf,
    pub base_dir: PathBuf,
    pub spec: ExperimentSpec,
}

#[derive(Debug, Clone)]
pub struct PreparedDataset {
    pub root: PathBuf,
    pub manifest: DatasetManifest,
}

impl PreparedDataset {
    pub fn canonical_path(&self) -> PathBuf {
        self.root.join(&self.manifest.canonical_file)
    }

    pub fn manifest_path(&self) -> PathBuf {
        self.root.join("manifest.json")
    }
}

pub fn load_experiment_spec(path: impl AsRef<Path>) -> Result<LoadedExperimentSpec> {
    let spec_path = path
        .as_ref()
        .canonicalize()
        .with_context(|| format!("canonicalize spec path {}", path.as_ref().display()))?;
    let content = fs::read_to_string(&spec_path)
        .with_context(|| format!("read experiment spec {}", spec_path.display()))?;
    let spec: ExperimentSpec = toml::from_str(&content)
        .with_context(|| format!("parse experiment spec {}", spec_path.display()))?;

    if spec.source_set_id.trim().is_empty() {
        bail!("source_set_id must not be empty");
    }
    if spec.variants.is_empty() {
        bail!("at least one variant is required");
    }

    let mut seen = BTreeSet::new();
    for input in &spec.variants {
        if !seen.insert(input.variant) {
            bail!("duplicate dataset variant {}", input.variant.as_str());
        }
    }

    let base_dir = spec_path
        .parent()
        .context("experiment spec has no parent directory")?
        .to_path_buf();

    Ok(LoadedExperimentSpec {
        spec_path,
        base_dir,
        spec,
    })
}

impl LoadedExperimentSpec {
    pub fn resolved_variants(&self) -> Vec<VariantInputSpec> {
        self.spec
            .variants
            .iter()
            .cloned()
            .map(|mut input| {
                input.path = resolve(&self.base_dir, &input.path);
                input.record_map = input.record_map.map(|path| resolve(&self.base_dir, &path));
                input.provenance_map = input
                    .provenance_map
                    .map(|path| resolve(&self.base_dir, &path));
                input
            })
            .collect()
    }
}

pub fn prepare_all(spec: &LoadedExperimentSpec, output_root: impl AsRef<Path>) -> Result<Vec<PreparedDataset>> {
    let mut prepared = Vec::new();
    for input in spec.resolved_variants() {
        prepared.push(prepare_dataset(
            &spec.spec.source_set_id,
            &input,
            output_root.as_ref(),
        )?);
    }
    Ok(prepared)
}

pub fn prepare_dataset(
    source_set_id: &str,
    input: &VariantInputSpec,
    output_root: &Path,
) -> Result<PreparedDataset> {
    let canonical = fs::read(&input.path)
        .with_context(|| format!("read source variant {}", input.path.display()))?;
    let profile = profile_bytes(&canonical)?;
    let dataset_id = dataset_id(source_set_id, input.variant, &profile.sha256);
    let final_root = output_root.join(&dataset_id);

    if final_root.exists() {
        let existing = read_manifest(&final_root.join("manifest.json"))?;
        if existing.canonical_sha256 != profile.sha256 {
            bail!(
                "dataset directory {} already exists with a different canonical hash",
                final_root.display()
            );
        }
        return Ok(PreparedDataset {
            root: final_root,
            manifest: existing,
        });
    }

    fs::create_dir_all(output_root)
        .with_context(|| format!("create output root {}", output_root.display()))?;
    let temp_root = output_root.join(format!(".{dataset_id}.building"));
    if temp_root.exists() {
        fs::remove_dir_all(&temp_root)
            .with_context(|| format!("remove stale build directory {}", temp_root.display()))?;
    }
    fs::create_dir_all(&temp_root)
        .with_context(|| format!("create build directory {}", temp_root.display()))?;

    atomic_write(&temp_root.join("canonical.bin"), &canonical)?;
    let record_map_file = copy_optional_sidecar(&temp_root, "record-map.json", input.record_map.as_deref())?;
    let provenance_map_file = copy_optional_sidecar(
        &temp_root,
        "provenance-map.json",
        input.provenance_map.as_deref(),
    )?;

    let manifest = DatasetManifest {
        contract_version: CONTRACT_VERSION.to_owned(),
        dataset_id: dataset_id.clone(),
        source_set_id: source_set_id.to_owned(),
        variant: input.variant,
        text_id: TextId(dataset_id.clone()),
        canonical_file: "canonical.bin".to_owned(),
        canonical_sha256: profile.sha256.clone(),
        canonical_bytes: profile.canonical_bytes,
        record_map_file,
        provenance_map_file,
        profile,
    };

    let manifest_bytes = serde_json::to_vec_pretty(&manifest)?;
    atomic_write(&temp_root.join("manifest.json"), &manifest_bytes)?;
    atomic_write(&temp_root.join("COMPLETE"), manifest.canonical_sha256.as_bytes())?;
    fs::rename(&temp_root, &final_root).with_context(|| {
        format!(
            "atomically publish dataset {} -> {}",
            temp_root.display(),
            final_root.display()
        )
    })?;

    Ok(PreparedDataset {
        root: final_root,
        manifest,
    })
}

pub fn read_prepared_dataset(root: impl AsRef<Path>) -> Result<PreparedDataset> {
    let root = root.as_ref().to_path_buf();
    if !root.join("COMPLETE").is_file() {
        bail!("dataset {} is incomplete", root.display());
    }
    let manifest = read_manifest(&root.join("manifest.json"))?;
    let bytes = fs::read(root.join(&manifest.canonical_file))?;
    let actual = sha256_hex(&bytes);
    if actual != manifest.canonical_sha256 {
        bail!(
            "dataset hash mismatch: manifest={}, actual={actual}",
            manifest.canonical_sha256
        );
    }
    Ok(PreparedDataset { root, manifest })
}

pub fn profile_file(path: impl AsRef<Path>) -> Result<CorpusProfile> {
    let bytes = fs::read(path.as_ref())?;
    profile_bytes(&bytes)
}

pub fn profile_bytes(bytes: &[u8]) -> Result<CorpusProfile> {
    let text = std::str::from_utf8(bytes).context("canonical corpus must be valid UTF-8")?;
    let unicode_scalars = text.chars().count() as u64;
    let ascii_bytes = bytes.iter().filter(|byte| byte.is_ascii()).count() as u64;
    let mut han_scalars = 0u64;
    let mut unique = BTreeSet::new();
    for scalar in text.chars() {
        unique.insert(scalar);
        if is_han(scalar) {
            han_scalars += 1;
        }
    }

    let mut line_count = 0u64;
    let mut longest_line_bytes = 0u64;
    if !bytes.is_empty() {
        for line in bytes.split(|byte| *byte == b'\n') {
            line_count += 1;
            longest_line_bytes = longest_line_bytes.max(line.len() as u64);
        }
    }

    Ok(CorpusProfile {
        canonical_bytes: bytes.len() as u64,
        unicode_scalars,
        ascii_bytes,
        ascii_byte_share: ratio(ascii_bytes, bytes.len() as u64),
        han_scalars,
        han_scalar_share: ratio(han_scalars, unicode_scalars),
        line_count,
        longest_line_bytes,
        unique_unicode_scalars: unique.len() as u64,
        sha256: sha256_hex(bytes),
    })
}

pub fn compare_profiles(datasets: &[PreparedDataset]) -> BTreeMap<DatasetVariant, CorpusProfile> {
    datasets
        .iter()
        .map(|dataset| (dataset.manifest.variant, dataset.manifest.profile.clone()))
        .collect()
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn dataset_id(source_set_id: &str, variant: DatasetVariant, canonical_sha256: &str) -> String {
    let seed = format!("{source_set_id}\n{}\n{canonical_sha256}", variant.as_str());
    let digest = sha256_hex(seed.as_bytes());
    format!("{}-{}-{}", sanitize(source_set_id), variant.as_str(), &digest[..16])
}

fn sanitize(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            output.push(ch);
        } else {
            output.push('-');
        }
    }
    output.trim_matches('-').to_owned()
}

fn resolve(base: &Path, path: &Path) -> PathBuf {
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        base.join(path)
    }
}

fn copy_optional_sidecar(root: &Path, target_name: &str, source: Option<&Path>) -> Result<Option<String>> {
    let Some(source) = source else {
        return Ok(None);
    };
    let bytes = fs::read(source).with_context(|| format!("read sidecar {}", source.display()))?;
    atomic_write(&root.join(target_name), &bytes)?;
    Ok(Some(target_name.to_owned()))
}

fn read_manifest(path: &Path) -> Result<DatasetManifest> {
    let bytes = fs::read(path).with_context(|| format!("read manifest {}", path.display()))?;
    Ok(serde_json::from_slice(&bytes)
        .with_context(|| format!("parse manifest {}", path.display()))?)
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let file_name = path
        .file_name()
        .context("atomic write target has no filename")?
        .to_string_lossy();
    let temp = path.with_file_name(format!(".{file_name}.tmp"));
    let mut file = File::create(&temp).with_context(|| format!("create {}", temp.display()))?;
    file.write_all(bytes)?;
    file.sync_all()?;
    fs::rename(&temp, path)
        .with_context(|| format!("rename {} -> {}", temp.display(), path.display()))?;
    Ok(())
}

fn ratio(part: u64, whole: u64) -> f64 {
    if whole == 0 {
        0.0
    } else {
        part as f64 / whole as f64
    }
}

fn is_han(ch: char) -> bool {
    matches!(
        ch as u32,
        0x3400..=0x4DBF
            | 0x4E00..=0x9FFF
            | 0xF900..=0xFAFF
            | 0x20000..=0x2A6DF
            | 0x2A700..=0x2B73F
            | 0x2B740..=0x2B81F
            | 0x2B820..=0x2CEAF
            | 0x2CEB0..=0x2EBEF
            | 0x30000..=0x3134F
    )
}
