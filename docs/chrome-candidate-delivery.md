# DCF Chrome `1.0.0-rc.1` delivery

## Unique installation path

Build or download `dcf-chrome-extension-1.0.0-rc.1.zip`, unzip it once, open `chrome://extensions`, enable Developer mode, choose “Load unpacked”, and select the `dcf-chrome-extension` directory. In the extension details page, enable “Allow User Scripts”.

No other DCF script, plugin, runtime or command is required for the candidate. Keep the old Tampermonkey formal version available until acceptance so migration and rollback remain possible.

## First-use result

Open ChatGPT. The extension registers the official ammo and diagnostics code units, waits for both startup proofs, then confirms the exact snapshot as current and last-known-good. If the old side rail is present, migration runs automatically and leaves old state untouched.

## Automated validation summary

- MV3 manifest and permissions validated;
- two independently versioned code units SHA-256 verified;
- installed code and active snapshots separated;
- register/update/unregister/query reconciliation tested;
- startup evidence gates candidate confirmation;
- cleared registrations are reconstructed on simulated extension update/startup;
- controlled failure restores LKG;
- static recovery page survives dynamic-code failure;
- same-ID ammo revision increments in place;
- old-side-rail migration bridge validates real fields;
- deterministic extension directory, ZIP and structured summary generated;
- old `0.18.2` verification remains in CI as fallback protection.

## Known limitations

- Real ChatGPT selectors have not yet passed the single user acceptance.
- The automatic migration can only read old state exposed through the formal side rail; it does not guess invisible implementation-only settings.
- Remote official update uses files on `main`, so the bundled candidate works before merge while remote checking becomes live after release files are present on `main`.
- No Chrome Web Store approval is claimed.

## Rollback

Disable the DCF Chrome extension and re-enable the retained Tampermonkey `0.18.2`. The candidate never deletes or rewrites old GM data. Within the Chrome candidate itself, click the extension action and choose “Restore last known good snapshot”.
