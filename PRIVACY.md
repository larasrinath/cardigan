# Cardigan privacy policy

Last changed: 13 October 2026

Cardigan is a read-only Chrome extension for Anaplan. This policy says what it reads, where that is processed, what it keeps and what leaves your browser. [NOTICE.md](NOTICE.md) has the full detail and [lists every request to Anaplan](NOTICE.md#requests-to-anaplan).

## What Cardigan reads, and when

- **Only when you start a run:** you click Cardigan's icon on an Anaplan tab, or choose **Run**, **Run again** or **Refresh the Anaplan tab and run** on its results page. Until then its scripts on Anaplan pages show nothing on them and send nothing to Anaplan.
- **Through that tab, as you:** it reads through the Anaplan tab you clicked it on, with your own signed-in Anaplan session.
- **How the model or app is built:** modules, line items and their formulas, lists, versions, time settings, saved views, imports, processes, exports, pages and their cards. These hold the names your model uses, including list items that its filters, page selections and import mappings name, and its notes. Those names can be people's names or email addresses: list items named after people, or items of the Users list where a filter or a saved view names a user. Cardigan keeps them only as the table below says, and sends them nowhere. It does not read the data in module cells.
- **Any other site:** if you click the icon on a tab that is not Anaplan, Cardigan reads only that tab's site address, such as `https://example.com`, to tell you it is not Anaplan.

## Where it is processed

In your browser. The results page is part of the extension and loads only the extension's own files. The model map is drawn there too, from the result already in your browser.

## What it keeps

Cardigan keeps nothing outside your browser. In your browser:

| Where | What | How long |
| --- | --- | --- |
| The results tab's session storage | The last result, compressed but not encrypted, with the time it finished, the Anaplan tab's ID, the extension's version and, for a model, the site and customer ID in that tab's address. How you left the result: searches, filters, columns, sort, map view and open details, which can hold names and values from your model. The IDs of the tabs the results page opened. | Until you close the tab. Chrome may hold a closed tab's session storage for a while, to restore the tab. |
| The extension's local storage | Four preferences: the theme, the map grouping, Local or UTC times, and the width of the details panel. No model or app data. | Until you remove Cardigan or clear its data. |

Cardigan uses no IndexedDB, no `chrome.storage` and no cookies of its own. Anything else it holds is in a page's memory, and goes when that page is closed or reloaded.

To clear what it keeps:
- **Forget this result**, on the Overview, removes the kept result and how you left it, at once.
- Closing the results tab ends its session storage, apart from what Chrome holds to restore the tab.
- Removing Cardigan from Chrome deletes its storage, preferences included.

## What leaves your browser

Only Cardigan's reads to Anaplan's own servers, on `*.anaplan.com`: GET requests, subscriptions on Anaplan's model data connection, and the view requests Model Building's own client sends for it. They carry your Anaplan session, as Anaplan's own pages do. Buttons that open a module, app or page show it in an Anaplan tab, as a link would.

Nothing else is sent:
- nothing to the author, and nothing to any third party;
- no analytics, telemetry or ads;
- your data is never sold or shared.

The About page's links to GitHub open only when you click them.

## Files and copies

Cardigan makes no files and offers no download: a result is shown on its results page only. Text you copy from it, as with **Copy diagnostic log**, goes to your clipboard. Treat it as you would the model itself.

## Permissions

| Permission | Why it is used |
| --- | --- |
| `activeTab` and `scripting` | Put Cardigan's reader into the Anaplan tab you clicked, when Chrome has not, as after an install or update. |
| `contextMenus` | Add **About Cardigan** and the version to its toolbar icon's menu. |
| Site access to `https://*.app.anaplan.com/*` and `https://*.app2.anaplan.com/*` | Cardigan's content scripts load on Anaplan's pages only, to read the model or app when you ask. |

## Contact

For questions or requests, [open an issue on GitHub](https://github.com/larasrinath/cardigan/issues).

## Changes

A change to this policy is made in this file, with a new date at the top. Its history on GitHub shows every change.
