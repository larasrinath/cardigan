# Cardigan: the Anaplan Analyzer Chrome extension

Cardigan is the source of the **Anaplan Analyzer** Chrome extension. It exports what an Anaplan app's pages and a model's settings contain, as CSV files you can search, filter and compare.

- **Analyse app**, on an Anaplan app: reads every page in the app and downloads a zip of CSV files that list, per page and card:
  - the model
  - the modules, saved views and line items
  - rows, columns and pages
  - filters
  - conditional formatting
  - actions
- **Export model**, on a model in Model Building: downloads one CSV per Model settings grid (see [Model export](#model-export)).

It only reads, using your signed-in browser session, and nothing leaves the browser except those reads to Anaplan. It is not affiliated with or endorsed by Anaplan; see [NOTICE.md](NOTICE.md).

The page analysis uses the same card reader as SAM's `describe_ux_page_cards` tool ([`card-details.ts`](src/card-reader/card-details.ts) and [`card-naming.ts`](src/card-reader/card-naming.ts)), bundled into the extension. See [Relationship to SAM](#relationship-to-sam).

## Install

### From a release zip

1. Download `cardigan-<version>.zip` from a release, and check its SHA-256 against the one published with it (`shasum -a 256 cardigan-<version>.zip`).
2. Unzip it into a folder you keep: Chrome loads the extension from that folder.
3. In Chrome, open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked** and select the unzipped folder (the one with `manifest.json`).

To update, unzip the new release over the same folder and click the reload icon on the extension's card in `chrome://extensions`.

### From source

1. Install the pinned tools: `npm ci` (Node 20.19+, 22.12+ or 24+).
2. Build: `npm run build`. This type-checks the sources and writes `dist/content.js` and `dist/model-export.js`, which are git-ignored, so rebuild after pulling changes.
3. In Chrome, open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked** and select the repository root (the folder with `manifest.json`).

After a rebuild, click the reload icon on the extension's card in `chrome://extensions`, then refresh the Anaplan tab.

### Use it

1. Open an app in Anaplan while signed in: `https://<region>.app.anaplan.com/a/apps/app/<app id>…` (in Australia, `https://au1a.app2.anaplan.com/…`).
2. Click **Analyse app** (bottom right), wait for the progress panel to finish, then click **Download CSVs (.zip)**.

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
- Buttons whose import, export or process is not found in the model keep their card label. **Name from** says which source was used.
- Anaplan can change the internal services the extension reads without notice; see [NOTICE.md](NOTICE.md).

## Model export

Open a model in **Model Building** (`…/a/modeling/…/models/<model id>/…`). Once the model has loaded, an **Export model** button appears bottom right. Click it, then **Export model** in the panel, then **Download CSVs (.zip)**.

The Model Building page is a shell. The model itself runs in a hidden "core" frame, which is often on the host of the data centre the model lives in, and the export reads there:
- The frame announces itself to the page.
- The page's button asks the frame to export.
- The frame sends progress and the finished zip back through window messages.

Each side accepts messages only from the other window and only from Anaplan hosts. The classic model page opened on its own (`…/core-webapp-…/anaplan/framework.jsp`) shows the button directly.

The zip, `<model> - Model Export - <date>.zip`, has one CSV per Model settings grid, laid out as Anaplan's own export of that grid:
- The first column has no header.
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
- In the calendar file, list choices use the template's own words (Sat, Dec, Last). The settings grid can return the IDs Anaplan stores rather than labels: months 1-12, and the day the fiscal year ends on 1-7 counted from Sunday, as the Model Calendar tab's own selects number them (FiscalYearMonthSelect and FiscalYearDayInWeekSelect index CLDR's month and day abbreviations). **Current Fiscal Year** is written as the tab shows it, with its dates (FY24: 31 Dec 2023 - 28 Dec 2024): the model stores only FY24, and the dates are worked out the way the tab's FiscalYearHelper and FiscalYearForWeeksHelper do. The stored value is written as it is when the calendar type, the year label, the start month (month calendars) or the end type, day or month (week calendars) is missing or not recognised. A missing alignment or Timescale setting counts as aligned with the end week and 2-digit, as on the tab. Settings the template's **Applies to** excludes for this calendar type are blank. **Model size (GB)** and **Captured by** are left blank for you to fill in, and **Captured on** is the export date.

## If names show as IDs or the analysis stops

Click **Copy diagnostic log** in the panel, or see the **Diagnostics** rows at the end of `App Details.csv` (`Model Details.csv` for a model export). They list:

- request paths and HTTP statuses
- socket frame commands and destinations
- model status
- counts of names found

It contains no cookies, tokens or cell values. Send it back with a note of what you expected.

If no button appears, check that the extension is on in `chrome://extensions`, that it was reloaded after a rebuild or update, and that the tab was refreshed afterwards.

## Development

`npm ci` installs the exact versions of TypeScript, Vitest and esbuild in `package-lock.json`.

| Command | What it does |
| --- | --- |
| `npm run typecheck` | Type-checks `src/` (`tsc -p tsconfig.json`). |
| `npm test` | Runs the extension's unit tests in `src/`, the card reader's included (Vitest). |
| `npm run test:scripts` | Runs the Node scripts' own tests in `scripts/` (packaging, icons, card reader check). |
| `npm run build` | Type-checks, then bundles `src/` into `dist/content.js` and `dist/model-export.js` (`scripts/build.mjs`). |
| `npm run check` | All of the above. GitHub Actions runs it on every push and pull request. |
| `npm run icons` | Redraws `icons/*.png` from `scripts/icons.mjs`. |
| `npm run package` | Builds, then writes the release zip (see [Releasing](#releasing)). |
| `npm run check:card-reader` | Compares the card reader with SAM's copy (see [Relationship to SAM](#relationship-to-sam)). |

Layout:

- `src/content.ts`: the app page analysis and the Model Building page's button (isolated world), bundled into `dist/content.js`.
- `src/model-content.ts`: the model export's reading side, in the page's main world, bundled into `dist/model-export.js`.
- `src/card-reader/`: the card reader shared with SAM.
- `scripts/`: build, packaging, icons and the card reader check.
- `docs/research/`: research notes on the page definition formats the card reader follows.

Bump `version` in both `manifest.json` and `package.json` whenever the bundles change. The panel title and the details files show it, so each build and its output can be told apart, and the packager refuses a mismatch between the two files.

## Releasing

1. Bump `version` in `manifest.json` and `package.json`, and add the release to [CHANGELOG.md](CHANGELOG.md).
2. Check the card reader against SAM: `npm run check:card-reader -- <path to anaplan-sam>` (default `../anaplan-sam`). It must report the five files identical.
3. Run `npm run check`.
4. Run `npm run package`. It builds, then writes `release/cardigan-<version>.zip` and prints its SHA-256.
5. Publish the zip with its SHA-256 as the release's download.

The zip holds only `manifest.json`, `dist/content.js`, `dist/model-export.js` and the icons, never sources, tests, docs or `node_modules`. Its entries are sorted, stored uncompressed and carry fixed times, so the same files give the same bytes, and the same SHA-256, on every run. The packager refuses to run when a bundle is missing or older than the sources it is built from.

## Relationship to SAM

Cardigan began as `extension/page-analyzer` inside SAM (anaplan-sam), versions 0.5.2 to 0.5.5, and moved here with its history. SAM's `describe_ux_page_cards` MCP tool and this extension use the same card reader. Each repository keeps its own copy:

| Here | In SAM |
| --- | --- |
| `src/card-reader/` | `src/domains/ux-designer/` |

The five source files `card-details.ts`, `card-naming.ts`, `card-types.ts`, `definition-json.ts` and `definition-types.ts` must stay byte-for-byte identical. Change them the same way in both repositories, and run `npm run check:card-reader` before every release: it names each file that differs and fails on drift, and it is skipped when no SAM checkout is present (as in CI). The reader's tests here (`card-details.test.ts`, `definition-json.test.ts`) are copies of SAM's and may differ from them.

Some source comments mention SAM where the analyzer follows SAM's behaviour, for example the order in which SAM's name resolver looks up filter items. The research notes in `docs/research/` were written in SAM; their companion notes live in SAM's repository.

## Licence

[MIT](LICENSE). See [NOTICE.md](NOTICE.md).
