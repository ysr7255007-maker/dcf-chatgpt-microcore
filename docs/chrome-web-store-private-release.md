# One-time non-public Chrome base release setup

The user must not repeat local extension loading for ordinary base updates. One-time setup is therefore separated from recurring publication.

## One-time external setup

1. Create the Chrome Web Store item and choose the desired non-public visibility.
2. Complete the required listing and privacy fields and manually publish that visibility once.
3. Enable Chrome Web Store API in a Google Cloud project.
4. Obtain OAuth client credentials and a refresh token with the Chrome Web Store scope.
5. Add repository secrets:
   - `CWS_CLIENT_ID`
   - `CWS_CLIENT_SECRET`
   - `CWS_REFRESH_TOKEN`
   - `CWS_PUBLISHER_ID`
   - `CWS_EXTENSION_ID`

## Recurring path

Changes to static base files on `main` trigger `.github/workflows/chrome-web-store-release.yml`:

```text
verify repository
→ build base with main plugin index
→ upload ZIP through Chrome Web Store API v2
→ submit the existing non-public item for review/publication
```

If secrets are absent, the workflow still verifies and saves the ZIP but explicitly skips publication. This prevents a false success claim while keeping the code path ready.
