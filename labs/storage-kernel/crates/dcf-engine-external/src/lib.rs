use dcf_contract::{
    CanonicalSpan, EngineBinding, EngineCapabilities, StorageComponent, TextId,
    ENGINE_PROTOCOL_VERSION,
};
use dcf_engine_api::{Engine, EngineError, EngineResult};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

static REQUEST_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalEngineConfig {
    pub engine_id: String,
    pub executable: PathBuf,
    #[serde(default)]
    pub args: Vec<String>,
    pub working_directory: Option<PathBuf>,
    #[serde(default)]
    pub environment: BTreeMap<String, String>,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
    #[serde(default)]
    pub engine_config: Value,
}

fn default_timeout_ms() -> u64 {
    30_000
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalBuildResult {
    pub segment_dir: PathBuf,
    pub storage_components: Vec<StorageComponent>,
    pub notes: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ProtocolRequest {
    protocol_version: String,
    request_id: String,
    op: String,
    binding: Option<EngineBinding>,
    payload: Value,
}

#[derive(Debug, Serialize, Deserialize)]
struct ProtocolResponse {
    protocol_version: String,
    request_id: String,
    ok: bool,
    binding: Option<EngineBinding>,
    result: Option<Value>,
    error: Option<ProtocolFailure>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ProtocolFailure {
    code: String,
    message: String,
    details: Option<Value>,
}

struct EngineProcess {
    child: Child,
    stdin: ChildStdin,
    stdout_lines: Receiver<Result<String, String>>,
    stderr: Arc<Mutex<String>>,
    timeout: Duration,
}

impl EngineProcess {
    fn spawn(config: &ExternalEngineConfig) -> EngineResult<Self> {
        let mut command = Command::new(&config.executable);
        command.args(&config.args);
        if let Some(directory) = &config.working_directory {
            command.current_dir(directory);
        }
        command.envs(&config.environment);
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = command.spawn().map_err(|error| {
            EngineError::Protocol(format!(
                "spawn external engine {} ({}): {error}",
                config.engine_id,
                config.executable.display()
            ))
        })?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| EngineError::Protocol("external engine stdin unavailable".to_owned()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| EngineError::Protocol("external engine stdout unavailable".to_owned()))?;
        let stderr_pipe = child
            .stderr
            .take()
            .ok_or_else(|| EngineError::Protocol("external engine stderr unavailable".to_owned()))?;

        let (line_tx, line_rx) = mpsc::channel();
        thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                let mut line = String::new();
                match reader.read_line(&mut line) {
                    Ok(0) => break,
                    Ok(_) => {
                        let line = line.trim_end_matches(['\r', '\n']).to_owned();
                        if !line.is_empty() && line_tx.send(Ok(line)).is_err() {
                            break;
                        }
                    }
                    Err(error) => {
                        let _ = line_tx.send(Err(error.to_string()));
                        break;
                    }
                }
            }
        });

        let stderr = Arc::new(Mutex::new(String::new()));
        let stderr_target = stderr.clone();
        thread::spawn(move || {
            let mut reader = BufReader::new(stderr_pipe);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        if let Ok(mut buffer) = stderr_target.lock() {
                            buffer.push_str(&line);
                        }
                    }
                }
            }
        });

        let mut process = Self {
            child,
            stdin,
            stdout_lines: line_rx,
            stderr,
            timeout: Duration::from_millis(config.timeout_ms),
        };
        process.call_raw("hello", None, json!({ "engine_id": config.engine_id }))?;
        Ok(process)
    }

    fn call_raw(
        &mut self,
        op: &str,
        binding: Option<EngineBinding>,
        payload: Value,
    ) -> EngineResult<Value> {
        let request_id = format!(
            "req-{}",
            REQUEST_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        );
        let request = ProtocolRequest {
            protocol_version: ENGINE_PROTOCOL_VERSION.to_owned(),
            request_id: request_id.clone(),
            op: op.to_owned(),
            binding: binding.clone(),
            payload,
        };
        let mut encoded = serde_json::to_vec(&request)
            .map_err(|error| EngineError::Protocol(format!("encode request: {error}")))?;
        encoded.push(b'\n');
        self.stdin.write_all(&encoded)?;
        self.stdin.flush()?;

        let line = match self.stdout_lines.recv_timeout(self.timeout) {
            Ok(Ok(line)) => line,
            Ok(Err(error)) => {
                return Err(EngineError::Protocol(format!(
                    "external engine stdout failed: {error}; stderr={}",
                    self.stderr_snapshot()
                )))
            }
            Err(RecvTimeoutError::Timeout) => {
                return Err(EngineError::Protocol(format!(
                    "external engine timed out after {:?} for op {op}; stderr={}",
                    self.timeout,
                    self.stderr_snapshot()
                )))
            }
            Err(RecvTimeoutError::Disconnected) => {
                return Err(EngineError::Protocol(format!(
                    "external engine closed stdout during op {op}; stderr={}",
                    self.stderr_snapshot()
                )))
            }
        };

        let response: ProtocolResponse = serde_json::from_str(&line).map_err(|error| {
            EngineError::Protocol(format!("decode response for {op}: {error}; line={line:?}"))
        })?;
        if response.protocol_version != ENGINE_PROTOCOL_VERSION {
            return Err(EngineError::Protocol(format!(
                "protocol version {} != {}",
                response.protocol_version, ENGINE_PROTOCOL_VERSION
            )));
        }
        if response.request_id != request_id {
            return Err(EngineError::Protocol(format!(
                "response request_id {} != {request_id}",
                response.request_id
            )));
        }
        if let Some(expected) = binding {
            let actual = response.binding.ok_or_else(|| {
                EngineError::BindingMismatch("response omitted engine binding".to_owned())
            })?;
            validate_binding(&expected, &actual)?;
        }
        if !response.ok {
            let failure = response.error.unwrap_or(ProtocolFailure {
                code: "unknown".to_owned(),
                message: "external engine returned ok=false without error".to_owned(),
                details: None,
            });
            return Err(EngineError::Protocol(format!(
                "{}: {}{}",
                failure.code,
                failure.message,
                failure
                    .details
                    .map(|details| format!(" details={details}"))
                    .unwrap_or_default()
            )));
        }
        Ok(response.result.unwrap_or(Value::Null))
    }

    fn stderr_snapshot(&self) -> String {
        self.stderr
            .lock()
            .map(|buffer| buffer.clone())
            .unwrap_or_else(|_| "<stderr lock poisoned>".to_owned())
    }
}

