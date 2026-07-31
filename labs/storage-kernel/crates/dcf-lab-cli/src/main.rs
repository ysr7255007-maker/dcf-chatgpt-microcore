use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use dcf_contract::{ExperimentReport, QueryCase};
use dcf_corpus::{
    load_experiment_spec, prepare_all, profile_file, read_prepared_dataset, PreparedDataset,
};
use dcf_engine_api::{Engine, TruthScanner};
use dcf_lab_core::{
    build_engine, load_engine_suite, load_queries, report, run_engine, validate_report, RunOptions,
};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Parser)]
#[command(name = "dcf-storage-lab")]
#[command(about = "Disposable DCF storage/search kernel experiment harness")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    Profile {
        #[arg(long)]
        spec: PathBuf,
    },
    Prepare {
        #[arg(long)]
        spec: PathBuf,
        #[arg(long)]
        out: PathBuf,
    },
    Truth {
        #[arg(long)]
        dataset: PathBuf,
        #[arg(long)]
        queries: PathBuf,
    },
    Run {
        #[arg(long)]
        datasets: PathBuf,
        #[arg(long)]
        engines: PathBuf,
        #[arg(long)]
        queries: PathBuf,
        #[arg(long)]
        artifacts: PathBuf,
        #[arg(long)]
        runs: PathBuf,
        #[arg(long)]
        report: PathBuf,
        #[arg(long)]
        machine: Option<PathBuf>,
    },
    VerifyReport {
        #[arg(long)]
        report: PathBuf,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Profile { spec } => profile_command(&spec),
        Command::Prepare { spec, out } => prepare_command(&spec, &out),
        Command::Truth { dataset, queries } => truth_command(&dataset, &queries),
        Command::Run {
            datasets,
            engines,
            queries,
            artifacts,
            runs,
            report,
            machine,
        } => run_command(
            &datasets,
            &engines,
            &queries,
            &artifacts,
            &runs,
            &report,
            machine.as_deref(),
        ),
        Command::VerifyReport { report } => verify_report_command(&report),
    }
}

fn profile_command(spec_path: &Path) -> Result<()> {
    let loaded = load_experiment_spec(spec_path)?;
    let mut rows = Vec::new();
    for input in loaded.resolved_variants() {
        rows.push(json!({
            "source_set_id": loaded.spec.source_set_id,
            "variant": input.variant,
            "path": input.path,
            "profile": profile_file(&input.path)?,
        }));
    }
    println!("{}", serde_json::to_string_pretty(&rows)?);
    Ok(())
}

fn prepare_command(spec_path: &Path, output: &Path) -> Result<()> {
    let loaded = load_experiment_spec(spec_path)?;
    let datasets = prepare_all(&loaded, output)?;
    let manifests: Vec<_> = datasets
        .into_iter()
        .map(|dataset| {
            json!({
                "root": dataset.root,
                "manifest": dataset.manifest,
            })
        })
        .collect();
    println!("{}", serde_json::to_string_pretty(&manifests)?);
    Ok(())
}

fn truth_command(dataset_root: &Path, query_path: &Path) -> Result<()> {
    let dataset = read_prepared_dataset(dataset_root)?;
    let scanner = truth_scanner(&dataset)?;
    let queries = load_queries(query_path)?;
    let mut results = Vec::new();
    for query in queries {
        let bytes = query.query.as_bytes();
        results.push(json!({
            "query": query,
            "count": scanner.count(bytes)?,
            "spans": scanner.locate(bytes, query.locate_limit)?,
        }));
    }
    println!("{}", serde_json::to_string_pretty(&results)?);
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn run_command(
    dataset_spec_path: &Path,
    engine_spec_path: &Path,
    query_path: &Path,
    artifact_root: &Path,
    run_root: &Path,
    report_path: &Path,
    machine_path: Option<&Path>,
) -> Result<()> {
    let dataset_spec = load_experiment_spec(dataset_spec_path)?;
    let source_set_id = dataset_spec.spec.source_set_id.clone();
    let datasets = prepare_all(&dataset_spec, artifact_root)?;
    let engine_suite = load_engine_suite(engine_spec_path)?;
    let queries = load_queries(query_path)?;
    let options = RunOptions::from(&engine_suite.spec);
    let machine = load_machine(machine_path)?;

    fs::create_dir_all(run_root)?;
    let batch_id = run_id("batch");
    let batch_root = run_root.join(&batch_id);
    fs::create_dir_all(&batch_root)?;

    let mut reports = Vec::new();
    for dataset in &datasets {
        for definition in &engine_suite.spec.engines {
            let run_id = format!(
                "{}-{}-{}",
                batch_id,
                dataset.manifest.variant.as_str(),
                definition.id
            );
            let engine_root = batch_root
                .join(dataset.manifest.variant.as_str())
                .join(&definition.id);
            let built = build_engine(
                &engine_suite,
                definition,
                dataset,
                &run_id,
                &engine_root,
            )
            .with_context(|| {
                format!(
                    "build engine {} for dataset {}",
                    definition.id, dataset.manifest.dataset_id
                )
            })?;
            reports.push(run_engine(
                dataset,
                &built,
                &run_id,
                &queries,
                &options,
                machine.clone(),
            )?);
        }
    }

    let report = report(source_set_id, reports);
    validate_report(&report)?;
    if let Some(parent) = report_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(report_path, serde_json::to_vec_pretty(&report)?)?;
    println!("{}", serde_json::to_string_pretty(&report)?);
    Ok(())
}

fn verify_report_command(path: &Path) -> Result<()> {
    let bytes = fs::read(path)?;
    let report: ExperimentReport = serde_json::from_slice(&bytes)?;
    validate_report(&report)?;
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "valid": true,
            "all_correct": report.all_correct(),
            "run_count": report.runs.len(),
        }))?
    );
    Ok(())
}

fn truth_scanner(dataset: &PreparedDataset) -> Result<TruthScanner> {
    Ok(TruthScanner::from_file(
        dataset.manifest.text_id.clone(),
        dataset.manifest.canonical_sha256.clone(),
        dataset.canonical_path(),
    )?)
}

fn load_machine(path: Option<&Path>) -> Result<BTreeMap<String, Value>> {
    let Some(path) = path else {
        return Ok(BTreeMap::new());
    };
    let bytes = fs::read(path)?;
    Ok(serde_json::from_slice(&bytes)?)
}

fn run_id(prefix: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("{prefix}-{nanos}")
}

#[allow(dead_code)]
fn _queries_are_language_neutral(_queries: &[QueryCase]) {}
