# Cardigan

Cardigan is a Chrome extension for Anaplan. Open an app or a model, click the Cardigan icon, and it reads what the app's pages or the model's settings hold. The result opens on a page of its own, where you can search, sort and filter each table. For a model, the page also draws a map of what feeds what.

Cardigan makes no file and offers no download: the results page is the only place to see a result. The last result is kept for its tab in the browser's session storage, so that a refresh brings it back, as you left it.

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

It also reads the pages built on the model, in every app you can open, and makes three more tables: **Module Usage**, **Page Filters** and **Page Actions**. They come last, before the map. The pages are read while the Model settings are, since neither needs the other, and so are the names of the model's modules and lists; the rest of the names wait for the settings. The pages' cards are named with the line items Cardigan reads from Line Items, so a large model's pages are named without reading its modules again. The diagnostic log ends with a line that says how long the settings, the pages and the names took, and the run in all.

- A table read from a Model settings grid is laid out as Anaplan's own export of that grid: each row's name first, then the grid's columns.
- **Line Items** lists every row of Anaplan's Line Items grid, so it counts what the grid counts: each module's own row, in bold, above that module's line items, and each line item beside its module. **Format type**, after **Format**, gives each line item's data type: Number, Boolean, Date, Time Period, List, Text or No Data. It always has a filter: untick **(blank)** to list only line items, and **No Data** as well to leave out the line items that are headings. Three columns follow Anaplan's own: **Ratio Numerator**, **Ratio Denominator** and **Format List**.
- **Open a row where it leads, from the top right of its details.** Buttons there, one under another, each with its icon:
  - **Model map** shows a line item, a module or a list on the map, from **Line Items**, **Modules**, **Module Usage** or **General Lists**.
  - **Model** opens the row's module or list in Model Building: a line item opens its module, since Model Building opens modules, not single line items, and a row of **General Lists** opens its list. In **Page Filters**, **Condition module** and **Filtered module** open the filter's two modules, or one **Model** button where they are the same, and **Filtered list** opens the list the filtered dimension is, or the list of a subset. Where the Anaplan tab shows the model in Model Building, the module or the list opens there beside the tabs already open, as Model Building's own Modules list and General Lists open one, and the page does not load again. Anywhere else, the object's own link is loaded, which opens the model with that module or list alone. As in Model Building itself, a list opens only for a workspace administrator; to anyone else Anaplan says that it cannot find it.
  - **App** and **Page** open the app and the page in Anaplan, from **Module Usage**, **Page Filters** and **Page Actions**.

  What **Model** opens, from each of a model's tables:

  | Table | Model opens |
  | --- | --- |
  | Modules, Line Items, Module Usage | the module |
  | Dynamic Cell Access | the driver's module and the controlled module (**Driver module**, **Controlled module**), or one **Model** where they are one |
  | General Lists | the list |
  | Page Filters | the condition line item's module and the filtered module, and the filtered dimension's list (**Filtered list**) |
  | Model Calendar, Time Ranges | the Time page |
  | Versions | the Versions page |
  | Line Item Subsets | the Line Item Subsets page |
  | Processes, Imports, Exports, Other Actions, Import Data Sources, Page Actions | the Actions page |
  | Source Models | the Source Models page |

  A page of the model's settings opens by its Model Building address, which loads Model Building afresh, and as a whole: its address does not say which row to select, and Model Building opens such a page inside itself through no way Cardigan can ask for.

  A button's title names what it opens, and only the buttons whose place is known are there. Modules and lists open in the Anaplan tab Cardigan read, which comes to the front with its window. Apps and pages open in a tab of their own: the first **App** or **Page** opens a new tab next to this page, and every later one uses that tab. No tab opens for each click, and the details stay open here. If the Anaplan tab has been closed, the first module or list opens one tab in its place, and every later one uses that; a closed tab of apps and pages is replaced the same way. A refresh of this page keeps both. Where the result keeps every row from a way to open it, as one an earlier version read, a line under the details' header says why. The Anaplan tab never goes to an app, so **Run again** reads the model again. A model tab that still holds the reader of an earlier Cardigan first gets this one's, where Chrome lets Cardigan reach the model's frame, and the module or list then opens beside the tabs already open; elsewhere it loads the object's link, which brings the new reader with the page.
