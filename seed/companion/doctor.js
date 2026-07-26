/**
 * G2 Companion - Self-healing Doctor
 *
 * Runs at companion startup and repairs the environment instead of
 * throwing guidance at the user:
 *   1. Ensure base dir (~/.dcf) and logs dir (~/.dcf/logs) exist
 *   2. DB missing        -> nothing to do (normal init creates schema)
 *      DB present        -> PRAGMA integrity_check; on failure back up the
 *                           corrupt file (kept as evidence) and let normal
 *                           init rebuild a fresh one
 *   3. Port occupied     -> probe /rpc/health; if occupant is a healthy
 *                           companion, this process must exit (single
 *                           instance semantics); otherwise increment the
 *                           port and write the effective port to
 *                           <baseDir>/companion.port for Surface discovery
 *   4. Every check result is appended to <baseDir>/logs/companion-doctor.log
 *
 * Zero npm dependencies: node:fs / node:path / node:http only.
 * node:sqlite is optional; when unavailable the integrity check is skipped
 * (mock mode has no on-disk DB to verify).
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const MAX_PORT_PROBES = 10;
const HEALTH_PROBE_TIMEOUT_MS = 1000;

/**
 * Resolve the DCF base directory (default ~/.dcf)
 */
function getDefaultBaseDir() {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
    return path.join(homeDir, '.dcf');
}

/**
 * Check 1: ensure base dir and logs dir exist
 */
function ensureDirectories(baseDir) {
    const logsDir = path.join(baseDir, 'logs');
    const created = [];

    for (const dir of [baseDir, logsDir]) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            created.push(dir);
        }
    }

    return { ok: true, created, logsDir };
}

/**
 * Check 2: verify DB integrity when the file already exists.
 * On corruption: back up (never delete) and remove the corrupt file so the
 * normal initialization path rebuilds the schema from scratch.
 */
function checkDatabase(dbPath) {
    if (!fs.existsSync(dbPath)) {
        return { ok: true, status: 'missing', detail: 'DB will be created by normal init' };
    }

    let DatabaseSync = null;
    try {
        DatabaseSync = require('node:sqlite').DatabaseSync;
    } catch (error) {
        return { ok: true, status: 'skipped', detail: 'node:sqlite unavailable, integrity check skipped' };
    }

    let db = null;
    try {
        db = new DatabaseSync(dbPath);
        const row = db.prepare('PRAGMA integrity_check').get();
        db.close();

        const verdict = row ? (row.integrity_check || Object.values(row)[0]) : null;
        if (verdict === 'ok') {
            return { ok: true, status: 'healthy', detail: 'PRAGMA integrity_check = ok' };
        }
        return quarantineDatabase(dbPath, `integrity_check returned: ${verdict}`);
    } catch (error) {
        if (db) {
            try { db.close(); } catch (_) { /* already broken */ }
        }
        return quarantineDatabase(dbPath, `open/check failed: ${error.message}`);
    }
}

/**
 * Back up a corrupt DB file (evidence preserved) and clear the path
 * for a rebuild. Sidecar -wal/-shm files are moved along with it.
 */
