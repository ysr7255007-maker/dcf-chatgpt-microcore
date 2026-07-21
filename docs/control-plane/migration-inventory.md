# DCF control-plane v2 → v3 migration inventory

Updated: 2026-07-21

| v2 fact | v3 destination | migration rule |
|---|---|---|
| `code_units[id].versions[version]` | `code_units[hash]` + `unit_versions[id]` | preserve code by hash; semantic version becomes an index label |
| same version, different hash | separate hash artifacts | preserve both; active Desired/Snapshot selects exact hash |
| `snapshots.current` | `committed.current` | preserve |
| `snapshots.last_known_good` | `committed.last_known_good` | preserve |
| no Stable field | `committed.stable` | seed from old LKG once; later only explicit acceptance may advance |
| `snapshots.history` | `committed.history` | preserve last 12 |
| `snapshots.candidate` | none | discard; old interrupted process is not an explicit Desired |
| candidate `unit.started` evidence | structured runtime observation | legacy events map to `ready`; new host also records exact execute success as `loaded` |
| registration list | `observed.registrations` | observe and reconcile against Committed Current |
| open-page execution | `observed.pages[page_instance_id]` | page migration occurs only after commit |
| plugin data | `plugin_data` | preserve unchanged |
| rc.1/Next migration state | `migration` | preserve unchanged |

The migration intentionally does not infer a new Desired from legacy candidate, current page state or a remote index check.
