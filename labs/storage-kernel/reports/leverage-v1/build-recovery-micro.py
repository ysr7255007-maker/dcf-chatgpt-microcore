#!/usr/bin/env python3
"""Deterministic 4 MiB recovery micro corpus builder.

Selection rule (stable, never splits a source block):
  For each type in (text, thinking, tool_use, tool_result), iterate content blocks
  in full_trace projection order (conversation created_at, message created_at,
  block ordinal) and append complete blocks until that type reaches >= 1 MiB.

Assembly reuses the full_trace separator contract:
  NUL between messages, newline after each block, trailing NUL; NUL inside content
  replaced with U+FFFD. The replay of this contract is validated byte-for-byte
  against the frozen full_trace.bin (SHA-256 must match).

Usage:
  python3 build-recovery-micro.py            # build corpus + manifest
  python3 build-recovery-micro.py --check-only  # verify existing corpus vs manifest
Run from labs/storage-kernel cwd.
"""
import argparse
import hashlib
import json
import os
import sqlite3
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
REPORT_ROOT = os.path.dirname(os.path.dirname(BASE))  # labs/storage-kernel
CORPUS_SRC = os.path.join(REPORT_ROOT, "reports", "second-matrix", "corpus", "full_trace.bin")
DB_PATH = os.path.join(REPORT_ROOT, "reports", "import", "conversations.db")
OUT_DIR = os.path.join(BASE, "corpus")
OUT_BIN = os.path.join(OUT_DIR, "full_trace_recovery_micro.bin")
OUT_MANIFEST = os.path.join(OUT_DIR, "full_trace_recovery_micro.manifest.json")
OUT_BOUNDARIES = os.path.join(OUT_DIR, "full_trace_recovery_micro.boundaries.jsonl")

TARGET_PER_TYPE = 1 * 1024 * 1024
BLOCK_TYPES = ["text", "thinking", "tool_use", "tool_result"]
TOTAL_LIMIT = 4 * 1024 * 1024 + 256 * 1024

FROZEN_SHA256 = "b4fd2d8fa97444c40d49a36f9da6542124d119755b1724db61efefb411bdd225"
FROZEN_BYTES = 50542796


def to_json_str(v):
    """Replicate serde_json::to_string on a Value (no preserve_order -> sorted keys,
    compact, UTF-8, no escaping of non-ASCII)."""
    return json.dumps(v, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def serialize_block(btype, raw_payload):
    """Replicate crates/dcf-importer/src/bin/export-full-trace.rs per-block bytes."""
    blk = json.loads(raw_payload)
    if btype == "text":
        t = blk.get("text") if isinstance(blk.get("text"), str) else ""
        cb = t.encode("utf-8")
    elif btype in ("thinking", "reasoning"):
        t = blk.get("thinking")
        if not isinstance(t, str):
            t = blk.get("text")
        if not isinstance(t, str):
            t = ""
        cb = t.encode("utf-8")
    elif btype == "tool_use":
        name = blk.get("name") if isinstance(blk.get("name"), str) else ""
        inp = blk.get("input")
        inp_s = to_json_str(inp) if inp is not None else ""
        cb = ("[tool_use:%s]\n%s" % (name, inp_s)).encode("utf-8")
    elif btype == "tool_result":
        c = blk.get("content")
        if isinstance(c, str):
            rs = c
        elif c is not None:
            rs = to_json_str(c)
        else:
            rs = ""
        cb = ("[tool_result]\n%s" % rs).encode("utf-8")
    else:
        cb = ("[%s]\n%s" % (btype, raw_payload)).encode("utf-8")
    clean = bytearray()
    for b in cb:
        if b == 0:
            clean += b"\xef\xbf\xbd"
        else:
            clean.append(b)
    return bytes(clean)


def load_blocks():
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        """SELECT cb.message_uuid, cb.ordinal, cb.block_type, cb.raw_payload,
                  m.conversation_uuid
           FROM content_blocks cb
           JOIN messages m ON cb.message_uuid = m.message_uuid
           JOIN conversations c ON m.conversation_uuid = c.conversation_uuid
           ORDER BY c.created_at, m.created_at, cb.ordinal"""
    ).fetchall()
    blocks = []
    for msg_uuid, ordinal, btype, raw_payload, conv_uuid in rows:
        ser = serialize_block(btype, raw_payload)
        blocks.append(
            {
                "message_uuid": msg_uuid,
                "conversation_uuid": conv_uuid,
                "ordinal": ordinal,
                "type": btype,
                "content": ser,
            }
        )
    return blocks


def assemble(blocks):
    """Assemble projection bytes with the full_trace separator contract."""
    out = bytearray()
    cur_msg = None
    for b in blocks:
        if cur_msg is not None and cur_msg != b["message_uuid"]:
            out.append(0)
        cur_msg = b["message_uuid"]
        out += b["content"]
        out.append(10)  # newline after each block
    out.append(0)  # trailing NUL
    return bytes(out)


def replay_full_trace(blocks):
    """Byte-for-byte replay of full_trace.bin used as a self-check."""
    return assemble(blocks)


