# Release automation

The manual GitHub Actions workflow runs Cardigan's existing checks and deterministic package script, creates a versioned GitHub release with the extension ZIP attached, then uploads that ZIP to the existing Chrome Web Store item and submits it for review.

## Before the first release

### 1. Configure Google API credentials

Follow Google's [Chrome Web Store API setup guide](https://developer.chrome.com/docs/webstore/using-api/):

- Enable the Chrome Web Store API in a Google Cloud project.
- Create OAuth client credentials.
- Generate a refresh token with the `https://www.googleapis.com/auth/chromewebstore` scope using the Google account that manages the Cardigan listing.
- Find the publisher ID under **Developer Dashboard → Publisher → Settings**.

The workflow uses the Chrome Web Store API v2 endpoints.

### 2. Add repository Actions secrets

In the repository, open **Settings → Secrets and variables → Actions → New repository secret** and add:

| Secret | Value |
| --- | --- |
| `CWS_PUBLISHER_ID` | Publisher ID from the Chrome Web Store Developer Dashboard |
| `CWS_EXTENSION_ID` | Existing Cardigan extension ID: `kgkfgnimejamebkoinbnmlifipgmpjmn` |
| `CWS_CLIENT_ID` | OAuth client ID |
| `CWS_CLIENT_SECRET` | OAuth client secret |
| `CWS_REFRESH_TOKEN` | OAuth refresh token |

Do not commit credentials or put them in workflow files.

### 3. Release a new version

1. Update the version in both `manifest.json` and `package.json` to the same new `x.y.z` value. Chrome Web Store updates require a version higher than the version already uploaded.
2. Merge the version change into `main`.
3. Open **Actions → Release Cardigan → Run workflow** and run it from `main`.

The workflow runs `npm run check` and `npm run package` before creating the release. It stops if the versioned GitHub release already exists. The GitHub release asset is `cardigan-<version>.zip`.

After upload succeeds, the workflow calls the Chrome Web Store publish endpoint. This submits the new version for Google's review; it does not bypass review or guarantee immediate publication. The API preserves the item's existing visibility setting.

## If the workflow fails

- **Missing secrets:** add the five repository secrets above.
- **OAuth/API error:** confirm the Chrome Web Store API is enabled and the refresh token was generated for the account that manages the listing with the required scope.
- **Version rejected:** increment both version fields and ensure the version is higher than the last uploaded version.
- **Release already exists:** increment the version and rerun from `main`; do not delete a release merely to retry a store submission.
- **Store submission fails after GitHub release creation:** inspect the Actions log and Developer Dashboard before retrying. The workflow intentionally does not silently reuse an existing release tag.

Official references:
- [Chrome Web Store API setup and upload/publish examples](https://developer.chrome.com/docs/webstore/using-api/)
- [Chrome Web Store API v2 reference](https://developer.chrome.com/docs/webstore/api/reference/rest)