- **Dynamic Cell Access** lists each access driver with the line items it controls, one row per use, marked **Read** or **Write**. It is made from the **Read Access Driver** and **Write Access Driver** columns of Line Items, which name a driver only on the line item it controls.
- The page says a format, a summary or an action's definition in words, such as "Number, 2 decimal places", "List: Products" or "Delete from Products using Selection". Click the row to see the definition as it was read, under **Format as read**, **Summary as read** or **Action as read**.
- **Processes**, **Exports** and **Other Actions** are the Actions list, split at its headings. One column follows Anaplan's own in **Other Actions**: **Action List**, the list an action deletes from or orders, as General Lists names it. **Imports** joins each import's source and target with its last run, notes and processes.
- In **Imports**, an import from a module or a saved view shows its **Source Object** as three columns, **Source Model**, **Source Module** and **Saved View**. For an import from the model itself, Source Model names the model. Click the row to see Source Object as it was read, under **Source Object as read**. Any other source, such as a file, stays as it is, under Source Model.
- **An import from a file shows its mapping.** Click a row of **Imports** whose **Source Type** is FILE: below **All columns**, **Mapping** lists each source of the import first, with the target it feeds. The file's columns come first: each by the file's header for it where the import keeps one, as Anaplan most often saves a column, or else by its number ("Column 3"), in the file's order where the import gives the columns' places, and a column that feeds two targets has a row for each, together. After the columns come the constants with their values, the prompts and the header row. For an import into a module the targets are its dimensions (each list, **Time**, **Versions** and **Line Items**) and its line items; for an import into a list, the list's items, **Parent**, **Code** and its properties. A target that nothing feeds has no row, so the table has no empty source: a line under it names each such target after **Not mapped**, with why where there is more to say (ignored, or a list that numbers its items itself). Above the table of an import into a list, a line says how the list's items are told apart, in Anaplan's own words for the import's choice: **Items uniquely identified by** Name or code, Name only, Code only (for a numbered list, Name (#ID) or Code), or a combination of properties, each named. That is why **Parent** or **Code** may rightly be not mapped, and a numbered list told apart by code or by properties numbers its items itself, which the line of targets not mapped says. Of an import into a module, a line under a source says how it is read, where the import keeps it: how many of a dimension's items are mapped by hand and how many ignored, the format **Time**'s periods are read by (or that they are matched by their names), and a date line item's format. A dimension whose items nothing is mapped for by hand is matched on its items' names or codes when the import runs, and a line under the table says so. Where the line items come from the header row, each header mapped to a line item by hand is a row of its own, with its line item, and each header ignored a row that says **Ignored**, after the other columns. Where none is, the header row is matched on the line items' names or codes when the import runs: Anaplan stores no such match, so the page says so, and lists under the header row the line items of the module that a header can match (the first five, and **Show all** for the rest), which are the headers the file can use, not the file's own. With the header row the import has no single column of values, and the page names none as not mapped. Another line names the file's columns before the last one mapped that no target uses. The mapping comes from the import's own saved definition, so it shows even when the file is no longer available. An import into users, versions or line items says what it loads instead. The diagnostic log on the Overview follows each step: how many imports there are by **Source Type**, the read of their definitions, each definition's make (its keys), how it writes its first column (each of the three ways a definition can, by its type and at most 20 characters of its value), the keys of the parts that could say more of its columns, a line on how its items are matched (each dimension's items mapped by hand and ignored, with the type and length of the first two source values but never their text, the codes behind them, which items it clears first, and whether **Time** has a period format), and how many mappings were found and read.
- **A process lists the actions it runs.** Click a row of **Processes**: below **All columns**, **Actions** lists each action the process runs, numbered in the order it runs them, with its kind (Import, Export or Other action). Click an action's name to open its own row. The order comes from the process's own saved definition, as Anaplan's Actions tab reads it. For a result an earlier version kept, or where the definitions could not be read, **Actions** lists the actions whose **Used in Processes** names the process instead, by kind, and says that the order is not known. The diagnostic log says how many processes there are, and how many were read with how many actions of each kind.
- **Source Models** shows **Mapped To** as two columns, **Mapped Workspace** and **Mapped Model**: the workspace and the model each source model is mapped to, by name, or by ID where Anaplan gives no name. Click the row to see Mapped To as it was read, under **Mapped To as read**.
- **Module Usage** lists each module with the apps and pages that use it, one row per module and page, in the order of Modules. A page uses a module when a card on it shows the module, a saved view of it or one of its line items, or filters or formats by one of its line items. A module that no page uses has one row, which says **Not on any page**. **App** always has a filter.
- **Page Filters** has the columns of an app's **Filters** table for those pages, with the app, in an order of its own: first what filters, the condition line item's module and the line item, then what it filters, the module and the dimension, then the condition (operator, value, which items show, its group and context, and what it filters on), and then where it is: app, page, card and section. **Page Actions** has those of **Action Buttons**: first the model's action a button runs, by name and type, then where the button is, by app, page, card and label, then how it behaves. Both list every filter and every button of a card that works on this model.
- The three tables end with columns that start hidden: each page's type and the IDs of its app and of itself, beside the IDs the app's tables hide. The column chooser shows them.
- **Line Items** has one more column, **Page Filters**: how many page filters have the line item as their condition. It is empty rather than 0 when a page could not be read, or a filter's condition line item could not be named.
- On the Overview, under **About this export**, **Apps** names the apps whose pages use the model, one per line, or says that no app's pages use it.
- **Model Calendar** lists the calendar's settings that hold a value: a setting that does not apply to the model's calendar type, or that the model does not show, is left out, and so are the template's **Applies to** and **Notes** columns, which only guide filling it in by hand. Its **Section** column, which says the same of every setting listed, and its **Allowed values** column start hidden; the column chooser shows them, and a row's details list them. The template's rows about the model itself are not listed either: those that have a value, such as **Captured on**, are on the Overview, under **About this export**.

![A model's Dynamic Cell Access table: each access driver with the line items it controls, one row for each use, marked Read or Write. The navigation bar above it ends with Module Usage, Page Filters, Page Actions and Model map](docs/images/model-dynamic-cell-access.png)

#### Model map

**Model map**, the last entry in a model's navigation, draws the model: its sections, modules and line items, and what feeds what. It is made from the tables above and nothing else, so it reads nothing more from Anaplan.

![The model map as it opens: the eight sections of a model as boxes, with arrows between the sections that feed one another and the legend of the sections at the lower left](docs/images/map-sections.png)

- The bar across the top of the map has three parts, each on one line; on a narrow map each part takes a line of its own.
  - **Where the map is.** The **Modules** and **Line items** switch, then a path that starts with the model's name, which leads back to the groups as a whole. In the Modules view the path's list says what is shown: **All groups**, **All modules**, or one group, with how many modules it holds. In the Line items view the path names the module's group, then the module. Click the module, or Tab to it, and type: the picker lists the group's modules until you type, and then every module whose name holds what you typed, at most 200 at once. Choose another group, or **All groups**, to list those modules instead. The path follows the map wherever it goes. The page's header names the workspace, so the path does not; the model's name says it when the pointer rests on it.
  - **How the map is built.** **Group by** in the Modules view; **Other modules' line items** in the Line items view, which shows those line items one by one, ticked, or one box for each other module.
  - **Its tools.** **Links** opens a panel of the links the map draws: formulas, always, and **Access drivers**, where you tick it. Read and Write Access Drivers are line items that decide which cells of a module or line item someone can see or edit (Anaplan's dynamic cell access); ticked, the map draws an arrow from each driver to what it controls. Then the search, and **Full screen**.
- The map groups the modules into sections, and opens on them. **Group by** chooses how, and marks the map's own pick as automatic:
  - **Functional area**: each module's Functional Area, from Modules.
  - **Headings**: the modules under one heading, a module whose name starts with `--`, such as `-- Inputs --`.
  - **Name prefix**: the code a module's name starts with, such as INP for `INP01 Volumes`, where enough modules share it: three, and at least one in fifty. The rest are under **Other**. The codes are learnt from the model's own names; none is built in.
  - **Role in the data flow**: Data, Input, System, Calculation or Output, worked out from what the model does with each module, never from its name. An import loads into a Data module, which is mostly without formulas. An Input module is mostly without formulas. A System module applies to no list, and three or more other modules read it. A Calculation module is mostly formulas that another module reads. An Output module's formulas no other module reads, or an export takes it.
  - **App**: the app whose pages show the module, from Module Usage, or **Several apps**, or **Not on any page**.
  - **Main dimension**: the first list the module applies to, a subset as its list, or **Time only**, or **No dimensions**.
- The map's own pick is the first of functional area, headings and name prefix that groups the model well: from 3 to 15 sections, none with more than half the modules, and at most a fifth of them left over. Otherwise it is the role in the data flow. A choice of yours is kept in this browser for the next map. A grouping that makes one section shows the modules instead.
- A module's details say its section and where it comes from, such as "INP · from module names", and for a role, why. The search says the section and where it comes from too. The ninth to the sixteenth section have the first eight colours again, in stripes.
- Double-click a section to open its modules, and a module to open its line items. The path's list shows **All modules**, one group's, or **All groups** again. `Esc` goes back a step.
- An arrow from A to B means B reads A.
- Click a box to see everything that feeds it, marked in blue, and everything it feeds, marked in red, directly or through others. The rest fades; **Only these** hides it. Dashes move along the marked links for as long as the box is selected, long ones towards it and short ones away from it; they stand still if your system is set to reduce motion. The map stays where it is: it moves only where the details or another panel would cover the box you clicked, and then no further than it takes to uncover it, at the same size. Clearing the selection moves nothing. A box you go to by the search, a link in the details or the arrow keys is brought into view beside the details, with what it has links with where they fit.
- The panel on the right gives the box's details: for a line item its formula, format and summary in words, and what feeds it and what it feeds directly. A line item's details also list the page filters that have it as their condition, by app, page and card, from **Page Filters**: the first ten, and how many more.
- The search finds sections, modules and line items by name. In the **Legend**, click an entry to hide or show its boxes.
- From **Line Items**, **Modules**, **Module Usage** or **General Lists**, **Model map**, at the top right of a row's details, goes straight to that line item, module or list on the map, selected, with what feeds it and what it feeds. A list is shown beside the line items of the first module it is linked with; a list linked with no line item is on no map.
- **Full screen**, at the end of the bar, gives the map the whole screen, with its bar, details and legend. The button and `Esc` leave it. Where the browser will not give it the screen, the map fills the browser's window instead, and `Esc` leaves that too.
- Drag to move, scroll to zoom, press `F` for the whole map. A click may shake a little and still be a click, a little more with a finger than with a mouse. **About this map** lists the keys. The map follows the page's theme.

![The model map in the dark theme, on one module's line items: one line item is selected, the boxes that feed it are marked in blue and the boxes it feeds in red, and a panel on the right gives its details, with its formula](docs/images/map-line-items.png)

## Install

Cardigan needs Chrome 111 or later, on Windows or on a Mac. Nothing else has to be installed.

1. **Download the extension.** On the [latest release](https://github.com/larasrinath/cardigan/releases/latest), under **Assets**, take `cardigan-<version>.zip`: the entry that shows a file size. Do not take **Source code (zip)** or **Source code (tar.gz)**. GitHub adds those two to every release, the zip one even arrives under the same file name, and they hold the source code, which Chrome cannot load.
2. **Unzip it into a folder you keep.** Chrome loads the extension from that folder every time it starts. On Windows, right-click the zip and choose **Extract All...**; on a Mac, double-click it.
3. **Look into the folder.** It must hold `manifest.json` and a `dist` folder with four `.js` files. If it holds `src` and `package.json` instead, it is the source code: go back to step 1.
4. **Load it in Chrome.** Open `chrome://extensions`, turn on **Developer mode** at the top right, choose **Load unpacked** and select that folder.
5. **Click the Cardigan icon on an Anaplan tab.** An app that was open before needs no refresh: the click puts Cardigan's script there. Neither does a model in Model Building that was open before: where the click cannot reach the model's frame, the results page offers **Refresh the Anaplan tab and run**. The puzzle icon in Chrome's toolbar lets you pin Cardigan there.

If Chrome says **Could not load javascript 'dist/content.js' for script** and **Could not load manifest**, the folder you selected has no `dist` folder: it is the source code, or a folder above or below the right one. Start again from step 1.

To check the download, compare it with the SHA-256 published with the release: `shasum -a 256 cardigan-<version>.zip` on a Mac, `certutil -hashfile cardigan-<version>.zip SHA256` on Windows.

To update, unzip the new release over the same folder and click the reload icon on Cardigan's card in `chrome://extensions`. An app's tab needs no refresh: click the Cardigan icon on it. A model's tab needs nothing either, in most cases. The part of Cardigan that reads a model runs inside the model's page, which keeps the earlier one until it is refreshed:

- An update that leaves that part as it was keeps it as it was: its mark comes from its code, not from the version, so the tab reads on.
- One that changes it: the results page puts the new reader into the model's page itself, as Chrome does when the page loads, and reads the model. Chrome lets it do so where the model is served from the tab's own Anaplan host.
- Where the model is served from another Anaplan host, Chrome lets Cardigan put nothing there. The results page says so and offers **Refresh the Anaplan tab and run**: the tab reloads, which closes the modules and lists open in Model Building, and Cardigan reads the model as soon as it shows. Nothing refreshes the tab unless you choose that.

The version stands next to Cardigan's name at the top of the results page, and [CHANGELOG.md](CHANGELOG.md) says what each version brought.

## Use

1. Sign in to Anaplan. Open an app, or open a model in Model Building and wait until it has loaded.
2. Click the Cardigan icon in Chrome's toolbar. The results page opens in the next tab and starts reading by itself.
3. Keep the Anaplan tab open until it finishes. The page shows each step, then the result.

Closing the results page stops the reading.

### The results page

- The page stands in a column in the middle of the window, at most 1,400 pixels wide, with room at both sides that grows with the screen. A table wider than the column scrolls sideways in its own box. The model map takes the whole width of the window.
- The navigation is a bar under the header, on one line, with an icon for each entry: the overview, each table and a model's map. A model's tables are grouped in menus, **Time**, **Lists**, **Modules** and **Actions**, with **Versions**, **Source Models**, **Module Usage**, **Page Filters** and **Page Actions** on their own; a group with only one table in the result is that table's entry. A menu's button names the table shown when it is one of the menu's. In a window narrower than 1,000 pixels, one menu holds every entry. The Overview's tiles say how many rows each table has, and a click on a tile opens its table.
- The search box looks in every column, shown or hidden. Press `/` to reach it.
- Click a column's name to sort: a small chevron beside the name points up while the column runs from its least, and down while it runs from its most. Almost every column also has a filter, the funnel beside its name:
  - Any column with 2 to 30 different values has one.
  - A column with more has one too, unless it holds what nobody picks from a list. That means a row's own name in a model's tables, free text (**Formula**, **Notes**, a card's **Text content**) and IDs. It also leaves out a column whose every value is in one row only, such as **Code**. The search finds a value in those.
  - A filter with more than 15 values has a box to find them: the list shows what it finds, and **Tick matches** and **Untick matches** tick or untick all of that, listed or not. At most 300 values are listed at once; type to narrow the list.
  - A column of numbers or of dates is filtered by a range instead of a list to tick: **From** and **To**. That is any column whose every value is a number, or every value a date: counts such as **Cell Count** and **Item Count**, the **Sources** and **Imports** of **Source Models**, an action's duration and start, when a page was last published, a card's number. Either box may stay empty, for no end on that side, and both ends are kept: from 3 to 3 keeps card 3. A box for numbers shows the column's lowest or highest value until you type, and takes 1200, 1,200, -3.5 or 40%. A box for dates is the browser's own, and keeps whole days: until 12 March keeps an action that started late on 12 March. Where the column's header says UTC, so does the filter. Under the boxes, **Keep blank cells** keeps or leaves out the rows with nothing in that column. **Enter** or **Apply** sets the range, and a box Cardigan cannot read says what is wrong instead. The funnel says what the range keeps, such as "≥ 10" or "10–100"; **Clear** and **Reset** take it away. A code made of figures that begin with a zero, such as 0040, is no number, and an ID is never filtered by a range.
  - The columns keep their widths whatever the sort, the page, the search or the filter.
- Counts, such as **Cell Count** and **Item Count**, show their thousands with commas, and so do the edges of their range filter. A formatting rule's **Colour stops** say each colour and the value it stands at, such as "#F5A5B1 at -10; #627786 at 100,000", with a square of each colour before its code.
- **Columns** picks the columns shown. An app's ID columns, **Card #** and **Section #** start hidden.
- Click a row to read every value in full. In an app, a page's name shows that page's cards: a chip beside the search box names the page, and its cross shows all the cards again. A card's title opens the card with its grid sections, filters, formatting and buttons.
- Where a value lists several items, such as a line item's **Applies To** and **Referenced By** or a card's **Context selectors**, the panel that opens lists them one per line. The table keeps them on one line, and the search and the sort read them as the table shows them. The filter lists each item on its own, with the rows that list it, and shows a row when any of its items is ticked: untick every region but one under a module's **Applies To**, and the modules that apply to that region stay. A name in quotes stays whole, commas and all.
- Click an ID to copy it.
- The sun or moon button switches the theme.

**How to read these tables**, on the Overview, has the notes for reading them. One to know: "(not in the model)" after an ID marks a module or line item that a card points at and the model no longer has, or that you cannot see.

### Run again, refresh and Forget this result

- **Run again** reads the Anaplan tab again. The result on the page stays until the new one is complete.
- The last finished result is kept for its tab, so a refresh brings it back without reading Anaplan, on the table or the map that was shown. A line above it says when it was analysed.
- A refresh keeps how you left the result too, until the tab is closed: each table's filters and ranges, the columns you showed or hid, its sort and its page; the rows a page lists; the search of the table you were on; how **Where Used** is listed; where the model map was, its group or module and its links; and a row's details that were open. **Run again** on the same app or model keeps what still fits its tables, each column by its name; another app or model starts clean. **Reset** clears a table's.
- **Forget this result**, on the Overview, removes the kept copy at once, and how you left it. The result stays on the page until you refresh or close it.
- Only the icon starts a reading unasked. A results page that is reloaded, duplicated or reopened waits for **Run** or **Run again**.

### If it does not start

- **The Anaplan tab needs a refresh**: the model's page still holds the part of Cardigan that reads a model from an earlier version, and Cardigan could not put the new one there: the model is served from another Anaplan host than the page, or the new one did not answer. Choose **Refresh the Anaplan tab and run**.
- **Not connected**: the Anaplan tab did not answer. A tab that was open before Cardigan was installed, updated or reloaded needs nothing: clicking the icon on it puts Cardigan's script back there. A tab that is still loading is asked again for a few seconds; if it still does not answer, wait for it and choose **Run again**, or refresh it and click the icon on it.
- **Not an Anaplan tab** or **Tab closed**: the page says what the tab shows, or that it was closed. Open the app or model in Anaplan, then click the icon on that tab.
- **Nothing to analyse**: the tab shows an Anaplan page that is neither an app nor a model. Open one there, let it load, then choose **Run again**.
- When a reading stops, the page says what happened and what to do. **Copy diagnostic log** copies the log, to send with a report. It holds request paths, statuses, counts and how long each step took, and no cookies, tokens or cell values.
- If the model map cannot be drawn, the page says so in the map's place. The tables are not affected, and **Copy diagnostic log** beside the message copies the reason.

## Privacy and permissions

- Cardigan declares two permissions, **activeTab** and **scripting**, and neither comes with a warning. Together they let a click on its icon put its script back into that one Anaplan tab when Chrome has not, as in a tab that was open before Cardigan was installed, updated or reloaded, and the part that reads a model as well, in the frames of that tab's own Anaplan host. It asks for no access to any site. Its scripts run only on `https://*.app.anaplan.com` and, for Australia, `https://*.app2.anaplan.com`, and add nothing to those pages.
- It reads nothing until you click its icon or choose **Run again**. It is read-only by construction: its web requests are GET requests to two Anaplan services, its socket client can only subscribe, and every request to a model is checked to carry no change.
- A model's settings are read through the model's own page, and so are each import's saved mapping, as Anaplan's own import dialog reads it, and each process's saved list of actions, as Anaplan's Actions tab reads it. Beside them, Cardigan reads the pages built on the model as it reads an app's: GET requests for Model Building's list of those pages, each page, each of their apps and the model's action names, and the model data socket for the other names the pages' cards use. The line items it reads from the model's settings name most of those: the socket is asked for the line items of one module, to compare the two, and of a module they do not cover. It is asked for no saved view's rows, columns and context selectors, which only an app's tables show. The socket goes to the Anaplan host the model's own page is served from, its data centre, where Anaplan would otherwise send it.
- Nothing is sent anywhere except those reads, and the results page loads nothing from the internet.
- The buttons in a row's details take your Anaplan tab to a module or a list in Model Building; if that tab has been closed, the first opens one tab in its place. Apps and pages open in one more tab, which the first **App** or **Page** opens next to the results page and every later one reuses. That changes which page a tab shows, and nothing in the model or the app. Where the Anaplan tab shows the model in Model Building, a module or a list is opened inside that page through the classic Model Building client's own way of opening one, the one its Modules list and General Lists use: Cardigan sends Anaplan nothing for it.
- The kept result is in the browser's session storage for its tab, compressed and not encrypted. So is how you left it, beside it: the values you filtered on and the search you typed can be names from your app or model.
- The theme you chose, and how you chose to group the map's modules, are kept in the browser's local storage: a word each, nothing of your app or model.

[NOTICE.md](NOTICE.md) says the rest, including what closing a tab does and does not erase.

## Limits

- Only the published version of a page is read. A page never published is listed as "Not published".
- A page that is no board, worksheet or report has no **Page** button in a row's details: its app's opens all the same.
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
- An import's **Mapping** knows the file only as the import's definition does: Anaplan keeps the mapping, not the file's header row. So it cannot say whether the file has columns after the last one mapped, and a column that the import names by its heading alone has no number: the columns before it that no number takes may be used, and the page says so. Where no column mapped has a number, the page says that it cannot tell which columns are not used. A header that the import matches on a line item's name or code when it runs is stored nowhere, so the columns matched that way are not listed: the line items under the header row are only those a header can match. An import from a module, a saved view or another model has no **Mapping**, and neither has a result that an earlier version kept: choose **Run again**.
- In **Dynamic Cell Access**, a driver that cannot be matched to a line item is listed last, as Line Items has it and with no **Driver Module**, and the page says how many there are. The table is not made when Line Items was not read.
- The model map takes each link from a column that names another object, such as **Referenced By**. It shows formulas as text and does not work them out.
- The map draws sections, modules, line items and the lists that formulas name. Processes and actions are not drawn; a module's details name the imports that load into it.
- **About this map**, at the foot of the map, says what the map leaves out and could not place for this model, such as a line item named twice in one module.
- A large view is shown whole with names cut short: point at a box to read its name. One too large even for that opens on its start, and **Whole map** shows all of it.
- The map keeps its view, group or module and links, for a refresh and for **Run again** on the same model; not its zoom and position, the box selected, its search or full screen. **Forget this result** starts it afresh.
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

To run from source, choose **Load unpacked** and select the repository root. After a rebuild, reload the extension, then click the icon on the Anaplan tab: that puts the new content script there. What reads a model inside the page (`src/model-content.ts`, `src/model/`, `src/bridge.ts`) is loaded with the page. The build marks that reader with a hash of its code (`scripts/reader-mark.mjs`: its bundle, with the version and the mark as placeholders), which the first line of each bundle names, so a new version that leaves the reader's code as it was keeps its mark. The content script reads a model only with a reader of its own mark: the results page puts the new one into the tab where Chrome lets it (`renewReader` in `src/results/connection.ts`), and otherwise offers the refresh. `dist/` is not in Git: build after every pull.

In the Anaplan tab, `src/content.ts` and `src/analyse.ts` read an app, and `src/model-content.ts` and `src/model/` read a model through the page's own client. `src/model-pages.ts` then reads the pages built on the model, as an app's pages are read. `src/card-reader/` reads a page's cards. `src/background.ts` opens the results page: `results.html`, `results.css` and `src/results/`. `src/map/` builds a model's map from the model's tables and draws it on the page, styled by `map.css`. `src/protocol.ts` lists the messages between the page and the tab, and `src/results/connection.ts` connects the two, putting the content script back into a tab that has none, and the model's reader into one whose reader is of another build.

### Release

Every merged change that alters the extension takes the next version, as the top of [CHANGELOG.md](CHANGELOG.md) says: the next minor version for a new feature, the next patch for a fix or a speed-up. Set it in `manifest.json`, `package.json` and `package-lock.json` (two fields), and give it a section in CHANGELOG.md whose changes end with their pull request's number. A version reaches the install steps above only once it is published:

1. Run `npm run check`.
2. Run `npm run package`. It writes `release/cardigan-<version>.zip` and prints its SHA-256.
3. Publish the zip with its SHA-256.

The zip holds the twelve files Chrome loads: `manifest.json`, four bundles, four icons, `results.html`, `results.css` and `map.css`. The same files always give the same bytes. The packager refuses a version that differs between `manifest.json` and `package.json`, a missing or stale bundle, a results page that loads a file outside the zip, and a manifest that asks for any permission but activeTab and scripting, or has no content security policy that keeps everything inside the package.

## Licence

[MIT](LICENSE).