impl Drop for EngineProcess {
    fn drop(&mut self) {
        let _ = self.call_raw("shutdown", None, Value::Null);
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub fn build_external(
    config: &ExternalEngineConfig,
    binding: EngineBinding,
    canonical_path: &Path,
    segment_dir: &Path,
) -> EngineResult<ExternalBuildResult> {
    let mut process = EngineProcess::spawn(config)?;
    let result = process.call_raw(
        "build",
        Some(binding),
        json!({
            "canonical_path": canonical_path,
            "segment_dir": segment_dir,
            "engine_config": config.engine_config,
        }),
    )?;
    serde_json::from_value(result)
        .map_err(|error| EngineError::Protocol(format!("decode build result: {error}")))
}

pub struct ExternalEngine {
    config: ExternalEngineConfig,
    binding: EngineBinding,
    capabilities: EngineCapabilities,
    text_id: TextId,
    canonical_len: u64,
    process: Mutex<EngineProcess>,
}

impl ExternalEngine {
    pub fn open(
        config: ExternalEngineConfig,
        binding: EngineBinding,
        text_id: TextId,
        canonical_len: u64,
        segment_dir: &Path,
    ) -> EngineResult<Self> {
        let mut process = EngineProcess::spawn(&config)?;
        let result = process.call_raw(
            "open",
            Some(binding.clone()),
            json!({
                "segment_dir": segment_dir,
                "engine_config": config.engine_config,
            }),
        )?;
        let capabilities: EngineCapabilities = result
            .get("capabilities")
            .cloned()
            .ok_or_else(|| EngineError::Protocol("open result omitted capabilities".to_owned()))
            .and_then(|value| {
                serde_json::from_value(value).map_err(|error| {
                    EngineError::Protocol(format!("decode engine capabilities: {error}"))
                })
            })?;

        Ok(Self {
            config,
            binding,
            capabilities,
            text_id,
            canonical_len,
            process: Mutex::new(process),
        })
    }

    fn call(&self, op: &str, payload: Value) -> EngineResult<Value> {
        self.process
            .lock()
            .map_err(|_| EngineError::Protocol("external engine mutex poisoned".to_owned()))?
            .call_raw(op, Some(self.binding.clone()), payload)
    }
}

impl Engine for ExternalEngine {
    fn id(&self) -> &str {
        &self.config.engine_id
    }

    fn capabilities(&self) -> EngineCapabilities {
        self.capabilities.clone()
    }

    fn text_id(&self) -> &TextId {
        &self.text_id
    }

    fn canonical_len(&self) -> u64 {
        self.canonical_len
    }

    fn dataset_sha256(&self) -> &str {
        &self.binding.dataset_sha256
    }

    fn count(&self, query: &[u8]) -> EngineResult<u64> {
        if !self.capabilities.count {
            return Err(EngineError::Unsupported("count"));
        }
        let result = self.call("count", json!({ "query_hex": hex::encode(query) }))?;
        result
            .get("count")
            .and_then(Value::as_u64)
            .ok_or_else(|| EngineError::Protocol("count result omitted integer count".to_owned()))
    }

    fn locate(&self, query: &[u8], limit: usize) -> EngineResult<Vec<CanonicalSpan>> {
        if !self.capabilities.locate {
            return Err(EngineError::Unsupported("locate"));
        }
        let result = self.call(
            "locate",
            json!({ "query_hex": hex::encode(query), "limit": limit }),
        )?;
        let spans: Vec<CanonicalSpan> = serde_json::from_value(
            result
                .get("spans")
                .cloned()
                .ok_or_else(|| EngineError::Protocol("locate result omitted spans".to_owned()))?,
        )
        .map_err(|error| EngineError::Protocol(format!("decode locate spans: {error}")))?;
        for span in &spans {
            span.validate_within(&self.text_id, self.canonical_len)
                .map_err(|error| EngineError::InvalidSpan(error.to_string()))?;
        }
        Ok(spans)
    }

    fn extract(&self, span: &CanonicalSpan) -> EngineResult<Vec<u8>> {
        if !self.capabilities.extract {
            return Err(EngineError::Unsupported("extract"));
        }
        span.validate_within(&self.text_id, self.canonical_len)
            .map_err(|error| EngineError::InvalidSpan(error.to_string()))?;
        let result = self.call("extract", json!({ "span": span }))?;
        let encoded = result
            .get("bytes_hex")
            .and_then(Value::as_str)
            .ok_or_else(|| EngineError::Protocol("extract result omitted bytes_hex".to_owned()))?;
        hex::decode(encoded)
            .map_err(|error| EngineError::Protocol(format!("decode extract bytes: {error}")))
    }

    fn recover_all(&self) -> EngineResult<Vec<u8>> {
        if !self.capabilities.recover_all {
            return Err(EngineError::Unsupported("recover_all"));
        }
        let result = self.call("recover_all", Value::Null)?;
        let encoded = result
            .get("bytes_hex")
            .and_then(Value::as_str)
            .ok_or_else(|| EngineError::Protocol("recover_all result omitted bytes_hex".to_owned()))?;
        hex::decode(encoded)
            .map_err(|error| EngineError::Protocol(format!("decode recovery bytes: {error}")))
    }

    fn storage_components(&self) -> EngineResult<Vec<StorageComponent>> {
        let result = self.call("measure_storage", Value::Null)?;
        serde_json::from_value(
            result
                .get("components")
                .cloned()
                .ok_or_else(|| EngineError::Protocol("storage result omitted components".to_owned()))?,
        )
        .map_err(|error| EngineError::Protocol(format!("decode storage components: {error}")))
    }
}

fn validate_binding(expected: &EngineBinding, actual: &EngineBinding) -> EngineResult<()> {
    if expected.engine_id != actual.engine_id
        || expected.engine_kind != actual.engine_kind
        || expected.run_id != actual.run_id
        || expected.dataset_id != actual.dataset_id
        || expected.dataset_sha256 != actual.dataset_sha256
        || expected.config_sha256 != actual.config_sha256
    {
        return Err(EngineError::BindingMismatch(format!(
            "expected {:?}, received {:?}",
            expected, actual
        )));
    }
    Ok(())
}
