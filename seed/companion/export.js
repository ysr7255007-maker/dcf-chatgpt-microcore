#!/usr/bin/env node

/**
 * G3 Companion - Self-Interpreting Export Module
 *
 * Features:
 * - Markdown + JSONL self-explaining export format
 * - README header with embedded schema documentation and boundary status
 * - NOT_OBSERVE zero-residue principle: content from NOT_OBSERVE targets never appears in exports
 * - Machine-processable (events.jsonl) + human-readable (materials.md)
 * - Zero npm dependencies
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const EXPORT_SCHEMA_VERSION = 'g3-companion-v0';

/**
 * Export materials to timestamped directory
 * @param {Object} options
 * @param {Array} options.events - Events to export (will be filtered by NOT_OBSERVE)
 * @param {Array} [options.projections] - Materials projection rows
 * @param {Set<string>|Array<string>} [options.notObserveSourceIds] - source_ids under NOT_OBSERVE boundary
 * @param {string} [options.outputDir] - Output base directory (default: ~/.dcf/exports)
 * @returns {Promise<{success: boolean, exportPath?: string, stats?: Object, error?: string}>}
 */
async function exportMaterials({ events = [], projections = [], notObserveSourceIds = [], outputDir = null }) {
    const baseDir = outputDir || path.join(os.homedir(), '.dcf', 'exports');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const exportDir = path.join(baseDir, timestamp);

    const notObserveSet = notObserveSourceIds instanceof Set
        ? notObserveSourceIds
        : new Set(notObserveSourceIds);

    // Filter out NOT_OBSERVE content (zero-residue principle)
    const filteredEvents = filterNotObserveContent(events, notObserveSet);

    if (filteredEvents.length === 0 && projections.length === 0) {
        return { success: false, error: 'No exportable content after NOT_OBSERVE filtering' };
    }

    fs.mkdirSync(exportDir, { recursive: true });

    generateReadme(exportDir, filteredEvents, projections);
    generateMaterialsMarkdown(exportDir, filteredEvents, projections);
    generateEventsJsonl(exportDir, filteredEvents);

    // Post-export verification: NOT_OBSERVE zero residue must hold on the written files
    const residueCheck = verifyNotObserveZeroResidue(exportDir, notObserveSet, events);
    if (!residueCheck.passed) {
        // Delete incomplete export on failure; violation is reported truthfully
        try { fs.rmSync(exportDir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
        return { success: false, error: `NOT_OBSERVE zero-residue violated: ${residueCheck.reason}` };
    }

    return {
        success: true,
        exportPath: exportDir,
        stats: {
            eventCount: filteredEvents.length,
            projectionCount: projections.length,
            notObserveFiltered: events.length - filteredEvents.length
        }
    };
}

/**
 * Parse payload_json to object (string or object accepted)
 */
function parsePayload(payloadJson) {
    if (payloadJson == null) return null;
    if (typeof payloadJson === 'object') return payloadJson;
    try {
        return JSON.parse(payloadJson);
    } catch (_) {
        return null;
    }
}

/**
 * Filter out events under NOT_OBSERVE boundary.
 * Zero-residue: excluded events leave nothing in the export, not even IDs.
 * @param {Array} events - Raw events
 * @param {Set<string>} notObserveSet - source_ids with NOT_OBSERVE boundary
 * @returns {Array} Filtered events
 */
function filterNotObserveContent(events, notObserveSet = new Set()) {
    return events.filter(event => {
        // Source under NOT_OBSERVE boundary -> exclude entirely
        if (notObserveSet.has(event.source_id)) {
            return false;
        }

        const payload = parsePayload(event.payload_json);
        if (payload) {
            // Explicit NOT_OBSERVE marker in payload -> exclude
            if (payload.__boundary__ === 'NOT_OBSERVE') {
                return false;
            }
            // Entity governed by NOT_OBSERVE -> exclude
            if (payload.entity_id && notObserveSet.has(payload.entity_id)) {
                return false;
            }
        }

        return true;
    });
}

/**
 * Generate README.md with embedded schema documentation, provenance and boundary status
 */
function generateReadme(outputDir, events, projections) {
    const readmePath = path.join(outputDir, 'README.md');
    const eventTypes = [...new Set(events.map(e => e.event_type))];
    const attributions = [...new Set((projections || []).map(p => p.attribution_state).filter(Boolean))];

    const readmeContent = `# DCF Companion G3 Export

## Metadata

- **Export Time**: ${new Date().toISOString()}
- **Event Count**: ${events.length}
- **Projection Count**: ${projections.length}
- **Schema Version**: ${EXPORT_SCHEMA_VERSION}

## Provenance

This export was produced by the DCF companion (seed/companion/export.js) from the
local append-only event log. Every event line in events.jsonl is self-contained:
it carries its own event_type and schema_version so the file can be processed
without external context.

## Schema Documentation

### Event Envelope

\`\`\`json
{
  "schema_version": "${EXPORT_SCHEMA_VERSION}",
  "event_id": "ULID string",
  "source_id": "ULID string",
  "event_type": "material.*",
  "payload_json": {},
  "sha256": "hex-encoded SHA-256 or null",
  "created_at": "ISO8601 timestamp",
  "sequence_number": 0
}
\`\`\`

### Event Type Definitions (G3 Material Metabolism)

1. \`material.revision_candidate.created\` — new material revision candidate
   - payload: entity_id, base_sha256, candidate_sha256, candidate_body, source_ref, assertion_attribution
2. \`material.continuation_point.created\` — continuation point for later resumption
   - payload: entity_id, from_event_id, context_ref, assertion_attribution
3. \`material.attribution.transitioned\` — attribution state transition (forward-only)
   - payload: entity_id, target_ref, from_state, to_state, evidence_ref, assertion_attribution
4. \`material.sync.pushed\` / \`material.sync.pulled_back\` — GitHub sync facts
   - payload: repo, commit or content sha, candidate_path/branch, sync timestamps

### Attribution States (four-state, forward-only)

\`\`\`
ai_proposed -> user_tentative -> user_confirmed -> reality_verified
(forward transitions may skip levels; regression is rejected and recorded)
\`\`\`

## Boundary Status

### NOT_OBSERVE Zero-Residue Principle

- No content from sources with NOT_OBSERVE boundary appears anywhere in this export.
- Filtering happens before writing; a post-write scan re-verifies zero residue.
- If verification fails the whole export directory is removed and the export
  reports the violation truthfully.

## Files

| File | Audience | Format |
|------|----------|--------|
| README.md | humans | this file |
| materials.md | humans | Markdown narrative |
| events.jsonl | machines | one JSON object per line |

## Observed Event Types

\`\`\`
${eventTypes.join('\n') || '(none)'}
\`\`\`

## Observed Attribution States

\`\`\`
${attributions.join('\n') || '(none)'}
\`\`\`
`;

    fs.writeFileSync(readmePath, readmeContent);
}

/**
 * Generate materials.md (human-readable Markdown summary)
 */
function generateMaterialsMarkdown(outputDir, events, projections) {
    const mdPath = path.join(outputDir, 'materials.md');

    let content = '# DCF Companion G3 Materials\n\n';
    content += `*Generated: ${new Date().toISOString()}*\n\n---\n\n`;

    // Group by entity_id (fallback to source_id)
    const byEntity = new Map();
    for (const event of events) {
        const payload = parsePayload(event.payload_json);
        const entityId = (payload && payload.entity_id) || event.source_id;
        if (!byEntity.has(entityId)) {
            byEntity.set(entityId, []);
        }
        byEntity.get(entityId).push(event);
    }

    if (byEntity.size === 0) {
        content += '*No material events exported.*\n\n';
    } else {
        for (const [entityId, entityEvents] of byEntity.entries()) {
            content += `## Entity: ${entityId}\n\n`;

            for (const event of entityEvents) {
                const ts = event.created_at || '(no timestamp)';
                content += `### ${event.event_type} (${ts})\n\n`;

                const payload = parsePayload(event.payload_json);
                if (payload) {
                    content += '```json\n' + JSON.stringify(payload, null, 2) + '\n```\n\n';
                } else {
                    content += '_No payload_\n\n';
                }
            }

            content += '---\n\n';
        }
    }

    // Projections summary
    if (projections && projections.length > 0) {
        content += '# Latest Projections Summary\n\n';
        content += '| Entity ID | Attribution State | Candidate SHA |\n';
        content += '|-----------|-------------------|---------------|\n';

        for (const proj of projections) {
            const shortSha = proj.latest_candidate_sha256 ? proj.latest_candidate_sha256.slice(0, 8) : 'N/A';
            content += `| ${proj.entity_id} | ${proj.attribution_state} | ${shortSha} |\n`;
        }
        content += '\n';
    }

    fs.writeFileSync(mdPath, content);
}

/**
 * Generate events.jsonl (line-delimited JSON, each line self-contained)
 */
function generateEventsJsonl(outputDir, events) {
    const jsonlPath = path.join(outputDir, 'events.jsonl');

    let content = '';
    for (const event of events) {
        const payload = parsePayload(event.payload_json);
        const enrichedEvent = {
            schema_version: EXPORT_SCHEMA_VERSION,
            event_type: event.event_type,
            event_id: event.event_id,
            source_id: event.source_id,
            payload_json: payload,
            sha256: event.sha256 || null,
            created_at: event.created_at || null,
            sequence_number: event.sequence_number ?? null
        };
        content += JSON.stringify(enrichedEvent) + '\n';
    }

    fs.writeFileSync(jsonlPath, content);
}

/**
 * Verify NOT_OBSERVE zero-residue in the written export files.
 * Scans every export file for any trace of NOT_OBSERVE-bound sources:
 * their source_ids and their payload contents must be entirely absent.
 * @param {string} exportDir - Export directory to scan
 * @param {Set<string>} notObserveSet - source_ids with NOT_OBSERVE boundary
 * @param {Array} allEvents - Full pre-filter event list (to derive forbidden content)
 */
function verifyNotObserveZeroResidue(exportDir, notObserveSet = new Set(), allEvents = []) {
    const forbiddenStrings = [];

    // Schema-level vocabulary (enum values, boundary markers) legitimately appears
    // in the README schema documentation; it carries no NOT_OBSERVE content.
    const SCHEMA_VOCABULARY = new Set([
        'NOT_OBSERVE',
        'ai_proposed', 'user_tentative', 'user_confirmed', 'reality_verified'
    ]);

    // The IDs themselves must not appear
    for (const id of notObserveSet) {
        forbiddenStrings.push(id);
    }

    // Content of NOT_OBSERVE-bound events must not appear
    for (const event of allEvents) {
        const payload = parsePayload(event.payload_json);
        const entityId = payload && payload.entity_id;
        const isForbidden = notObserveSet.has(event.source_id)
            || (entityId && notObserveSet.has(entityId))
            || (payload && payload.__boundary__ === 'NOT_OBSERVE');

        if (isForbidden && payload) {
            for (const value of Object.values(payload)) {
                if (typeof value === 'string' && value.length > 0 && !SCHEMA_VOCABULARY.has(value)) {
                    forbiddenStrings.push(value);
                }
            }
        }
    }

    const filesToCheck = ['README.md', 'materials.md', 'events.jsonl'];

    for (const filename of filesToCheck) {
        const filepath = path.join(exportDir, filename);
        if (!fs.existsSync(filepath)) continue;

        const content = fs.readFileSync(filepath, 'utf8');

        for (const forbidden of forbiddenStrings) {
            if (forbidden && content.includes(forbidden)) {
                return {
                    passed: false,
                    reason: `NOT_OBSERVE-bound content found in ${filename}`
                };
            }
        }
    }

    return { passed: true };
}

module.exports = {
    EXPORT_SCHEMA_VERSION,
    exportMaterials,
    filterNotObserveContent,
    generateReadme,
    generateMaterialsMarkdown,
    generateEventsJsonl,
    verifyNotObserveZeroResidue
};
