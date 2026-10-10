# Cardigan

Cardigan is a Chrome extension for Anaplan. Open an app or a model, click the Cardigan icon, and it reads what the app's pages or the model's settings hold. The result opens on a page of its own, where you can search, sort and filter each table. For a model, the page also draws a map of what feeds what.

Cardigan makes no file and offers no download: the results page is the only place to see a result. The last result is kept for its tab in the browser's session storage, so that a refresh brings it back.

Cardigan only reads, with your own signed-in session, and nothing it reads leaves your browser. It is an independent project, not affiliated with Anaplan: see [NOTICE.md](NOTICE.md).

![An app's Overview on the results page, under the navigation bar: the number of rows in each table, what was read and when under About this export, and the notes](docs/images/app-overview.png)

The pictures on this page show an invented app and model.

## What you get

### For an app

Cardigan reads every published page of the app. The **Overview** counts each table's rows and says what was read and when. The tables:

| Table | One row per |
| --- | --- |
| **Pages** | Page: category, type, publish state, model and card counts |
| **Cards** | Card: type, modules, saved view, line items shown, rows, columns, context selectors, filters, formatting, buttons and text |
| **Grid Sections** | Section of a grid or chart; a combined grid has several |
| **Filters** | Filter condition on a grid's rows or columns |
| **Conditional Formatting** | Formatting rule or KPI indicator |
| **Action Buttons** | Button, with its action type and the model action it runs |
| **Model Objects** | Use of a module, line item, dimension, saved view, action or linked page by a card |

![An app's Cards table, searched for the word forecast, with the column chooser open and the pager at the top right](docs/images/app-cards.png)

**Model Objects** opens **By object**: one row per object, with how many pages and cards use it and as what. A row opens the object with each of its uses. **Every use** lists the uses one by one.

### For a model

Open the model in Model Building; the classic model page opened on its own works too. Cardigan reads the Model settings into twelve tables, in Anaplan's order, and makes a thirteenth, Dynamic Cell Access, from Line Items: Model Calendar, Time Ranges, Versions, General Lists, Modules, Line Items, Dynamic Cell Access, Processes, Imports, Import Data Sources, Exports, Other Actions and Source Models.

Then it reads the pages built on the model, in every app you can open, and makes three more tables: **Module Usage**, **Page Filters** and **Page Actions**. They come last, before the map.

- A table read from a Model settings grid is laid out as Anaplan's own export of that grid: each row's name first, then the grid's columns.
- **Line Items** lists every row of Anaplan's Line Items grid, so it counts what the grid counts: each module's own row, in bold, above that module's line items, and each line item beside its module. **Format type**, after **Format**, gives each line item's data type: Number, Boolean, Date, Time Period, List, Text or No Data. It always has a filter: untick **(blank)** to list only line items, and **No Data** as well to leave out the line items that are headings. Three columns follow Anaplan's own: **Ratio Numerator**, **Ratio Denominator** and **Format List**.
- **Double-click a row of Line Items or Modules to open its module in Anaplan.** The Anaplan tab Cardigan read loads Model Building on that module and comes to the front; no new tab opens. The page reloads, and the model stays open. A line item opens its module: Model Building opens modules, not single line items. It works for a model read in Model Building, by this version or a later one; otherwise the page says what to do.
- **Dynamic Cell Access** lists each access driver with the line items it controls, one row per use, marked **Read** or **Write**. It is made from the **Read Access Driver** and **Write Access Driver** columns of Line Items, which name a driver only on the line item it controls.
- The page says a format, a summary or an action's definition in words, such as "Number, 2 decimal places", "List: Products" or "Delete from Products using Selection". Click the row to see the definition as it was read, under **Format as read**, **Summary as read** or **Action as read**.
- **Processes**, **Exports** and **Other Actions** are the Actions list, split at its headings. One column follows Anaplan's own in **Other Actions**: **Action List**, the list an action deletes from or orders, as General Lists names it. **Imports** joins each import's source and target with its last run, notes and processes.
- In **Imports**, an import from a module or a saved view shows its **Source Object** as three columns, **Source Model**, **Source Module** and **Saved View**. For an import from the model itself, Source Model names the model. Click the row to see Source Object as it was read, under **Source Object as read**. Any other source, such as a file, stays as it is, under Source Model.
- **An import from a file shows its mapping.** Click a row of **Imports** whose **Source Type** is FILE: below **All columns**, **Mapping** lists each target of the import with what feeds it: a column of the file, by its number and, where the import keeps it, its heading; a constant and its value; a prompt; ignored; or not mapped. For an import into a module the targets are its dimensions (each list, **Time**, **Versions** and **Line Items**) and its line items; for an import into a list, the list's items, **Parent**, **Code** and its properties. A line under them names the file's columns before the last one mapped that no target uses. The mapping comes from the import's own saved definition, so it shows even when the file is no longer available. An import into users, versions or line items says what it loads instead.
- **Source Models** shows **Mapped To** as two columns, **Mapped Workspace** and **Mapped Model**: the workspace and the model each source model is mapped to, by name, or by ID where Anaplan gives no name. Click the row to see Mapped To as it was read, under **Mapped To as read**.
- **Module Usage** lists each module with the apps and pages that use it, one row per module and page, in the order of Modules. A page uses a module when a card on it shows the module, a saved view of it or one of its line items, or filters or formats by one of its line items. A module that no page uses has one row, which says **Not on any page**. **App** has a filter.
- **Page Filters** and **Page Actions** are an app's **Filters** and **Action Buttons** tables for those pages, with the app in front: every filter and every button of a card that works on this model, by app, page and card.
- **Line Items** has one more column, **Page Filters**: how many page filters have the line item as their condition. It is empty rather than 0 when a page could not be read, or a filter's condition line item could not be named.
- On the Overview, under **About this export**, **Apps** names the apps whose pages use the model, one per line, or says that no app's pages use it.
- **Model Calendar** lists the calendar's settings that hold a value: a setting that does not apply to the model's calendar type, or that the model does not show, is left out, and so are the template's **Applies to** and **Notes** columns, which only guide filling it in by hand. Its **Allowed values** column starts hidden; the column chooser shows it. The template's rows about the model itself are not listed either: those that have a value, such as **Captured on**, are on the Overview, under **About this export**.

![A model's Dynamic Cell Access table: each access driver with the line items it controls, one row for each use, marked Read or Write. The navigation bar above it ends with Module Usage, Page Filters, Page Actions and Model map](docs/images/model-dynamic-cell-access.png)

#### Model map

**Model map**, the last entry in a model's navigation, draws the model: its sections, modules and line items, and what feeds what. It is made from the tables above and nothing else, so it reads nothing more from Anaplan.

![The model map as it opens: the eight sections of a model as boxes, with arrows between the sections that feed one another and the legend of the sections at the lower left](docs/images/map-sections.png)

- The map opens on the model's sections. A section is the modules under one heading: a module whose name starts with `--`, such as `-- Inputs --`. Without headings it opens on the modules.
- Double-click a section to open its modules, and a module to open its line items. **Show all modules** shows every module. `Esc` goes back a step.
- An arrow from A to B means B reads A.
- Click a box to see everything that feeds it, marked in blue, and everything it feeds, marked in red, directly or through others. The rest fades; **Only these** hides it. Dashes move along the marked links for as long as the box is selected, long ones towards it and short ones away from it; they stand still if your system is set to reduce motion.
- The panel on the right gives the box's details: for a line item its formula, format and summary in words, and what feeds it and what it feeds directly. A line item's details also list the page filters that have it as their condition, by app, page and card, from **Page Filters**: the first ten, and how many more.
- The search finds sections, modules and line items by name. In the **Legend**, click an entry to hide or show its boxes. **Access drivers** adds a link from each access driver to what it controls.
- From **Line Items** or **Modules**, **Open in Model map**, at the top of a row's details, goes straight to that line item or module on the map, selected, with what feeds it and what it feeds.
- Drag to move, scroll to zoom, press `F` for the whole map. **About this map** lists the keys. The map follows the page's theme.

![The model map in the dark theme, on one module's line items: one line item is selected, the boxes that feed it are marked in blue and the boxes it feeds in red, and a panel on the right gives its details, with its formula](docs/images/map-line-items.png)

## Install

Cardigan needs Chrome 111 or later, on Windows or on a Mac. Nothing else has to be installed.

1. **Download the extension.** On the [latest release](https://github.com/larasrinath/cardigan/releases/latest), under **Assets**, take `cardigan-<version>.zip`: the entry that shows a file size. Do not take **Source code (zip)** or **Source code (tar.gz)**. GitHub adds those two to every release, the zip one even arrives under the same file name, and they hold the source code, which Chrome cannot load.
2. **Unzip it into a folder you keep.** Chrome loads the extension from that folder every time it starts. On Windows, right-click the zip and choose **Extract All...**; on a Mac, double-click it.
3. **Look into the folder.** It must hold `manifest.json` and a `dist` folder with four `.js` files. If it holds `src` and `package.json` instead, it is the source code: go back to step 1.
4. **Load it in Chrome.** Open `chrome://extensions`, turn on **Developer mode** at the top right, choose **Load unpacked** and select that folder.
5. **Click the Cardigan icon on an Anaplan tab.** An app that was open before needs no refresh: the click puts Cardigan's script there. A model in Model Building that was open before needs one refresh. The puzzle icon in Chrome's toolbar lets you pin Cardigan there.

If Chrome says **Could not load javascript 'dist/content.js' for script** and **Could not load manifest**, the folder you selected has no `dist` folder: it is the source code, or a folder above or below the right one. Start again from step 1.

To check the download, compare it with the SHA-256 published with the release: `shasum -a 256 cardigan-<version>.zip` on a Mac, `certutil -hashfile cardigan-<version>.zip SHA256` on Windows.

To update, unzip the new release over the same folder and click the reload icon on Cardigan's card in `chrome://extensions`. Your Anaplan tabs need no refresh: click the Cardigan icon on one.

## Use

1. Sign in to Anaplan. Open an app, or open a model in Model Building and wait until it has loaded.
2. Click the Cardigan icon in Chrome's toolbar. The results page opens in the next tab and starts reading by itself.
3. Keep the Anaplan tab open until it finishes. The page shows each step, then the result.

Closing the results page stops the reading.

### The results page

- The page stands in a column in the middle of the window, at most 1,400 pixels wide, with room at both sides that grows with the screen. A table wider than the column scrolls sideways in its own box. The model map takes the whole width of the window.
- The navigation is a bar under the header, on one line, with an icon for each entry: the overview, each table and a model's map. A model's tables are grouped in menus, **Time**, **Lists**, **Modules** and **Actions**, with **Versions**, **Source Models**, **Module Usage**, **Page Filters** and **Page Actions** on their own; a group with only one table in the result is that table's entry. A menu's button names the table shown when it is one of the menu's. In a window narrower than 1,000 pixels, one menu holds every entry. The Overview's tiles say how many rows each table has, and a click on a tile opens its table.
- The search box looks in every column, shown or hidden. Press `/` to reach it.
- Click a column's name to sort. A column with 2 to 30 different values also has a filter. The columns keep their widths whatever the sort, the page, the search or the filter.
- Counts, such as **Cell Count** and **Item Count**, show their thousands with commas. A formatting rule's **Colour stops** show a square of each colour.
- **Columns** picks the columns shown. An app's ID columns, **Card #** and **Section #** start hidden.
- Click a row to read every value in full. In an app, a page's name shows that page's cards: a chip beside the search box names the page, and its cross shows all the cards again. A card's title opens the card with its grid sections, filters, formatting and buttons.
- Where a value lists several items, such as a line item's **Applies To** and **Referenced By** or a card's **Context selectors**, the panel that opens lists them one per line. The table keeps them on one line, and the search, the sort and the filters read them as the table shows them. A name in quotes stays whole, commas and all.
- Click an ID to copy it.
- The sun or moon button switches the theme.

**How to read these tables**, on the Overview, has the notes for reading them. One to know: "(not in the model)" after an ID marks a module or line item that a card points at and the model no longer has, or that you cannot see.

### Run again, refresh and Forget this result

- **Run again** reads the Anaplan tab again. The result on the page stays until the new one is complete.
- The last finished result is kept for its tab, so a refresh brings it back without reading Anaplan, on the table or the map that was shown. A line above it says when it was analysed.
- **Forget this result**, on the Overview, removes the kept copy at once. The result stays on the page until you refresh or close it.
- Only the icon starts a reading unasked. A results page that is reloaded, duplicated or reopened waits for **Run** or **Run again**.

### If it does not start

- **Not connected**: the Anaplan tab did not answer. A tab that was open before Cardigan was installed, updated or reloaded needs nothing: clicking the icon on it puts Cardigan's script back there. A tab that is still loading is asked again for a few seconds; if it still does not answer, wait for it and choose **Run again**, or refresh it and click the icon on it.
- **Not an Anaplan tab** or **Tab closed**: the page says what the tab shows, or that it was closed. Open the app or model in Anaplan, then click the icon on that tab.
- **Nothing to analyse**: the tab shows an Anaplan page that is neither an app nor a model. Open one there, let it load, then choose **Run again**.
- When a reading stops, the page says what happened and what to do. **Copy diagnostic log** copies the log, to send with a report. It holds request paths, statuses and counts, and no cookies, tokens or cell values.
- If the model map cannot be drawn, the page says so in the map's place. The tables are not affected, and **Copy diagnostic log** beside the message copies the reason.

## Privacy and permissions

- Cardigan declares two permissions, **activeTab** and **scripting**, and neither comes with a warning. Together they let a click on its icon put its script back into that one Anaplan tab when Chrome has not, as in a tab that was open before Cardigan was installed, updated or reloaded. It asks for no access to any site. Its scripts run only on `https://*.app.anaplan.com` and, for Australia, `https://*.app2.anaplan.com`, and add nothing to those pages.
- It reads nothing until you click its icon or choose **Run again**. It is read-only by construction: its web requests are GET requests to two Anaplan services, its socket client can only subscribe, and every request to a model is checked to carry no change.
- A model's settings are read through the model's own page, and so is each import's saved mapping, as Anaplan's own import dialog reads it. After them, Cardigan reads the pages built on the model as it reads an app's: GET requests for Model Building's list of those pages, each page, each of their apps and the model's action names, and the model data socket for the other names the pages' cards use.
- Nothing is sent anywhere except those reads, and the results page loads nothing from the internet.
- A double-click on a row of a model's **Line Items** or **Modules** takes your Anaplan tab to that module in Model Building. That changes which page the tab shows, and nothing in the model.
- The kept result is in the browser's session storage for its tab, compressed and not encrypted.

[NOTICE.md](NOTICE.md) says the rest, including what closing a tab does and does not erase.

## Limits

- Only the published version of a page is read. A page never published is listed as "Not published".
- Reading an app's names, or those of the pages built on a model, can make Anaplan load the model, as opening one of its pages would.
- **Module Usage**, **Page Filters** and **Page Actions** need the model open in Model Building at an address that names its customer (`/a/modeling/customers/…`), as Model Building's own links do: the pages built on a model are listed for its customer. Elsewhere, as on the classic model page opened on its own, the Overview lists them under **Tables** as "Not exported", with the reason, and so it does when Anaplan refuses the list of pages.
- They hold only the published pages you can open. A page that cannot be read is named in a note: a module on it may show as **Not on any page**, and a line item's **Page Filters** count is empty rather than 0. So is the count where a filter's condition line item could not be named: the filter keeps the line item's ID.
- They count a card for the model it works on: the page's, unless the card names another, which leaves it out. A button names no model of its own, so its card's decides.
- A saved view's own filters, sorts and hidden items are set in the model and are not listed.
- A card's shown or hidden items are named up to five per dimension, then counted. A text card's text is cut at 500 characters.
- A filter rule's line item in a module that no card shows is looked for during at most 45 seconds per model. After that the rule keeps its IDs, and a note says so.
- The items a filter rule names are looked up for at most 30 seconds per model. The rest keep their IDs.
- A button whose import, export or process is not in the model keeps its card label; **Name source** says so.
- Where two pages share a name, a count in **Model Objects** can read "2+" (at least 2), and some links are plain text.
- A Model settings grid of more than 250,000 rows is not read. The Overview lists it under **Tables** as "Not exported", with the reason.
- An import's **Mapping** knows the file only as the import's definition does: Anaplan keeps the mapping, not the file's header row. So it cannot say whether the file has columns after the last one mapped, and a column that the import names by its heading alone has no number: the columns before it that no number takes may be used, and the page says so. An import from a module, a saved view or another model has no **Mapping**, and neither has a result that an earlier version kept: choose **Run again**.
- In **Dynamic Cell Access**, a driver that cannot be matched to a line item is listed last, as Line Items has it and with no **Driver Module**, and the page says how many there are. The table is not made when Line Items was not read.
- The model map takes each link from a column that names another object, such as **Referenced By**. It shows formulas as text and does not work them out.
- The map draws sections, modules, line items and the lists that formulas name. Processes and actions are not drawn; a module's details name the imports that load into it.
- **About this map**, at the foot of the map, says what the map leaves out and could not place for this model, such as a line item named twice in one module.
- A large view is shown whole with names cut short: point at a box to read its name. One too large even for that opens on its start, and **Whole map** shows all of it.
- The map's view is not kept: a refresh, **Run again** or **Forget this result** starts it afresh.
- A result over 64 MB as JSON, or 9 MB compressed, is not kept for a refresh; the page says so.
- Anaplan can change the internal services Cardigan reads without notice: see [NOTICE.md](NOTICE.md).

## For developers

You need Node 20.19+, 22.12+ or 24+.

| Command | What it does |
| --- | --- |
| `npm ci` | Installs the pinned TypeScript, Vitest and esbuild |
| `npm run build` | Type-checks, then writes the four bundles in `dist/` |
| `npm test` | Runs the unit tests in `src/` (Vitest). `npm run test:scripts` runs those of `scripts/` |
| `npm run check` | Type-check, both test suites and the build. GitHub Actions runs it on every push and pull request |
| `npm run package` | Builds, then writes the release zip |
| `npm run icons` | Makes the four icons in `icons/` again from the logo, `icons/source.png` |

To run from source, choose **Load unpacked** and select the repository root. After a rebuild, reload the extension, then click the icon on the Anaplan tab: that puts the new content script there. What reads a model inside the page (`src/model-content.ts`, `src/model/`, `src/bridge.ts`) is loaded only with the page, so refresh the tab after changing it. `dist/` is not in Git: build after every pull.

In the Anaplan tab, `src/content.ts` and `src/analyse.ts` read an app, and `src/model-content.ts` and `src/model/` read a model through the page's own client. `src/model-pages.ts` then reads the pages built on the model, as an app's pages are read. `src/card-reader/` reads a page's cards. `src/background.ts` opens the results page: `results.html`, `results.css` and `src/results/`. `src/map/` builds a model's map from the model's tables and draws it on the page, styled by `map.css`. `src/protocol.ts` lists the messages between the page and the tab, and `src/results/connection.ts` connects the two, putting the content script back into a tab that has none.

### Release

1. Set the new `version` in `manifest.json`, `package.json` and `package-lock.json` (two fields), and add the release to [CHANGELOG.md](CHANGELOG.md).
2. Run `npm run check`.
3. Run `npm run package`. It writes `release/cardigan-<version>.zip` and prints its SHA-256.
4. Publish the zip with its SHA-256.

The zip holds the twelve files Chrome loads: `manifest.json`, four bundles, four icons, `results.html`, `results.css` and `map.css`. The same files always give the same bytes. The packager refuses a version that differs between `manifest.json` and `package.json`, a missing or stale bundle, a results page that loads a file outside the zip, and a manifest that asks for any permission but activeTab and scripting, or has no content security policy that keeps everything inside the package.

## Licence

[MIT](LICENSE).
