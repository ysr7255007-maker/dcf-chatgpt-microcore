//! JSON-lines protocol compatible with the calibrated engine protocol so the
//! same harness drives both architectures:
//!
//!   {"op":"count","pattern":"..."}
//!   {"op":"locate","pattern":"...","limit":10}
//!   {"op":"extract","start":100,"end":1124}
//!   {"op":"recover"}
//!
//! Responses are one JSON object per line, in instruction order, with `time_us`
//! measured around the operation only.

use anyhow::{Context, Result, bail};
use rusqlite::Connection;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::io::Write;
use std::time::Instant;

use crate::search::{exact_search, unicode_scalars};
use crate::store::TextBlockStore;

pub enum Instruction {
    Count { pattern: String },
    Locate { pattern: String, limit: usize },
    Extract { start: u64, end: u64 },
    Recover,
}

pub fn parse_instruction(line: &str) -> Result<Option<Instruction>> {
    let line = line.trim();
    if line.is_empty() {
        return Ok(None);
    }
    let v: Value = serde_json::from_str(line)
        .with_context(|| format!("invalid instruction JSON: {}", line))?;
    let op = v["op"].as_str().unwrap_or("");
    match op {
        "count" => Ok(Some(Instruction::Count {
            pattern: v["pattern"].as_str().unwrap_or("").to_string(),
        })),
        "locate" => Ok(Some(Instruction::Locate {
            pattern: v["pattern"].as_str().unwrap_or("").to_string(),
            limit: v["limit"].as_u64().unwrap_or(0) as usize,
        })),
        "extract" => Ok(Some(Instruction::Extract {
            start: v["start"].as_u64().unwrap_or(0),
            end: v["end"].as_u64().unwrap_or(0),
        })),
        "recover" => Ok(Some(Instruction::Recover)),
        other => bail!("unknown op: {}", other),
    }
}

pub fn run_calibrate(store: &mut TextBlockStore, conn: &Connection, out: &mut impl Write) -> Result<()> {
    let stdin = std::io::stdin();
    use std::io::BufRead;
    for line in stdin.lock().lines() {
        let line = line?;
        let Some(ins) = parse_instruction(&line)? else {
            continue;
        };
        match ins {
            Instruction::Count { pattern } => {
                if unicode_scalars(&pattern) == 0 {
                    let out_line = json!({"op":"count","count":0,"time_us":0,"operation_path":"empty_pattern"});
                    writeln!(out, "{}", out_line)?;
                    continue;
                }
                let t0 = Instant::now();
                let res = exact_search(store, conn, &pattern, 0)?;
                let time_us = t0.elapsed().as_secs_f64() * 1e6;
                let out_line = json!({
                    "op": "count",
                    "count": res.total,
                    "time_us": time_us,
                    "operation_path": res.operation_path,
                });
                writeln!(out, "{}", out_line)?;
            }
            Instruction::Locate { pattern, limit } => {
                if unicode_scalars(&pattern) == 0 {
                    let out_line = json!({"op":"locate","requested":limit,"total":0,"returned":0,"time_us":0,"spans":[],"operation_path":"empty_pattern"});
                    writeln!(out, "{}", out_line)?;
                    continue;
                }
                let t0 = Instant::now();
                let res = exact_search(store, conn, &pattern, limit)?;
                let time_us = t0.elapsed().as_secs_f64() * 1e6;
                let spans: Vec<Value> = res
                    .hits
                    .iter()
                    .map(|h| {
                        json!({
                            "start": h.start,
                            "end": h.end,
                            "text_id": h.text_id,
                            "conversation_uuid": h.conversation_uuid,
                            "message_uuid": h.message_uuid,
                            "content_block_ordinal": h.content_block_ordinal,
                            "content_type": h.content_type,
                        })
                    })
                    .collect();
                let out_line = json!({
                    "op": "locate",
                    "requested": limit,
                    "total": res.total,
                    "returned": res.returned,
                    "time_us": time_us,
                    "spans": spans,
                    "operation_path": res.operation_path,
                });
                writeln!(out, "{}", out_line)?;
            }
            Instruction::Extract { start, end } => {
                let t0 = Instant::now();
                let bytes = store.extract(start, end)?;
                let time_us = t0.elapsed().as_secs_f64() * 1e6;
                let sha = hex::encode(Sha256::digest(&bytes));
                let out_line = json!({
                    "op": "extract",
                    "bytes": bytes.len(),
                    "time_us": time_us,
                    "sha256": sha,
                });
                writeln!(out, "{}", out_line)?;
            }
            Instruction::Recover => {
                let t0 = Instant::now();
                let recovered = store.recover_all()?;
                let time_us = t0.elapsed().as_secs_f64() * 1e6;
                let recovered_sha = hex::encode(Sha256::digest(&recovered));
                let corpus_bytes = store.corpus_bytes();
                let out_line = json!({
                    "op": "recover",
                    "bytes": recovered.len(),
                    "corpus_bytes": corpus_bytes,
                    "time_us": time_us,
                    "recovered_sha256": recovered_sha,
                    "recovery_semantics": "byte_exact",
                });
                writeln!(out, "{}", out_line)?;
            }
        }
    }
    Ok(())
}
