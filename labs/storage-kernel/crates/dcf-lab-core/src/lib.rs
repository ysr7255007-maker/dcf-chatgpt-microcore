use anyhow::{bail, Context, Result};
use dcf_contract::{
    CanonicalSpan, CorrectnessSummary, EngineBinding, EngineCapabilities, EngineKind,
    EngineRunReport, ExperimentReport, Percentiles, QueryCase, QueryCorrectness, StorageComponent,
    WindowBenchmark, CONTRACT_VERSION,
};
use dcf_corpus::{sha256_hex, PreparedDataset};
use dcf_engine_api::{total_storage_bytes, Engine, EngineResult, TruthScanner};
use dcf_engine_external::{build_external, ExternalEngine, ExternalEngineConfig};
use dcf_text_zstd::{ZstdBlockStore, ZstdBlockStoreBuilder};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineSuiteSpec {
    #[serde(default = "default_warmups")]
    pub warmups: usize,
    #[serde(default = "default_repetitions")]
    pub repetitions: usize,
    #[serde(default = "default_windows")]
    pub window_bytes: Vec<u64>,
    pub engines: Vec<EngineDefinition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineDefinition {
    pub id: String,
    pub kind: EngineKind,
    pub executable: PathBuf,
    #[serde(default)]
    pub args: Vec<String>,
    pub working_directory: Option<PathBuf>,
    #[serde(default)]
    pub environment: BTreeMap<String, String>,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
    pub engine_config: Option<toml::Value>,
    #[serde(default = "default_zstd_block_size")]
    pub zstd_block_size: usize,
    #[serde(default = "default_zstd_level")]
    pub zstd_level: i32,
}

#[derive(Debug, Clone)]
pub struct LoadedEngineSuite {
    pub spec_path: PathBuf,
    pub base_dir: PathBuf,
    pub spec: EngineSuiteSpec,
}

#[derive(Debug, Clone)]
pub struct RunOptions {
    pub warmups: usize,
    pub repetitions: usize,
    pub window_bytes: Vec<u64>,
}

impl From<&EngineSuiteSpec> for RunOptions {
    fn from(spec: &EngineSuiteSpec) -> Self {
        Self {
            warmups: spec.warmups,
            repetitions: spec.repetitions,
            window_bytes: spec.window_bytes.clone(),
        }
    }
}

pub struct BuiltEngine {
    pub engine: Box<dyn Engine>,
    pub kind: EngineKind,
    pub build_ms: f64,
    pub open_ms: f64,
}

pub struct CompositeEngine {
    id: String,
    locator: Box<dyn Engine>,
    text_store: ZstdBlockStore,
}

impl CompositeEngine {
    pub fn new(
        id: impl Into<String>,
        locator: Box<dyn Engine>,
        text_store: ZstdBlockStore,
    ) -> EngineResult<Self> {
        text_store.verify_binding(
            locator.text_id(),
            locator.canonical_len(),
            locator.dataset_sha256(),
        )?;
        Ok(Self {
            id: id.into(),
            locator,
            text_store,
        })
    }
}

impl Engine for CompositeEngine {
    fn id(&self) -> &str {
        &self.id
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

    fn text_id(&self) -> &dcf_contract::TextId {
        self.locator.text_id()
    }

    fn canonical_len(&self) -> u64 {
        self.locator.canonical_len()
    }

    fn dataset_sha256(&self) -> &str {
        self.locator.dataset_sha256()
    }

    fn count(&self, query: &[u8]) -> EngineResult<u64> {
        self.locator.count(query)
    }

    fn locate(&self, query: &[u8], limit: usize) -> EngineResult<Vec<CanonicalSpan>> {
        self.locator.locate(query, limit)
    }

    fn extract(&self, span: &CanonicalSpan) -> EngineResult<Vec<u8>> {
        self.text_store.extract(span)
    }

    fn recover_all(&self) -> EngineResult<Vec<u8>> {
        self.text_store.recover_all()
    }

    fn storage_components(&self) -> EngineResult<Vec<StorageComponent>> {
        let mut components = self.locator.storage_components()?;
        for component in &mut components {
            component.name = format!("locator.{}", component.name);
        }
        let mut body = self.text_store.storage_components()?;
        for component in &mut body {
            component.name = format!("text_store.{}", component.name);
        }
        components.extend(body);
        Ok(components)
    }

    fn clear_application_cache(&self) -> EngineResult<()> {
        self.text_store.clear_application_cache();
        self.locator.clear_application_cache()
    }
}

pub fn load_engine_suite(path: impl AsRef<Path>) -> Result<LoadedEngineSuite> {
    let spec_path = path.as_ref().canonicalize()?;
    let content = fs::read_to_string(&spec_path)?;
    let spec: EngineSuiteSpec = toml::from_str(&content)?;
    if spec.engines.is_empty() {
        bail!("engine suite must define at least one engine");
    }
    if spec.repetitions == 0 {
        bail!("repetitions must be greater than zero");
    }
    let base_dir = spec_path
        .parent()
        .context("engine suite path has no parent")?
        .to_path_buf();
    Ok(LoadedEngineSuite {
        spec_path,
        base_dir,
        spec,
    })
}

pub fn load_queries(path: impl AsRef<Path>) -> Result<Vec<QueryCase>> {
    let content = fs::read_to_string(path.as_ref())?;
    let mut queries = Vec::new();
    for (index, line) in content.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let query: QueryCase = serde_json::from_str(line)
            .with_context(|| format!("parse query line {}", index + 1))?;
        if query.query.is_empty() {
            bail!("query {} is empty", query.id);
        }
        queries.push(query);
    }
    if queries.is_empty() {
        bail!("query file contains no queries");
    }
    Ok(queries)
}

pub fn build_engine(
    suite: &LoadedEngineSuite,
    definition: &EngineDefinition,
    dataset: &PreparedDataset,
    run_id: &str,
    run_root: &Path,
) -> Result<BuiltEngine> {
    let engine_root = run_root.join(&definition.id);
    fs::create_dir_all(&engine_root)?;
    let executable = resolve(&suite.base_dir, &definition.executable);
    let working_directory = definition
        .working_directory
        .as_ref()
        .map(|path| resolve(&suite.base_dir, path));
    let engine_config = definition
        .engine_config
        .as_ref()
        .map(serde_json::to_value)
        .transpose()?
        .unwrap_or_else(|| Value::Object(Default::default()));
    let external_config = ExternalEngineConfig {
        engine_id: definition.id.clone(),
        executable,
        args: definition.args.clone(),
        working_directory,
        environment: definition.environment.clone(),
        timeout_ms: definition.timeout_ms,
        engine_config,
    };
    let config_sha256 = config_sha256(definition)?;
    let binding = EngineBinding {
        engine_id: definition.id.clone(),
        engine_kind: definition.kind,
        run_id: run_id.to_owned(),
        dataset_id: dataset.manifest.dataset_id.clone(),
        dataset_sha256: dataset.manifest.canonical_sha256.clone(),
        config_sha256,
    };
    let segment_dir = engine_root.join("segment");

    let build_started = Instant::now();
    build_external(
        &external_config,
        binding.clone(),
        &dataset.canonical_path(),
        &segment_dir,
    )?;
    let mut text_store = None;
    if definition.kind.uses_independent_text_store() {
        let canonical = fs::read(dataset.canonical_path())?;
        text_store = Some(
            ZstdBlockStoreBuilder {
                block_size: definition.zstd_block_size,
                compression_level: definition.zstd_level,
            }
            .build(
                dataset.manifest.text_id.clone(),
                &dataset.manifest.canonical_sha256,
                &canonical,
                engine_root.join("text-store"),
            )?,
        );
    }
    let build_ms = build_started.elapsed().as_secs_f64() * 1_000.0;

    let open_started = Instant::now();
    let external = ExternalEngine::open(
        external_config,
        binding,
        dataset.manifest.text_id.clone(),
        dataset.manifest.canonical_bytes,
        &segment_dir,
    )?;
    external.verify_binding(
        &dataset.manifest.text_id,
        dataset.manifest.canonical_bytes,
        &dataset.manifest.canonical_sha256,
    )?;
    let engine: Box<dyn Engine> = if let Some(text_store) = text_store {
        Box::new(CompositeEngine::new(
            definition.id.clone(),
            Box::new(external),
            text_store,
        )?)
    } else {
        Box::new(external)
    };
    let open_ms = open_started.elapsed().as_secs_f64() * 1_000.0;

    Ok(BuiltEngine {
        engine,
        kind: definition.kind,
        build_ms,
        open_ms,
    })
}

pub fn run_engine(
    dataset: &PreparedDataset,
    built: &BuiltEngine,
    run_id: &str,
    queries: &[QueryCase],
    options: &RunOptions,
    machine: BTreeMap<String, Value>,
) -> Result<EngineRunReport> {
    let canonical = fs::read(dataset.canonical_path())?;
    let truth = TruthScanner::from_bytes(
        dataset.manifest.text_id.clone(),
        dataset.manifest.canonical_sha256.clone(),
        canonical,
    );
    let engine = built.engine.as_ref();
    let correctness = check_correctness(engine, &truth, queries)?;
    let storage_components = engine.storage_components()?;
    let storage_bytes_total = total_storage_bytes(&storage_components);
    let source_bytes = dataset.manifest.canonical_bytes;
    let bytes_per_input_byte = if source_bytes == 0 {
        0.0
    } else {
        storage_bytes_total as f64 / source_bytes as f64
    };

    let mut notes = vec![
        "application_cold clears only engine-owned decoded caches; OS page-cache state is unspecified"
            .to_owned(),
        "storage-cold measurements require an external local wrapper and are not inferred here"
            .to_owned(),
    ];

    let (count_timing, locate_timing, window_benchmarks, full_recovery_ms) = if correctness.passed {
        let count = if engine.capabilities().count {
            Some(time_queries(options, queries, |query| {
                engine.count(query.query.as_bytes()).map(|_| ())
            })?)
        } else {
            None
        };
        let locate = if engine.capabilities().locate {
            Some(time_queries(options, queries, |query| {
                engine
                    .locate(query.query.as_bytes(), query.locate_limit)
                    .map(|_| ())
            })?)
        } else {
            None
        };
        let windows = if engine.capabilities().extract {
            benchmark_windows(engine, &truth, queries, options)?
        } else {
            Vec::new()
        };
        let recovery = if engine.capabilities().recover_all {
            let started = Instant::now();
            let recovered = engine.recover_all()?;
            let elapsed = started.elapsed().as_secs_f64() * 1_000.0;
            if sha256_hex(&recovered) != dataset.manifest.canonical_sha256 {
                bail!("recovery hash changed after correctness gate");
            }
            Some(elapsed)
        } else {
            None
        };
        (count, locate, windows, recovery)
    } else {
        notes.push("performance timings suppressed because correctness gates failed".to_owned());
        (None, None, Vec::new(), None)
    };

    Ok(EngineRunReport {
        contract_version: CONTRACT_VERSION.to_owned(),
        run_id: run_id.to_owned(),
        dataset_id: dataset.manifest.dataset_id.clone(),
        source_set_id: dataset.manifest.source_set_id.clone(),
        variant: dataset.manifest.variant,
        engine_id: engine.id().to_owned(),
        engine_kind: built.kind,
        capabilities: engine.capabilities(),
        correctness,
        source_bytes,
        storage_components,
        storage_bytes_total,
        bytes_per_input_byte,
        build_ms: Some(built.build_ms),
        open_ms: Some(built.open_ms),
        count_timing,
        locate_timing,
        window_benchmarks,
        full_recovery_ms,
        machine,
        notes,
    })
}

pub fn report(source_set_id: impl Into<String>, runs: Vec<EngineRunReport>) -> ExperimentReport {
    ExperimentReport {
        contract_version: CONTRACT_VERSION.to_owned(),
        generated_at: unix_timestamp_string(),
        source_set_id: source_set_id.into(),
        runs,
    }
}

pub fn validate_report(report: &ExperimentReport) -> Result<()> {
    if report.contract_version != CONTRACT_VERSION {
        bail!(
            "report contract {} != {}",
            report.contract_version,
            CONTRACT_VERSION
        );
    }
    if report.runs.is_empty() {
        bail!("report contains no runs");
    }
    for run in &report.runs {
        let component_total: u64 = run.storage_components.iter().map(|item| item.bytes).sum();
        if component_total != run.storage_bytes_total {
            bail!(
                "run {} storage total {} != component total {}",
                run.run_id,
                run.storage_bytes_total,
                component_total
            );
        }
        if run.source_bytes > 0 {
            let expected = run.storage_bytes_total as f64 / run.source_bytes as f64;
            if (expected - run.bytes_per_input_byte).abs() > 1e-9 {
                bail!("run {} bytes_per_input_byte is inconsistent", run.run_id);
            }
        }
    }
    Ok(())
}

fn check_correctness(
    engine: &dyn Engine,
    truth: &TruthScanner,
    queries: &[QueryCase],
) -> Result<CorrectnessSummary> {
    let mut summary = CorrectnessSummary::default();
    match engine.verify_binding(truth.text_id(), truth.canonical_len(), truth.dataset_sha256()) {
        Ok(()) => summary.manifest_binding_matches = true,
        Err(error) => summary.errors.push(error.to_string()),
    }

    if engine.capabilities().recover_all {
        match engine.recover_all() {
            Ok(bytes) => {
                summary.recovery_sha256_matches = sha256_hex(&bytes) == truth.dataset_sha256();
                if !summary.recovery_sha256_matches {
                    summary.errors.push("full recovery SHA-256 mismatch".to_owned());
                }
            }
            Err(error) => summary.errors.push(format!("full recovery failed: {error}")),
        }
    } else {
        summary.errors.push("engine cannot recover canonical text".to_owned());
    }

    for query in queries {
        let query_bytes = query.query.as_bytes();
        let expected_count = truth.count(query_bytes)?;
        let expected_spans = normalized(truth.locate(query_bytes, query.locate_limit)?);
        let mut result = QueryCorrectness {
            query_id: query.id.clone(),
            expected_count,
            actual_count: None,
            count_matches: false,
            locate_matches: false,
            extracted_bytes_match: false,
            errors: Vec::new(),
        };

        match engine.count(query_bytes) {
            Ok(actual) => {
                result.actual_count = Some(actual);
                result.count_matches = actual == expected_count;
                if !result.count_matches {
                    result.errors.push(format!(
                        "count mismatch: expected {expected_count}, actual {actual}"
                    ));
                }
            }
            Err(error) => result.errors.push(format!("count failed: {error}")),
        }

        match engine.locate(query_bytes, query.locate_limit) {
            Ok(actual_spans) => {
                let actual_spans = normalized(actual_spans);
                result.locate_matches = actual_spans == expected_spans;
                if !result.locate_matches {
                    result.errors.push(format!(
                        "locate mismatch: expected {:?}, actual {:?}",
                        expected_spans, actual_spans
                    ));
                }
                let mut extraction_matches = true;
                for span in &actual_spans {
                    let expected = truth.extract(span)?;
                    match engine.extract(span) {
                        Ok(actual) if actual == expected => {}
                        Ok(_) => {
                            extraction_matches = false;
                            result.errors.push(format!(
                                "extract mismatch at [{}, {})",
                                span.start, span.end
                            ));
                        }
                        Err(error) => {
                            extraction_matches = false;
                            result.errors.push(format!("extract failed: {error}"));
                        }
                    }
                }
                result.extracted_bytes_match = extraction_matches;
            }
            Err(error) => result.errors.push(format!("locate failed: {error}")),
        }
        summary.query_results.push(result);
    }

    summary.passed = summary.manifest_binding_matches
        && summary.recovery_sha256_matches
        && summary.query_results.iter().all(|query| {
            query.count_matches
                && query.locate_matches
                && query.extracted_bytes_match
                && query.errors.is_empty()
        })
        && summary.errors.is_empty();
    Ok(summary)
}

fn benchmark_windows(
    engine: &dyn Engine,
    truth: &TruthScanner,
    queries: &[QueryCase],
    options: &RunOptions,
) -> Result<Vec<WindowBenchmark>> {
    let mut hits = Vec::new();
    for query in queries {
        if let Some(span) = truth.locate(query.query.as_bytes(), 1)?.into_iter().next() {
            hits.push(span);
        }
        if hits.len() >= 10 {
            break;
        }
    }
    if hits.is_empty() {
        return Ok(Vec::new());
    }

    let mut reports = Vec::new();
    for window_bytes in &options.window_bytes {
        let spans: Vec<_> = hits
            .iter()
            .map(|hit| window_around(hit, *window_bytes, truth.canonical_len()))
            .collect();

        warm_extracts(engine, &spans, options.warmups)?;
        let hot = sample(options.repetitions, || {
            for span in &spans {
                engine.extract(span)?;
            }
            Ok(())
        })?;
        reports.push(WindowBenchmark {
            window_bytes: *window_bytes,
            cache_state: "application_hot".to_owned(),
            distribution: "up_to_10_query_first_hits".to_owned(),
            timing: percentiles(hot),
        });

        let cold = sample(options.repetitions, || {
            engine.clear_application_cache()?;
            for span in &spans {
                engine.extract(span)?;
            }
            Ok(())
        })?;
        reports.push(WindowBenchmark {
            window_bytes: *window_bytes,
            cache_state: "application_cold_os_unspecified".to_owned(),
            distribution: "up_to_10_query_first_hits".to_owned(),
            timing: percentiles(cold),
        });
    }
    Ok(reports)
}

fn time_queries<F>(
    options: &RunOptions,
    queries: &[QueryCase],
    mut operation: F,
) -> Result<Percentiles>
where
    F: FnMut(&QueryCase) -> EngineResult<()>,
{
    for _ in 0..options.warmups {
        for query in queries {
            operation(query)?;
        }
    }
    let samples = sample(options.repetitions, || {
        for query in queries {
            operation(query)?;
        }
        Ok(())
    })?;
    Ok(percentiles(samples))
}

fn warm_extracts(engine: &dyn Engine, spans: &[CanonicalSpan], warmups: usize) -> EngineResult<()> {
    for _ in 0..warmups {
        for span in spans {
            engine.extract(span)?;
        }
    }
    Ok(())
}

fn sample<F>(repetitions: usize, mut operation: F) -> EngineResult<Vec<Duration>>
where
    F: FnMut() -> EngineResult<()>,
{
    let mut samples = Vec::with_capacity(repetitions);
    for _ in 0..repetitions {
        let started = Instant::now();
        operation()?;
        samples.push(started.elapsed());
    }
    Ok(samples)
}

fn percentiles(mut samples: Vec<Duration>) -> Percentiles {
    if samples.is_empty() {
        return Percentiles::default();
    }
    samples.sort_unstable();
    let p50 = percentile_index(samples.len(), 0.50);
    let p95 = percentile_index(samples.len(), 0.95);
    Percentiles {
        samples: samples.len(),
        p50_ms: millis(samples[p50]),
        p95_ms: millis(samples[p95]),
        min_ms: millis(samples[0]),
        max_ms: millis(samples[samples.len() - 1]),
    }
}

fn percentile_index(len: usize, percentile: f64) -> usize {
    (((len - 1) as f64 * percentile).ceil() as usize).min(len - 1)
}

fn millis(duration: Duration) -> f64 {
    duration.as_secs_f64() * 1_000.0
}

fn window_around(hit: &CanonicalSpan, window_bytes: u64, canonical_len: u64) -> CanonicalSpan {
    let target = window_bytes.min(canonical_len);
    let mut start = hit.start.saturating_sub(target / 4);
    let mut end = (start + target).min(canonical_len);
    if end - start < target {
        start = end.saturating_sub(target);
    }
    end = (start + target).min(canonical_len);
    CanonicalSpan {
        text_id: hit.text_id.clone(),
        start,
        end,
    }
}

fn normalized(mut spans: Vec<CanonicalSpan>) -> Vec<CanonicalSpan> {
    spans.sort_by_key(|span| (span.start, span.end));
    spans
}

fn config_sha256(definition: &EngineDefinition) -> Result<String> {
    let bytes = serde_json::to_vec(definition)?;
    Ok(hex::encode(Sha256::digest(bytes)))
}

fn resolve(base: &Path, path: &Path) -> PathBuf {
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        base.join(path)
    }
}

fn unix_timestamp_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| format!("unix:{}", duration.as_secs()))
        .unwrap_or_else(|_| "unix:unknown".to_owned())
}

fn default_warmups() -> usize {
    3
}

fn default_repetitions() -> usize {
    20
}

fn default_windows() -> Vec<u64> {
    vec![128, 1024, 8192]
}

fn default_timeout_ms() -> u64 {
    30_000
}

fn default_zstd_block_size() -> usize {
    256 * 1024
}

fn default_zstd_level() -> i32 {
    19
}
