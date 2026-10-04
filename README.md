# Cardigan: a Chrome extension for analysing Anaplan apps and models

Cardigan is a Chrome extension, called Anaplan Analyzer up to version 0.6.0. It reads what an Anaplan app's pages or a model's settings contain, shows it on a results page you can search and sort, and exports it as CSV files.

Open an Anaplan app or model, then click the Cardigan icon in Chrome's toolbar. A results page opens in a new tab and analyses what the Anaplan tab shows:

- **An app**: it reads every page in the app and lists, per page and card:
  - the model
  - the modules, saved views and line items
  - rows, columns and pages
  - filters
  - conditional formatting
  - actions
- **A model in Model Building**: it reads the model's settings, one table per Model settings grid (see [Model export](#model-export)).

Cardigan adds nothing to Anaplan's pages, and nothing is read from Anaplan until you click the icon. It only reads, using your signed-in browser session, and nothing leaves the browser except those reads to Anaplan. It is not affiliated with or endorsed by Anaplan; see [NOTICE.md](NOTICE.md).

The page analysis uses the same card reader as SAM's `describe_ux_page_cards` tool ([`card-details.ts`](src/card-reader/card-details.ts) and [`card-naming.ts`](src/card-reader/card-naming.ts)), bundled into the extension. See [Relationship to SAM](#relationship-to-sam).

## Install

### From a release zip

1. Download `cardigan-<version>.zip` from a release, and check its SHA-256 against the one published with it (`shasum -a 256 cardigan-<version>.zip`).
2. Unzip it into a folder you keep: Chrome loads the extension from that folder.
3. In Chrome, open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked** and select the unzipped folder (the one with `manifest.json`).

To update, unzip the new release over the same folder, click the reload icon on the extension's card in `chrome://extensions`, then refresh the Anaplan tab.

### From source

1. Install the pinned tools: `npm ci` (Node 20.19+, 22.12+ or 24+).
2. Build: `npm run build`. This type-checks the sources and writes the four bundles in `dist/` (`content.js`, `model-export.js`, `background.js` and `results.js`), which are git-ignored, so rebuild after pulling changes.
3. In Chrome, open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked** and select the repository root (the folder with `manifest.json`).

After a rebuild, click the reload icon on the extension's card in `chrome://extensions`, then refresh the Anaplan tab.

### Use it