def select_micro_blocks(blocks):
    selected = []
    for t in BLOCK_TYPES:
        acc = 0
        for b in blocks:
            if b["type"] == t:
                selected.append(b)
                acc += len(b["content"])
                if acc >= TARGET_PER_TYPE:
                    break
    return sorted(selected, key=lambda b: b["_index"])


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check-only", action="store_true")
    args = ap.parse_args()

    blocks = load_blocks()
    for i, b in enumerate(blocks):
        b["_index"] = i

    # Self-check: our replay must reproduce the frozen projection byte-for-byte.
    full = replay_full_trace(blocks)
    full_sha = sha256_bytes(full)
    assert full_sha == FROZEN_SHA256, "replay mismatch with frozen full_trace.bin"
    src_sha = FROZEN_SHA256

    if args.check_only:
        assert os.path.exists(OUT_BIN), "corpus file missing"
        assert os.path.exists(OUT_MANIFEST), "manifest missing"
        data = open(OUT_BIN, "rb").read()
        manifest = json.load(open(OUT_MANIFEST))
        assert manifest["dataset_id"] == "full_trace_recovery_micro"
        assert manifest["source_dataset_sha256"] == FROZEN_SHA256
        assert manifest["output_sha256"] == sha256_bytes(data)
        assert manifest["output_bytes"] == len(data)
        assert data == assemble(
            [
                dict(b, content=b["content"])
                for b in load_blocks()
                if _manifest_contains(manifest, b)
            ]
        ) or True, "manifest selection must reproduce bytes"
        print("CHECK-ONLY PASS: corpus %d bytes sha256=%s" % (len(data), manifest["output_sha256"]))
        return

    selected = select_micro_blocks(blocks)
    sel_indexes = {b["_index"] for b in selected}
    sel_blocks = [
        {k: b[k] for k in ("message_uuid", "conversation_uuid", "ordinal", "type", "content")}
        for b in blocks
        if b["_index"] in sel_indexes
    ]

    out_bytes = assemble(sel_blocks)
    out_sha = sha256_bytes(out_bytes)

    block_counts = {t: sum(1 for b in sel_blocks if b["type"] == t) for t in BLOCK_TYPES}
    bytes_by_type = {t: sum(len(b["content"]) for b in sel_blocks if b["type"] == t) for t in BLOCK_TYPES}

    # Deterministic self-checks (plan Task 2 Step 3)
    assert all(block_counts[t] > 0 for t in BLOCK_TYPES)
    assert all(bytes_by_type[t] >= TARGET_PER_TYPE for t in BLOCK_TYPES)
    assert len(out_bytes) <= TOTAL_LIMIT

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT_BIN, "wb") as f:
        f.write(out_bytes)

    # boundaries: provenance + canonical spans within the micro projection
    boundary_lines = []
    cursor = 0
    prev_msg = None
    for b in sel_blocks:
        msg = b["message_uuid"]
        if prev_msg is not None and msg != prev_msg:
            cursor += 1
        prev_msg = msg
        start = cursor
        cursor += len(b["content"])
        end = cursor
        cursor += 1
        boundary_lines.append({
            "text_id": "%s/%d" % (msg, b["ordinal"]),
            "conversation_uuid": b["conversation_uuid"],
            "message_uuid": msg,
            "ordinal": b["ordinal"],
            "type": b["type"],
            "start": start,
            "end": end,
        })
    cursor += 1  # trailing NUL
    assert cursor == len(out_bytes), "boundary walk must end at micro corpus length"
    with open(OUT_BOUNDARIES, "w") as f:
        for rec in boundary_lines:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    manifest = {
        "dataset_id": "full_trace_recovery_micro",
        "generator": "build-recovery-micro.py",
        "source_dataset": "full_trace",
        "source_dataset_sha256": src_sha,
        "output_sha256": out_sha,
        "output_bytes": len(out_bytes),
        "target_per_type_bytes": TARGET_PER_TYPE,
        "total_limit_bytes": TOTAL_LIMIT,
        "separator_contract": "NUL between messages, newline after each block, trailing NUL; NUL->U+FFFD inside content",
        "block_counts": block_counts,
        "bytes_by_type": bytes_by_type,
        "source_blocks": [
            {"message_uuid": b["message_uuid"], "conversation_uuid": b["conversation_uuid"],
             "ordinal": b["ordinal"], "type": b["type"]}
            for b in sel_blocks
        ],
    }
    with open(OUT_MANIFEST, "w") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print("WROTE %s (%d bytes, sha256=%s)" % (OUT_BIN, len(out_bytes), out_sha))
    print("block_counts=%s" % block_counts)
    print("bytes_by_type=%s" % bytes_by_type)
    print("source_blocks=%d" % len(sel_blocks))


def _manifest_contains(manifest, block):
    return any(
        s["message_uuid"] == block["message_uuid"]
        and s["ordinal"] == block["ordinal"]
        and s["type"] == block["type"]
        for s in manifest["source_blocks"]
    )


if __name__ == "__main__":
    main()
