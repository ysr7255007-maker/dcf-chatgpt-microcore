//! End-to-end contract tests for the conventional database baseline, driven
//! through the real CLI binary (build -> calibrate -> recover -> verify).

use std::fs;
use std::path::PathBuf;
use std::process::Command;

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_dcf-db-baseline")
}

fn workdir(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("dcf-db-contract-{}-{}", tag, std::process::id()));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(&d).unwrap();
    d
}

fn run(args: &[&str], stdin: &str) -> (String, String) {
    let out = Command::new(bin())
        .args(args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    let mut child = out;
    use std::io::Write;
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(stdin.as_bytes())
        .unwrap();
    let out = child.wait_with_output().unwrap();
    (
        String::from_utf8_lossy(&out.stdout).to_string(),
        String::from_utf8_lossy(&out.stderr).to_string(),
    )
}

fn fixture(tag: &str) -> (PathBuf, PathBuf, PathBuf) {
    let dir = workdir(tag);
    // corpus: two messages, four records
    // message m1: text "hello 架构 world" + thinking "think read_file"
    // message m2: tool_result "\"input\" here"
    let corpus = "hello 架构 world\nthink read_file\x00\"input\" here\n".as_bytes().to_vec();
    let corpus_path = dir.join("corpus.bin");
    fs::write(&corpus_path, &corpus).unwrap();
    let boundaries = vec![
        "{\"text_id\":\"t1\",\"conversation_uuid\":\"c1\",\"message_uuid\":\"m1\",\"ordinal\":0,\"type\":\"text\",\"start\":0,\"end\":18}",
        "{\"text_id\":\"t2\",\"conversation_uuid\":\"c1\",\"message_uuid\":\"m1\",\"ordinal\":1,\"type\":\"thinking\",\"start\":19,\"end\":34}",
        "{\"text_id\":\"t3\",\"conversation_uuid\":\"c2\",\"message_uuid\":\"m2\",\"ordinal\":0,\"type\":\"tool_result\",\"start\":35,\"end\":48}",
    ]
    .join("\n");
    let boundaries_path = dir.join("boundaries.jsonl");
    fs::write(&boundaries_path, boundaries).unwrap();
    let out = dir.join("out");
    fs::create_dir_all(&out).unwrap();
    (corpus_path, boundaries_path, out)
}

#[test]
fn schema_has_fact_fts_span_and_block_structures() {
    let (corpus, bounds, out) = fixture("fx-schema");
    let (stdout, stderr) = run(
        &[
            corpus.to_str().unwrap(),
            bounds.to_str().unwrap(),
            out.to_str().unwrap(),
            "build",
        ],
        "",
    );
    assert!(stderr.is_empty(), "stderr: {}", stderr);
    let v: serde_json::Value = serde_json::from_str(stdout.trim()).unwrap();
    assert!(v["build_time_ms"].as_f64().unwrap() >= 0.0);
    let db = out.join("baseline.db");
    assert!(db.exists());
    let zst = out.join("text.zstpack");
    assert!(zst.exists());
    let _ = fs::remove_dir_all(out.parent().unwrap());
}

#[test]
fn exact_locate_returns_canonical_byte_spans() {
    let (corpus, bounds, out) = fixture("fx-locate");
    run(
        &[
            corpus.to_str().unwrap(),
            bounds.to_str().unwrap(),
            out.to_str().unwrap(),
            "build",
        ],
        "",
    );
    let (stdout, _) = run(
        &[
            corpus.to_str().unwrap(),
            bounds.to_str().unwrap(),
            out.to_str().unwrap(),
            "calibrate",
        ],
        "{\"op\":\"locate\",\"pattern\":\"架构\",\"limit\":0}\n\
         {\"op\":\"locate\",\"pattern\":\"read_file\",\"limit\":10}\n",
    );
    let mut lines = stdout.lines();
    let l1: serde_json::Value = serde_json::from_str(lines.next().unwrap()).unwrap();
    assert_eq!(l1["total"], 1);
    assert_eq!(l1["spans"][0]["start"], 6);
    assert_eq!(l1["operation_path"], "short_query_full_record_scan");
    let l2: serde_json::Value = serde_json::from_str(lines.next().unwrap()).unwrap();
    assert_eq!(l2["total"], 1);
    assert_eq!(l2["spans"][0]["start"], 25);
    assert_eq!(l2["operation_path"], "fts_trigram_verify");
    let _ = fs::remove_dir_all(out.parent().unwrap());
}

#[test]
fn extract_crosses_zstd_block_boundary() {
    let dir = workdir("cross");
    let mut corpus = vec![b'a'; 256 * 1024];
    corpus.extend_from_slice(b"XYZ0123456789");
    let corpus_path = dir.join("corpus.bin");
    fs::write(&corpus_path, &corpus).unwrap();
    let boundaries = format!(
        "{{\"text_id\":\"t1\",\"conversation_uuid\":\"c1\",\"message_uuid\":\"m1\",\"ordinal\":0,\"type\":\"text\",\"start\":0,\"end\":{}}}\n",
        corpus.len()
    );
    let bounds_path = dir.join("boundaries.jsonl");
    fs::write(&bounds_path, boundaries).unwrap();
    let out = dir.join("out");
    fs::create_dir_all(&out).unwrap();
    run(
        &[
            corpus_path.to_str().unwrap(),
            bounds_path.to_str().unwrap(),
            out.to_str().unwrap(),
            "build",
        ],
        "",
    );
    let (stdout, _) = run(
        &[
            corpus_path.to_str().unwrap(),
            bounds_path.to_str().unwrap(),
            out.to_str().unwrap(),
            "calibrate",
        ],
        "{\"op\":\"extract\",\"start\":262136,\"end\":262148}\n",
    );
    let v: serde_json::Value = serde_json::from_str(stdout.trim()).unwrap();
    assert_eq!(v["bytes"], 12);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn short_query_fallback_is_explicitly_reported() {
    let (corpus, bounds, out) = fixture("fx-short");
    run(
        &[
            corpus.to_str().unwrap(),
            bounds.to_str().unwrap(),
            out.to_str().unwrap(),
            "build",
        ],
        "",
    );
    let (stdout, _) = run(
        &[
            corpus.to_str().unwrap(),
            bounds.to_str().unwrap(),
            out.to_str().unwrap(),
            "calibrate",
        ],
        "{\"op\":\"count\",\"pattern\":\"架构\"}\n",
    );
    let v: serde_json::Value = serde_json::from_str(stdout.trim()).unwrap();
    assert_eq!(v["operation_path"], "short_query_full_record_scan");
    assert_eq!(v["count"], 1);
    let _ = fs::remove_dir_all(out.parent().unwrap());
}

#[test]
fn recover_reproduces_projection_sha256() {
    let (corpus, bounds, out) = fixture("fx-recover");
    run(
        &[
            corpus.to_str().unwrap(),
            bounds.to_str().unwrap(),
            out.to_str().unwrap(),
            "build",
        ],
        "",
    );
    let (stdout, _) = run(
        &[
            corpus.to_str().unwrap(),
            bounds.to_str().unwrap(),
            out.to_str().unwrap(),
            "recover",
        ],
        "",
    );
    let v: serde_json::Value = serde_json::from_str(stdout.trim()).unwrap();
    let expected = {
        use sha2::{Digest, Sha256};
        let data = fs::read(&corpus).unwrap();
        hex::encode(Sha256::digest(&data))
    };
    assert_eq!(v["recovered_sha256"].as_str().unwrap(), expected);
    assert_eq!(v["bytes"].as_u64().unwrap() as usize, fs::metadata(&corpus).unwrap().len() as usize);
    let _ = fs::remove_dir_all(out.parent().unwrap());
}
