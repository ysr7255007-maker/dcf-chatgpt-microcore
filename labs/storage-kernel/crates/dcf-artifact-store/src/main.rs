use anyhow::{Result, anyhow};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use std::time::Instant;

#[derive(Debug, serde::Serialize)]
struct ArtifactRegistration {
    artifact_id: String,
    sha256: String,
    original_filename: String,
    byte_length: u64,
    media_type: String,
    source_platform: String,
    imported_at: String,
    file_path: String,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("=== DCF Storage Kernel - Raw Artifact Registration ===");
    println!();

    let data_dir = "/Users/looy/Downloads/data-9a04c6f6-1bc4-484c-b958-8a724130ed63-1784783258-3b7a1433-batch-0000";
    let output_dir = "reports/artifacts";
    
    let files_to_register = vec![
        "conversations.json",
        "conversations_final.md", 
        "conversations_final_zh.md",
    ];

    let start_time = Instant::now();
    let mut registrations: Vec<ArtifactRegistration> = Vec::new();

    for filename in files_to_register {
        let file_path = PathBuf::from(data_dir).join(filename);
        
        if !file_path.exists() {
            eprintln!("❌ File not found: {:?}", file_path);
            continue;
        }

        println!("📦 Processing: {}", filename);
        let reg = process_artifact(&file_path)?;
        registrations.push(reg);
    }

    // Save JSON manifest
    fs::create_dir_all(output_dir)?;
    let manifest_path = PathBuf::from(output_dir).join("registration.json");
    let json_output = serde_json::to_string_pretty(&registrations)?;
    fs::write(&manifest_path, &json_output)?;

    let elapsed = start_time.elapsed();
    
    println!();
    println!("✅ Successfully registered {} artifacts", registrations.len());
    println!("📄 Manifest saved to: {:?}", manifest_path);
    println!("⏱️  Total time: {:.2?}", elapsed);

    Ok(())
}

fn process_artifact(file_path: &PathBuf) -> Result<ArtifactRegistration, Box<dyn std::error::Error>> {
    let metadata = fs::metadata(file_path)?;
    let byte_length = metadata.len();
    
    let filename = file_path
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| anyhow!("Invalid file name"))?;
    
    // Read file and compute SHA256
    let mut hasher = Sha256::new();
    let content = fs::read(file_path)?;
    hasher.update(&content);
    let result = hasher.finalize();
    let sha256 = format!("{:x}", result);
    
    Ok(ArtifactRegistration {
        artifact_id: sha256[..16].to_string(),
        sha256,
        original_filename: filename.to_string(),
        byte_length,
        media_type: detect_media_type(filename).to_string(),
        source_platform: "local".to_string(),
        imported_at: chrono::Utc::now().to_rfc3339(),
        file_path: file_path.display().to_string(),
    })
}

fn detect_media_type(filename: &str) -> &'static str {
    if filename.ends_with(".json") {
        "application/json"
    } else if filename.ends_with(".md") {
        "text/markdown"
    } else if filename.ends_with(".zip") {
        "application/zip"
    } else {
        "application/octet-stream"
    }
}