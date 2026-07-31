)} = content_item.get("type").and_then(|c| c.as_str()).map(|t| (t.to_string(), true)) {
        match ty.as_str() {
            "text" => *text_count += 1,
            "reasoning" | "thinking" | "thought" => *thinking_count += 1,
            "tool_use" => *tool_use_count += 1,
            "tool_result" => *tool_result_count += 1,
            _ => {
                eprintln!("     Unknown type: {}", ty);
                *unknown_count += 1;
            }
        }
    } else {
        *unknown_count += 1;
    };
    
    // Compute block ID and hash
    *block_id_counter += 1;
    let block_id = format!("cb-{}-{block_id_counter:08x}", msg_uuid[..8].clone());
    
    let raw_payload = serde_json::to_string(content_item).unwrap_or_default();
    let payload_bytes = raw_payload.len() as u64;
    *total_bytes += payload_bytes;
    
    let mut hasher = Sha256::new();
    hasher.update(raw_payload.as_bytes());
    let source_field_hash = format!("{:x}", hasher.finalize());
    
    // Insert into content_blocks table
    conn.execute(
        r#"INSERT INTO content_blocks 
           (block_id, message_uuid, ordinal, block_type, raw_payload, payload_bytes, 
            source_field_hash, source_blob_sha256, source_json_pointer)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
        params![
            block_id,
            msg_uuid,
            ordinal,
            block_type,
            raw_payload,
            payload_bytes,
            source_field_hash,
            "a0fa4eb8449ee5ea08e8f48b1ab3d9c61653df2d9454ee79953c9a0e3e11a786", // From conversations.json
            format!("/chat_messages/{}/content[{}]", msg_uuid, ordinal)
        ],
    )?;
    
    Ok(())
}

fn update_message_counts(
    conn: &Connection,
    text_count: i32,
    thinking_count: i32,
    tool_use_count: i32,
    tool_result_count: i32,
    unknown_count: i32,
) -> Result<()> {
    // We can't easily update each message individually without knowing their counts
    // For now, just set a total count in a stats table or log this info
    
    println!("Total counts to apply to messages table:");
    println!("  Text: {}, Thinking: {}, Tool Use: {}, Tool Result: {}, Unknown: {}", 
             text_count, thinking_count, tool_use_count, tool_result_count, unknown_count);
             
    Ok(())
}

fn get_message_count(conn: &Connection) -> Result<usize> {
    let count: usize = conn.query_row("SELECT COUNT(*) FROM messages", [], |r| r.get(0))?;
    Ok(count)
}
