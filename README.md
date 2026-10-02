# Anaplan Analyzer (Chrome extension)

Adds an **Analyse app** button to Anaplan apps. It reads every page in the app and downloads a zip of CSV files that list, per page and card:

- the model
- the modules, saved views and line items
- rows, columns and pages
- filters
- conditional formatting
- actions

It uses the same card reader as SAM's `describe_ux_page_cards` tool ([`card-details.ts`](../../src/domains/ux-designer/card-details.ts) and [`card-naming.ts`](../../src/domains/ux-designer/card-naming.ts)), bundled into the extension.

## Install (load unpacked)

1. Build the bundle from the repository root: `npm run build:page-analyzer`. This writes `dist/content.js`, which is git-ignored, so rebuild after pulling changes.
2. In Chrome, open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked** and select this `extension/page-analyzer` folder.
3. Open an app in Anaplan (`https://<region>.app.anaplan.com/a/apps/app/<app id>…`) while signed in.
4. Click **Analyse app** (bottom right), wait for the progress panel to finish, then click **Download CSVs (.zip)**.

After a rebuild, click the reload icon on the extension's card in `chrome://extensions`, then refresh the Anaplan tab.

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
  - For a saved view, they are the view's pages, read from the same grid metadata Page Builder receives. This part is new; if it fails, the diagnostic log shows what the service sent.
- **Show/hide:** shown and hidden items and hierarchy levels come from the page. Item names are looked up the way Page Builder's show/hide list does.

## Limits

- Only published versions are read. Pages that were never published are listed as "Not published".
- A saved view's own filters, sorts and show/hide live in the model and are not listed.
- Filter-context items show their IDs.
- Buttons whose import, export or process is not found in the model keep their card label. **Name from** says which source was used.

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
| `Line Items.csv` | Modules → Line Items, all modules |
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
- In the calendar file, list choices use Anaplan's labels in the template's own words (Sat, Dec, Last), and settings the template's **Applies to** excludes for this calendar type are blank. **Model size (GB)** and **Captured by** are left blank for you to fill in, and **Captured on** is the export date.

## If names show as IDs or the analysis stops

Click **Copy diagnostic log** in the panel, or see the **Diagnostics** rows at the end of `App Details.csv` (`Model Details.csv` for a model export). They list:

- request paths and HTTP statuses
- socket frame commands and destinations
- model status
- counts of names found

It contains no cookies, tokens or cell values. Send it back with a note of what you expected.

## Development

- Sources are in `src/`.
- Run the tests with `npx vitest run extension/page-analyzer`; they also run in `npm test`.
- `npm run build:page-analyzer` type-checks the sources and bundles them.
- Bump `version` in `manifest.json` with every rebuild. The panel title and the details file show it, so each build and its output can be told apart.
