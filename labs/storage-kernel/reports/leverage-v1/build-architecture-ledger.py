#!/usr/bin/env python3
"""Architecture leverage ledger for leverage-v1.

Populated from the ACTUAL implementation and measured artifacts (not aspiration):
persistent structures (with classification), synchronization edges (authority,
detection, recovery, blast radius), capability sources (native / small_adapter /
secondary_structure / cross_system_orchestration), recovery paths, engineering
surface (files, logical LOC), persistent file types, independent build/recovery
paths.

Run from labs/storage-kernel cwd. Validates storage-bom and capability-parity
linkage while writing architecture-ledger.json.
"""
import json
import os
import re

BASE = os.path.dirname(os.path.abspath(__file__))
BOM = os.path.join(BASE, "storage-bom.json")
PARITY = os.path.join(BASE, "capability-parity.json")
OUT = os.path.join(BASE, "architecture-ledger.json")

CRATE = os.path.join(BASE, "..", "..", "crates", "dcf-db-baseline")

CAPABILITIES = [
    "count_exact",
    "locate_first_n",
    "extract_span",
    "recover_all",
    "hit_provenance_trace",
    "filter_content_type",
    "filter_conversation",
    "positionset_intersect",
    "positionset_union",
    "positionset_difference",
    "near_same_message",
    "top10_with_context",
]


def logical_loc(path):
    loc = 0
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("//") or line.startswith("#") or line.startswith("/*"):
                continue
            if line.startswith("*"):
                continue
            loc += 1
    return loc


def collect_rust_sources():
    files = []
    for root, _dirs, names in os.walk(CRATE):
        for n in names:
            if n.endswith(".rs"):
                files.append(os.path.join(root, n))
    return files


def collect_python_sources():
    files = []
    for n in sorted(os.listdir(BASE)):
        if n.endswith(".py"):
            files.append(os.path.join(BASE, n))
    return files


