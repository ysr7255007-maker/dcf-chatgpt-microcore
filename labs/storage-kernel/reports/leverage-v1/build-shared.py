#!/usr/bin/env python3
"""Generate shared facts for both architectures (not counted toward either side):

  shared/projection.bin              -- copy of the frozen full_trace projection
  shared/projection-boundaries.jsonl -- per-block provenance + canonical span,
                                        derived by replaying the exporter contract
                                        and validated byte-for-byte against the
                                        frozen corpus SHA-256.

Run from labs/storage-kernel cwd. Deterministic.
"""
import hashlib
import json
import os
import shutil
import sys

BASE = os.path.dirname(os.path.abspath(__file__))

import importlib.util


def _load_brm():
    spec = importlib.util.spec_from_file_location(
        "brm", os.path.join(BASE, "build-recovery-micro.py")
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


brm = _load_brm()

REPORT_ROOT = brm.REPORT_ROOT
SHARED_DIR = os.path.join(BASE, "shared")
PROJ_BIN = os.path.join(SHARED_DIR, "projection.bin")
BOUNDARIES = os.path.join(SHARED_DIR, "projection-boundaries.jsonl")


def main():
    os.makedirs(SHARED_DIR, exist_ok=True)
    blocks = brm.load_blocks()
    # validate the replay against the frozen projection
    full = brm.replay_full_trace(blocks)
    assert hashlib.sha256(full).hexdigest() == brm.FROZEN_SHA256, "replay mismatch"
    assert len(full) == brm.FROZEN_BYTES, "replay length mismatch"

    with open(PROJ_BIN, "wb") as f:
        f.write(full)
    if hashlib.sha256(full).hexdigest() != brm.FROZEN_SHA256:
        sys.exit("projection copy sha mismatch")

    # boundaries: content spans (exclude the newline after each block and the
    # NUL message separators / trailing NUL, exactly like the exporter's stream)
    cursor = 0
    lines = []
    prev_msg = None
    for b in blocks:
        msg = b["message_uuid"]
        if prev_msg is not None and msg != prev_msg:
            cursor += 1  # NUL separator between messages
        prev_msg = msg
        start = cursor
        cursor += len(b["content"])
        end = cursor
        cursor += 1  # newline after block
        rec = {
            "text_id": "%s/%d" % (msg, b["ordinal"]),
            "conversation_uuid": b["conversation_uuid"],
            "message_uuid": msg,
            "ordinal": b["ordinal"],
            "type": b["type"],
            "start": start,
            "end": end,
        }
        lines.append(rec)
    cursor += 1  # trailing NUL
    assert cursor == len(full), "boundary walk must end exactly at corpus length"

    with open(BOUNDARIES, "w") as f:
        for rec in lines:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    print("WROTE", PROJ_BIN, len(full), "bytes")
    print("WROTE", BOUNDARIES, len(lines), "boundaries")
    print("SHA256", brm.FROZEN_SHA256)


if __name__ == "__main__":
    main()
