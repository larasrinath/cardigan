# Release automation

Every published GitHub release of Cardigan is sent to the Chrome Web Store and submitted for review. Drafts and pre-releases are not. The **Submit to Chrome Web Store** workflow (`.github/workflows/store.yml`) does this, however the release was made: the **Release Cardigan** workflow, the GitHub web page or `gh release create`.

The store workflow downloads the release's `cardigan-<version>.zip`, checks that the `manifest.json` inside it has the tag's version, uploads it to the existing Chrome Web Store item and submits it for review.

## Before the first release

### 1. Configure Google API credentials

Follow Google's [Chrome Web Store API setup guide](https://developer.chrome.com/docs/webstore/using-api/), signed in with the Google account that manages the Cardigan listing:

- Enable the Chrome Web Store API in a Google Cloud project.
- Set up the OAuth consent screen, then set its publishing status to **In production** (**Publish app**). Refresh tokens for an app left in **Testing** expire after 7 days, and the store upload then fails.
- Create an OAuth client of type **Web application** with the authorized redirect URI `https://developers.google.com/oauthplayground`.
- In the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground), open the settings, tick **Use your own OAuth credentials** and enter the client ID and secret. Authorize the scope `https://www.googleapis.com/auth/chromewebstore`, then exchange the authorization code for tokens and copy the refresh token.
- Find the publisher ID in the Developer Dashboard, under Publisher, then Settings.

The workflow uses the Chrome Web Store API v2 endpoints.

### 2. Add repository Actions secrets

In the repository, open Settings, then Secrets and variables, then Actions, and add each one with **New repository secret**:

| Secret | Value |
| --- | --- |
| `CWS_PUBLISHER_ID` | Publisher ID from the Chrome Web Store Developer Dashboard |
| `CWS_EXTENSION_ID` | Existing Cardigan extension ID: `kgkfgnimejamebkoinbnmlifipgmpjmn` |
| `CWS_CLIENT_ID` | OAuth client ID |
| `CWS_CLIENT_SECRET` | OAuth client secret |
| `CWS_REFRESH_TOKEN` | OAuth refresh token |

Do not commit credentials or put them in workflow files.

## Release a new version

The **Release Cardigan** workflow is the one-click path:

1. Update the version in both `manifest.json` and `package.json` to the same new `x.y.z` value. The Chrome Web Store needs a version higher than the one already uploaded.
2. Merge the version change into `main`.
3. Open Actions, then **Release Cardigan**, then **Run workflow**, and run it from `main`.

It checks the five secrets first, so a missing secret stops it before anything is released. It then runs `npm run check` and `npm run package`, stops if the versioned GitHub release already exists, creates release `v<version>` with `cardigan-<version>.zip` attached, and runs the store workflow for that tag.

A release made another way must be tagged `v<version>` and have the `cardigan-<version>.zip` from `npm run package` attached. GitHub runs the store workflow from the commit the tag points at, so a tag on a commit from before this workflow existed is not sent on its own; submit it by hand as below. A pre-release later turned into a full release is not sent on its own either; submit it by hand too.

Submitting for review does not bypass review or guarantee immediate publication. The item keeps its existing visibility setting.

## Submit a release again

Open Actions, then **Submit to Chrome Web Store**, then **Run workflow**, and enter the release tag (for example `v0.45.4`). This sends the existing release's zip again without a version bump.

A version still in review blocks a new upload. Wait until that review clears in the Developer Dashboard, then submit again.

## If a workflow fails

- **Missing secrets:** add the five repository secrets above.
- **OAuth token refresh failed:** check the client ID, secret and refresh token, and that the consent screen is **In production**. A refresh token made while it was in **Testing** expires after 7 days; make a new one.
- **Upload failed:** a version still in review blocks new uploads. Retry with the same tag once the review clears.
- **Version rejected:** increment both version fields so the version is higher than the last uploaded one, then release again.
- **No zip or wrong version:** attach the `cardigan-<version>.zip` built from the tagged commit to the release, then submit it again.
- **Release already exists:** increment the version and rerun from `main`. Do not delete a release to retry a store submission; submit it again instead.

Official references:
- [Chrome Web Store API setup and upload/publish examples](https://developer.chrome.com/docs/webstore/using-api/)
- [Chrome Web Store API v2 reference](https://developer.chrome.com/docs/webstore/api/reference/rest)