function quarantineDatabase(dbPath, reason) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${dbPath}.corrupt-${stamp}.bak`;

    try {
        fs.renameSync(dbPath, backupPath);
        for (const suffix of ['-wal', '-shm']) {
            const sidecar = dbPath + suffix;
            if (fs.existsSync(sidecar)) {
                fs.renameSync(sidecar, backupPath + suffix);
            }
        }
        return {
            ok: true,
            status: 'rebuilt',
            detail: `corrupt DB backed up to ${backupPath} (${reason}); fresh DB will be created`,
            backupPath
        };
    } catch (error) {
        return {
            ok: false,
            status: 'error',
            detail: `failed to quarantine corrupt DB: ${error.message} (original reason: ${reason})`
        };
    }
}

/**
 * Probe a port: is it free, held by a healthy companion, or held by
 * something else?
 * @returns {Promise<'free'|'healthy-companion'|'occupied'>}
 */
function probePort(port) {
    return new Promise(resolve => {
        const req = http.get(
            { host: '127.0.0.1', port, path: '/rpc/health', timeout: HEALTH_PROBE_TIMEOUT_MS },
            res => {
                let body = '';
                res.on('data', chunk => { body += chunk; });
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(body);
                        if (res.statusCode === 200 && parsed.result && parsed.result.status === 'healthy') {
                            return resolve('healthy-companion');
                        }
                    } catch (_) { /* not a companion */ }
                    resolve('occupied');
                });
            }
        );
        req.on('timeout', () => {
            req.destroy();
            resolve('occupied');
        });
        req.on('error', error => {
            // ECONNREFUSED means nobody is listening -> port is free.
            // Any other connection-level failure is treated as occupied
            // so we err on the side of picking another port.
            resolve(error.code === 'ECONNREFUSED' ? 'free' : 'occupied');
        });
    });
}

/**
 * Check 3: resolve an effective port with single-instance semantics.
 */
async function checkPort(requestedPort, baseDir) {
    let port = requestedPort;

    for (let attempt = 0; attempt < MAX_PORT_PROBES; attempt++) {
        const state = await probePort(port);

        if (state === 'healthy-companion') {
            return {
                ok: true,
                status: 'already-running',
                shouldExit: true,
                port,
                detail: `healthy companion already serving on port ${port}; this instance will exit (single instance)`
            };
        }

        if (state === 'free') {
            const portFile = path.join(baseDir, 'companion.port');
            fs.writeFileSync(portFile, String(port) + '\n');
            return {
                ok: true,
                status: port === requestedPort ? 'requested' : 'reassigned',
                shouldExit: false,
                port,
                portFile,
                detail: port === requestedPort
                    ? `port ${port} free; recorded in ${portFile}`
                    : `port ${requestedPort} occupied by a non-companion process; reassigned to ${port}, recorded in ${portFile}`
            };
        }

        port++;
    }

    return {
        ok: false,
        status: 'exhausted',
        shouldExit: true,
        port: requestedPort,
        detail: `no free port found in range ${requestedPort}-${requestedPort + MAX_PORT_PROBES - 1}`
    };
}

/**
 * Append doctor results to the startup log (best effort: logging failure
 * must never block startup).
 */
function writeDoctorLog(logsDir, lines) {
    try {
        const logPath = path.join(logsDir, 'companion-doctor.log');
        const stamp = new Date().toISOString();
        const entry = lines.map(line => `${stamp} ${line}`).join('\n') + '\n';
        fs.appendFileSync(logPath, entry);
        return logPath;
    } catch (error) {
        console.warn('Doctor: failed to write log:', error.message);
        return null;
    }
}

/**
 * Run all self-healing checks. Never throws for repairable conditions.
 *
 * @param {Object} options
 * @param {number} options.port      requested port
 * @param {string|null} options.dbPath  DB path (null -> <baseDir>/dcf.db)
 * @param {string|null} options.baseDir base dir (null -> ~/.dcf)
 * @returns {Promise<{shouldExit: boolean, exitCode: number, port: number, dbPath: string, checks: Object, logPath: string|null}>}
 */
async function runDoctor(options = {}) {
    const baseDir = options.baseDir || getDefaultBaseDir();
    const dbPath = options.dbPath || path.join(baseDir, 'dcf.db');
    const requestedPort = options.port;

    const checks = {};
    const logLines = ['doctor: startup self-check begin'];

    // 1. Directories
    checks.directories = ensureDirectories(baseDir);
    logLines.push(`doctor: directories ${checks.directories.created.length > 0
        ? 'created ' + checks.directories.created.join(', ')
        : 'ok (already present)'}`);

    // Ensure the DB parent dir exists too (custom --db paths)
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
        logLines.push(`doctor: created DB parent dir ${dbDir}`);
    }

    // 2. Database integrity
    checks.database = checkDatabase(dbPath);
    logLines.push(`doctor: database [${checks.database.status}] ${checks.database.detail}`);

    // 3. Port / single instance
    checks.port = await checkPort(requestedPort, baseDir);
    logLines.push(`doctor: port [${checks.port.status}] ${checks.port.detail}`);

    const shouldExit = Boolean(checks.port.shouldExit) || !checks.database.ok;
    const exitCode = checks.port.status === 'already-running' ? 0 : (shouldExit ? 1 : 0);
    logLines.push(`doctor: startup self-check end (shouldExit=${shouldExit})`);

    const logPath = writeDoctorLog(checks.directories.logsDir, logLines);

    return {
        shouldExit,
        exitCode,
        port: checks.port.port,
        dbPath,
        checks,
        logPath,
        summary: logLines
    };
}

module.exports = { runDoctor, probePort, checkDatabase, checkPort, ensureDirectories, getDefaultBaseDir };