def main():
    bom = json.load(open(BOM))
    parity = json.load(open(PARITY))

    rust_files = collect_rust_sources()
    py_files = collect_python_sources()
    all_files = rust_files + py_files
    total_loc = sum(logical_loc(f) for f in all_files)
    py_loc = sum(logical_loc(f) for f in py_files)
    rust_loc = sum(logical_loc(f) for f in rust_files)

    ledger = {
        "black_hole": {
            "architecture_id": "black_hole",
            "physical_representative": "utf8-a1-sdsl (csa_wt<wt_hutu<rrr_vector<63>>, 64, 64>)",
            "persistent_structures": [
                {
                    "name": "CSA self-index (.csa)",
                    "role": "text + exact-substring index + positions + recovery in one structure",
                    "classification": "authoritative_fact",
                    "required": True,
                },
                {
                    "name": "segment manifest (manifest.json)",
                    "role": "segment identity / projection hash / engine identity",
                    "classification": "rebuildable_projection",
                    "required": True,
                },
            ],
            "shared_contract_structures": [
                {
                    "name": "projection.bin (shared)",
                    "role": "canonical projection bytes + SHA-256",
                    "classification": "authoritative_fact (shared, not architecture-owned)",
                    "required": True,
                },
                {
                    "name": "projection-boundaries.jsonl (shared)",
                    "role": "span -> conversation/message/ordinal/type upper contract",
                    "classification": "authoritative_fact (shared, not architecture-owned)",
                    "required": True,
                }
            ],
            "synchronization_edges": [
                {
                    "from": "CSA self-index",
                    "to": "segment manifest",
                    "authority": "canonical projection",
                    "detection": "manifest projection_sha256 vs frozen corpus sha + parity test",
                    "recovery": "rebuild CSA from canonical projection",
                    "blast_radius": "single segment",
                }
            ],
            "capability_sources": {
                "count_exact": "native",
                "locate_first_n": "native",
                "extract_span": "native",
                "recover_all": "native",
                "hit_provenance_trace": "small_adapter",
                "filter_content_type": "small_adapter",
                "filter_conversation": "small_adapter",
                "positionset_intersect": "small_adapter",
                "positionset_union": "small_adapter",
                "positionset_difference": "small_adapter",
                "near_same_message": "small_adapter",
                "top10_with_context": "native",
            },
            "recovery_paths": [
                {
                    "path": "recover_from_self_index",
                    "structures_read": ["CSA self-index"],
                    "steps": 1,
                    "semantics": "canonical_byte_equivalent (NUL->0x01, trailing sentinel documented)",
                }
            ],
            "independent_build_paths": 1,
            "independent_recovery_paths": 1,
            "persistent_file_types": ["CSA binary", "JSON manifest", "shared JSONL contract"],
            "custom_source_files": [
                os.path.relpath(f, os.path.join(BASE, "..", "..")) for f in
                ([os.path.join(BASE, "build-shared.py"), os.path.join(BASE, "build-recovery-micro.py"),
                  os.path.join(BASE, "verify-capabilities.py"), os.path.join(BASE, "run-leverage.py"),
                  os.path.join(BASE, "run-lifecycle.py"), os.path.join(BASE, "build-architecture-ledger.py"),
                  os.path.join(BASE, "verify-leverage.py")] if os.path.exists(os.path.join(BASE, "run-lifecycle.py")) else [])
            ],
            "external_dependencies": ["sdsl-lite (C++ header-only)"],
            "logical_loc": py_loc + 0,  # harness/shared python; engine is the prebuilt C++ binary
        },
        "conventional_db": {
            "architecture_id": "conventional_db",
            "implementation": "dcf-db-baseline crate",
            "persistent_structures": [
                {
                    "name": "dataset_manifest (sqlite)",
                    "role": "dataset identity + projection hash",
                    "classification": "authoritative_fact",
                    "required": True,
                },
                {
                    "name": "records (sqlite)",
                    "role": "structured facts: conversation/message/ordinal/type/canonical span",
                    "classification": "authoritative_fact",
                    "required": True,
                },
                {
                    "name": "records_search_content (sqlite)",
                    "role": "searchable text mirror for FTS5 external content",
                    "classification": "rebuildable_projection",
                    "required": True,
                },
                {
                    "name": "records_fts (sqlite FTS5 trigram)",
                    "role": "candidate record index",
                    "classification": "rebuildable_projection",
                    "required": True,
                },
                {
                    "name": "text_blocks (sqlite)",
                    "role": "block directory: canonical range -> frame offset/len/hash",
                    "classification": "rebuildable_projection",
                    "required": True,
                },
                {
                    "name": "text.zstpack",
                    "role": "independent compressed text body (zstd level 19, 256 KiB blocks)",
                    "classification": "authoritative_fact",
                    "required": True,
                },
                {
                    "name": "manifest.json",
                    "role": "build identity",
                    "classification": "display_only",
                    "required": True,
                },
            ],
            "synchronization_edges": [
                {
                    "from": "text_blocks directory",
                    "to": "text.zstpack frames",
                    "authority": "canonical projection",
                    "detection": "block sha256 recompute vs directory",
                    "recovery": "rebuild blocks from projection",
                    "blast_radius": "affected dataset",
                },
                {
                    "from": "records spans",
                    "to": "text_blocks / text.zstpack",
                    "authority": "canonical projection + boundary contract",
                    "detection": "verify mode: records vs boundaries + extract",
                    "recovery": "re-import records from boundary contract",
                    "blast_radius": "affected dataset",
                },
                {
                    "from": "records_search_content",
                    "to": "records_fts",
                    "authority": "records_search_content",
                    "detection": "FTS row count vs content row count",
                    "recovery": "rebuild-fts (drop + recreate + rebuild)",
                    "blast_radius": "search recall on affected dataset",
                },
                {
                    "from": "dataset_manifest",
                    "to": "all tables + pack",
                    "authority": "canonical projection sha",
                    "detection": "recover sha256 vs manifest",
                    "recovery": "full rebuild",
                    "blast_radius": "affected dataset",
                },
            ],
            "capability_sources": {
                "count_exact": "cross_system_orchestration",
                "locate_first_n": "cross_system_orchestration",
                "extract_span": "secondary_structure",
                "recover_all": "secondary_structure",
                "hit_provenance_trace": "native",
                "filter_content_type": "native",
                "filter_conversation": "native",
                "positionset_intersect": "small_adapter",
                "positionset_union": "small_adapter",
                "positionset_difference": "small_adapter",
                "near_same_message": "small_adapter",
                "top10_with_context": "cross_system_orchestration",
            },
            "recovery_paths": [
                {
                    "path": "recover_text_from_zstpack",
                    "structures_read": ["text_blocks", "text.zstpack"],
                    "steps": 2,
                    "semantics": "byte_exact",
                },
                {
                    "path": "rebuild_fts_index",
                    "structures_read": ["records_search_content"],
                    "steps": 2,
                    "semantics": "candidate recall restored",
                },
            ],
            "independent_build_paths": 2,
            "independent_recovery_paths": 2,
            "persistent_file_types": ["SQLite DB", "zstd pack", "JSON manifest"],
            "custom_source_files": [
                os.path.relpath(f, os.path.join(BASE, "..", "..")) for f in rust_files
            ],
            "external_dependencies": ["rusqlite bundled SQLite/FTS5", "zstd 0.13", "serde/serde_json", "sha2", "clap"],
            "logical_loc": rust_loc,
        },
    }

    # ---- validation: storage-bom linkage ----
    bom_components = []
    for arch in ("black_hole", "conventional_db"):
        for c in bom[arch]["components"]:
            bom_components.append((arch, c["path"]))
    for arch, path in bom_components:
        if arch == "black_hole":
            names = [s["name"] for s in ledger["black_hole"]["persistent_structures"]]
            if "manifest.json" in path:
                assert any("manifest" in n for n in names), "ledger missing black-hole manifest"
            if "full_trace.bin.csa" in path:
                assert any("CSA" in n for n in names), "ledger missing CSA"
        else:
            names = [s["name"] for s in ledger["conventional_db"]["persistent_structures"]]
            base = os.path.basename(path)
            if base == "baseline.db":
                assert any("records" in n or "manifest" in n for n in names)
            elif base == "text.zstpack":
                assert any("zstpack" in n for n in names)
            elif base == "manifest.json":
                assert any("manifest.json" in n for n in names)

    # ---- validation: capability linkage ----
    for arch in ("black_hole", "conventional_db"):
        srcs = ledger[arch]["capability_sources"]
        assert set(srcs.keys()) == set(CAPABILITIES), "capability set mismatch for %s" % arch
        assert set(srcs.values()) <= {"native", "small_adapter", "secondary_structure", "cross_system_orchestration"}

    # ---- validation: parity linkage ----
    assert parity["status"] == "passed"

    ledger["_engineering_surface"] = {
        "python_harness_files": len(py_files),
        "rust_crate_files": len(rust_files),
        "logical_loc_python_harness_and_shared": py_loc,
        "logical_loc_rust_crate": rust_loc,
        "total_logical_loc": total_loc,
        "note": "LOC is weak evidence; recorded for completeness only",
    }
    ledger["_validations"] = {
        "storage_bom_linkage": "ok",
        "capability_linkage": "ok",
        "parity_gate": parity["status"],
    }
    with open(OUT, "w") as f:
        json.dump(ledger, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print("WROTE", OUT)
    print("black_hole sync edges:", len(ledger["black_hole"]["synchronization_edges"]))
    print("conventional sync edges:", len(ledger["conventional_db"]["synchronization_edges"]))
    print("logical LOC: python=%d rust=%d" % (py_loc, rust_loc))


if __name__ == "__main__":
    main()