1. Open an app in Anaplan while signed in: `https://<region>.app.anaplan.com/a/apps/app/<app id>…` (in Australia, `https://au1a.app2.anaplan.com/…`). For a model, see [Model export](#model-export).
2. Click the Cardigan icon in Chrome's toolbar. The results page opens in a new tab, right after the Anaplan tab, and starts the analysis by itself.
3. The page shows each step as it reads. Keep the Anaplan tab open until it finishes.
4. Read the results on the page, or save them: **Download all (.zip)** saves every file, and **Download this table (.csv)** saves the table on screen.

The results page shows:

- **Overview**: how many rows each table has, and the result's notes under **Notes**. For an app, also its cards by type and the models its pages use.
- **One table per file**, except the Details file. Search all its columns, click a column's name to sort by it, choose 25, 50 or 100 rows per page, and pick the columns to show under **Columns**. A column that holds 2 to 30 different values also has a filter. Click a row, or press Enter on the button in its first cell, to see it in full: every value whole, with its line breaks. For an app, a page's name shows that page's cards, and in **Cards** a card's number or title opens the card with its grid sections, filters, formatting and buttons.
- **Details**: the Details file (`App Details.csv` or `Model Details.csv`) under its sections, with the diagnostic log under **Diagnostics**. From here, **Download this table (.csv)** saves the Details file.
- **Model map**: listed as coming in a later version.

**Run again** analyses the Anaplan tab again. The result stays on the page until the new one is complete. If the new run fails, its message stands above the result, with a **Copy diagnostic log** button. Closing the results page stops the analysis.

The results page starts the analysis by itself only when the icon has just opened it, within a minute of the click. A results page that is reloaded, duplicated, restored from history or reopened later does not: it says "That Anaplan tab shows an app." (or "a model.") and waits for you to choose **Run**. After a run the same control reads **Run again**.

If the page says **Not connected** ("Cardigan cannot reach that tab."), the tab did not answer. That is a tab that is not an Anaplan page, or an Anaplan tab that has not been refreshed since the extension was installed, updated or reloaded. Refresh the Anaplan tab, then click the Cardigan icon again.

If it says **Nothing to analyse**, the tab is an Anaplan page that is not an app or a model. Open one there, give it a moment to load, then choose **Run again**.

### Australia

Anaplan's au1 region (Australia) serves the app at `au1a.app2.anaplan.com`; every other region uses `*.app.anaplan.com`. The extension runs on both (`https://*.app.anaplan.com/*` and `https://*.app2.anaplan.com/*`), and its host checks accept any host under `anaplan.com` and nothing else. Tests in `src/regions.test.ts` pin both.

## What it reads

Everything uses your signed-in browser session on the app's own host and is read-only.

| What | From |
| --- | --- |
| The app's pages and categories | `GET /a/springboard-definition-service/apps/{app}` (`x-api-version: 2`) |
| Each page's published definition | `GET /a/springboard-definition-service/{boards\|grid-pages\|reports}/{page}` |
| Names of modules, saved views, dimensions, lists and line items | Page Builder's model data socket (`/a/springboard-widget-data-service/ws`), one model at a time |
| Names of imports, exports and processes | `GET /a/collaboration-actions-service/workspaces/{ws}/models/{model}/{imports\|exports\|processes}`, from the model's own host when it lives in another data centre |

- Subscribing to a model's names can make Anaplan load that model, as opening one of its pages would.
- The zip is built in the browser. Nothing is sent anywhere except these Anaplan reads.
- REST reads are GET-only and limited to the two services above.
- The socket also carries data changes, so the client refuses to send anything except subscribe, unsubscribe and `update-subscription` frames. Tests in `src/stomp.test.ts` enforce this.
- Action tokens are removed by the card reader and never reach the CSVs.

## Output

The zip, `<app> - App Export - <date>.zip`, holds only CSV files, named in the model export's style (28 Sep 2026). The columns follow the agreed page analyzer template, with clearer names: Page Builder's own words where it has them, and the module of the grid each filter or formatting rule belongs to.

| File | One row per |
| --- | --- |
| `App Details.csv` | Detail about the export, under a **Section**: the app (name, ID, categories, page and card counts, models), when and with which version it was exported, each file's row count, notes (pages not analysed, names that could not be looked up), how to read the files, and the diagnostic log |
| `Pages.csv` | Page, including its category, model and card counts |
| `Cards.csv` | Card: view type, modules, saved view, line items shown, rows, columns, pages, filters, sorts and hidden items, formatting, actions |
| `Grid Sections.csv` | Grid or chart section (a combined grid has one row per section) |
| `Filters.csv` | Filter condition on a Rows or Columns filter, with the module of the grid it filters |
| `Conditional Formatting.csv` | Conditional formatting rule, plus KPI indicators, with the module of the grid it formats |
| `Action Buttons.csv` | Action button |
| `Where Used.csv` | Object × card × role, for reverse lookup |

How to read the files:

- **Page + Card #** identify a card in every file. Card # counts cards row by row, left to right, and **Card ID** is the stable key.
- **"(not in the model)"** after an ID marks a module or line item that a card still points at but the model no longer has: it was deleted, or you can't see it. Search `Where Used.csv` for it to find broken cards.
- **IDs of 12 or more digits** are written as text, so Excel shows every digit instead of `1.476E+12`. The formula bar shows them as `="…"`.
- **View type** is one of three values:
  - **Custom view**: a module shaped on the page.
  - **Saved view**: a saved view or a module's default view, built in the model and only selected on the page.
  - **Combined grid**: several module sections in one card.

## Context selectors and show/hide

- **Context selectors** match Page Builder's **Pivot data** panel:
  - For a custom view or combined grid, every dimension of the section's module that is on neither rows nor columns is a context selector, whether or not the page saved settings for it. Selectors the page saved show their settings, for example "(hidden, synced to page)".
  - For a saved view, they are the view's pages, read from the same grid metadata Page Builder receives. If this read fails, the diagnostic log shows what the service sent.
- **Show/hide:** shown and hidden items and hierarchy levels come from the page. Item names are looked up the way Page Builder's show/hide list does.

## Limits

- Only published versions are read. Pages that were never published are listed as "Not published" and counted apart: **Pages analysed** reads "93 of 93 (published versions); 3 unpublished, not analysed", so an app whose published pages were all read says so.
- A saved view's own filters, sorts and show/hide live in the model and are not listed.
- Filter-context items show their IDs.
- Buttons whose import, export or process is not found in the model keep their card label. **Name source** says which source was used.
- Anaplan can change the internal services the extension reads without notice; see [NOTICE.md](NOTICE.md).

## Model export

Open a model in **Model Building** (`…/a/modeling/…/models/<model id>/…`). Once the model has loaded, click the Cardigan icon. The results page opens and exports the model, and **Download all (.zip)** saves the files.

The Model Building page is a shell. The model itself runs in a hidden "core" frame, which is often on the host of the data centre the model lives in, and the export reads there:
- The frame announces itself to the page.
- When the results page asks for the export, the page asks the frame.
- The frame sends progress and the finished files back to the page through window messages, and the page passes them on to the results page.

Each side accepts messages only from the other window and only from Anaplan hosts. The classic model page opened on its own (`…/core-webapp-…/anaplan/framework.jsp`) works too, without a frame: its model is read in the page's own window, once the model has loaded.

The zip, `<model> - Model Export - <date>.zip`, has one CSV per Model settings grid, laid out as Anaplan's own export of that grid:
- The first column has no header. The results page shows it as **Name**.
- Every grid row is kept, with module rows above their line items. The Actions list is split at its headings instead of exported whole.
- Each cell holds its underlying value: format and summary definitions as JSON, cell counts without separators, `true`/`false` and ISO dates.

`Model Details.csv` comes first. It describes the export itself, one detail per row under a **Section**:
- the model and workspace, with their IDs
- when the export was made and by which version
- each file's row count
- notes and how to read the files
- the diagnostic log

| File | Model settings grid |
| --- | --- |
| `Line Items.csv` | Modules → Line Items, all modules. Two columns follow Anaplan's own: **Ratio Numerator** and **Ratio Denominator** name the line items a Ratio summary divides (the Summary cell gives only their IDs) |
| `Modules.csv` | Modules → Modules |
| `General Lists.csv` | General Lists |
| `Processes.csv` | Actions → Actions, the rows under the **Processes** heading: definition, last run (start time and duration), notes, the processes that use each action (**Used in Processes**) and the dashboards it appears on |
| `Imports.csv` | Actions → Imports (source and target of each import), followed by the same import's columns from the Actions list under **Imports**: last run, duration, notes, Used in Processes, Used in Dashboards. Rows are matched on the import's ID; the Actions list's "Import into …" text is left out because Target Object and Target Type say the same. |
| `Import Data Sources.csv` | Actions → Import Data Sources |
| `Exports.csv`, `Other Actions.csv` | The Actions list's rows under the **Exports** and **Other Actions** headings, in the same columns as Processes. Other Actions are bulk copy, delete by selection, order hierarchy, optimizer and the like. |
| `Time Ranges.csv` | Time → Time Ranges |
| `Versions.csv` | Versions |
| `Source Models.csv` | Source Models |
| `Model Calendar.csv` | The model calendar, in the assessment template (Section, Setting, Value, Allowed values, Applies to, Notes) |

How it reads:

- It reads through the page's own Model Building client, requesting the same grids the settings tabs use. The script runs in the page's main world for that.
- The script stays inert on any page without an open classic model.
- Reads are paged, so large models are read in parts.
- Every request is checked to carry no changes before it is sent, and the page's own model cache is left untouched.
- In the calendar file, list choices use the template's own words (Sat, Dec, Last). The settings grid can return the IDs Anaplan stores rather than labels: months 1-12, and the day the fiscal year ends on 1-7 counted from Sunday, as the Model Calendar tab's own selects number them (FiscalYearMonthSelect and FiscalYearDayInWeekSelect index CLDR's month and day abbreviations). **Current Fiscal Year** is written as the tab shows it, with its dates (FY24: 31 Dec 2023 - 28 Dec 2024): the model stores only FY24, and the dates are worked out the way the tab's FiscalYearHelper and FiscalYearForWeeksHelper do. The stored value is written as it is when the calendar type, the year label, the start month (month calendars) or the end type, day or month (week calendars) is missing or not recognised; when the stored value is not an ID such as FY24 or FY2079 (for example, it already carries its dates); or when no year of the calendar has that ID. A missing alignment or Timescale setting counts as aligned with the end week and 2-digit, as on the tab. For **Weeks: General** the row is blank, as the template does not apply it to that calendar type. Settings the template's **Applies to** excludes for this calendar type are blank. **Model size (GB)** and **Captured by** are left blank for you to fill in, and **Captured on** is the export date.

## If names show as IDs or the analysis stops

The diagnostic log is on the results page. Open **Details**, then **Diagnostics**, and click **Copy diagnostic log**. While an analysis runs, and when it stops without a result, the log is under the message instead, with the same button. When **Run again** fails, the earlier result stays, and the button beside the failure's message copies the log of the run that failed. After a result, its lines are also the **Diagnostics** rows at the end of `App Details.csv` (`Model Details.csv` for a model export). They list:

- request paths and HTTP statuses
- socket frame commands and destinations
- model status
- counts of names found

It contains no cookies, tokens or cell values. Send it back with a note of what you expected.

If the results page says **Not connected** or **Nothing to analyse**, see [Use it](#use-it).

## Development

`npm ci` installs the exact versions of TypeScript, Vitest and esbuild in `package-lock.json`.

| Command | What it does |
| --- | --- |
| `npm run typecheck` | Type-checks `src/` (`tsc -p tsconfig.json`). |
| `npm test` | Runs the extension's unit tests in `src/`, the card reader's included (Vitest). |
| `npm run test:scripts` | Runs the Node scripts' own tests in `scripts/` (packaging, icons, card reader check). |
| `npm run build` | Type-checks, then builds the four bundles in `dist/` from `src/` (`scripts/build.mjs`). |
| `npm run check` | All of the above. GitHub Actions runs it on every push and pull request. |
| `npm run icons` | Redraws `icons/*.png` from `scripts/icons.mjs`. |
| `npm run package` | Builds, then writes the release zip (see [Releasing](#releasing)). |
| `npm run check:card-reader` | Compares the card reader with SAM's copy (see [Relationship to SAM](#relationship-to-sam)). |

Layout:

- `manifest.json`: the toolbar icon, the service worker, the two content scripts and the content security policy of the extension's own pages. It asks for no permissions.
- `src/background.ts`: the service worker, bundled into `dist/background.js`. A click on the toolbar icon opens the results page next to the clicked tab, with that tab's ID and the time of the click in its address.
- `results.html`, `results.css` and `src/results/`: the results page. Its script is bundled into `dist/results.js`:
  - `main.ts`: puts the page together and acts on what you click.
  - `connection.ts`: talks to the Anaplan tab, and holds what the page says in each state.
  - `table-engine.ts`: search, filters, sorting and paging.
  - `columns.ts`: how each column is shown.
  - `result-view.ts`: the overview, the details, the notes and the diagnostic log, read out of a result.
  - `markup.ts`: writes the page's HTML, with every value from a result escaped.
  - `page-ids.ts`: the elements of `results.html` that the script looks up.
- `src/content.ts`: the script in the Anaplan tab (isolated world), bundled into `dist/content.js`. It says whether the tab shows an app or a model. When the results page asks, it runs the app analysis (`analyse.ts`) or has the model's frame export the model (`bridge.ts`).
- `src/tab-port.ts`: the Anaplan tab's end of the connection to the results page: one run at a time, its progress and its result, and stopping when the page is closed. `src/protocol.ts` lists the messages, and `src/progress.ts` says how a run reports its steps.
- `src/result-types.ts`: a result, which is the zip's files as tables. `src/result-zip.ts` writes the CSV files and the zip from them. `src/result-plain.ts` keeps a result to plain data, and `src/pieces.ts` cuts it into the pieces it is sent in.
- `src/model-content.ts`: the model export's reading side, in the page's main world, bundled into `dist/model-export.js`. The export itself is in `src/model/`.
- `src/chrome.d.ts`: the few Chrome extension functions used, declared here so no typings package is needed.
- `src/card-reader/`: the card reader shared with SAM.
- `design/results-page.html`: the design the results page was made from. It is a reference: nothing loads it and it is not packaged.
- `scripts/`: build, packaging, icons and the card reader check.
- `docs/research/`: research notes on the page definition formats the card reader follows.

Bump `version` in `manifest.json`, `package.json` and the two `version` fields at the top of `package-lock.json` whenever the bundles change. The results page and the details files show it, so each build and its output can be told apart, and the packager refuses a mismatch between `manifest.json` and `package.json`.

## Releasing

1. Bump `version` in `manifest.json`, `package.json` and `package-lock.json`, and add the release to [CHANGELOG.md](CHANGELOG.md).
2. Check the card reader against SAM: `npm run check:card-reader -- <path to anaplan-sam>` (default `../anaplan-sam`). It must report the five files identical.
3. Run `npm run check`.
4. Run `npm run package`. It builds, then writes `release/cardigan-<version>.zip` and prints its SHA-256.
5. Publish the zip with its SHA-256 as the release's download.

The zip holds eleven files: `manifest.json`, the four bundles in `dist/`, the four icons, `results.html` and `results.css`. It never holds sources, tests, docs or `node_modules`. Its entries are sorted, stored uncompressed and carry fixed times, so the same files give the same bytes, and the same SHA-256, on every run. The packager refuses to run when a bundle is missing or older than the sources it is built from, or when the results page loads a file that is not in the zip.

The manifest declares a content security policy for the extension's own pages and its service worker: they load nothing from outside the package. The packager also refuses a manifest whose policy would allow that, as a remote address, a wildcard, `'unsafe-eval'` or a script written in the page would.

## Relationship to SAM

Cardigan began as `extension/page-analyzer` inside SAM (anaplan-sam), versions 0.5.2 to 0.5.5, and moved here with its history. SAM's `describe_ux_page_cards` MCP tool and this extension use the same card reader. Each repository keeps its own copy:

| Here | In SAM |
| --- | --- |
| `src/card-reader/` | `src/domains/ux-designer/` |

The five source files `card-details.ts`, `card-naming.ts`, `card-types.ts`, `definition-json.ts` and `definition-types.ts` must stay byte-for-byte identical. Change them the same way in both repositories, and run `npm run check:card-reader` before every release: it names each file that differs and fails on drift, and it is skipped when no SAM checkout is present (as in CI). The reader's tests here (`card-details.test.ts`, `definition-json.test.ts`) are copies of SAM's and may differ from them.

Some source comments mention SAM where the analyzer follows SAM's behaviour, for example the order in which SAM's name resolver looks up filter items. The research notes in `docs/research/` were written in SAM; their companion notes live in SAM's repository.

## Licence

[MIT](LICENSE). See [NOTICE.md](NOTICE.md).
