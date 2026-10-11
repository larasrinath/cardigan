# Changelog

Every merged change that alters the extension has a version of its own: a new feature raises the middle number (0.14.0), and a fix or a speed-up the last one (0.13.1). A change to the docs alone keeps the version. The version is in the menu of Cardigan's icon in Chrome's toolbar and on its About page, and in the first line of the diagnostic log, so a build can be matched to its section here; each change ends with the number of the pull request that made it.

## Unreleased

- **Switching tabs closes the details.** Choosing another table, the Overview or the Model map in navigation clears the open row without moving the new table. Coming back or refreshing keeps the panel closed; links within details, the **Table** and **Model map** buttons, and **Run again** still keep or open their row.
- **Details float over the table.** A row's details slide over its right edge, below the header, with no dimming or empty gap. The table keeps its full width, position and scroll, and the open row stays highlighted. Other rows and the header remain usable; **Back**, **Esc** and the close button work as before.
- **A width that stays.** Drag the panel's left edge, or focus it and use the Left and Right arrow keys, to resize from 360 pixels to 70% of the window. The viewer's width is kept for next time. Below 900 pixels the panel fills the width. Refresh and **Run again** still reopen the same row where it exists.

## 0.29.6 (11 October 2026)

- **More room for the map.** One slim bottom bar holds the counts, Legend, About this map, zoom and Fit at every level and in full screen. Long counts end with an ellipsis and show their full text on hover. Legend, About and the minimap open above the bar without moving the boxes or camera. The minimap starts hidden and opens from its drawn button. (#86)

## 0.29.5 (11 October 2026)

- **A small difference keeps the export.** One module's live line items check the names read from the model's settings. If at least 98% of the IDs present in either source have the same name in both, the export keeps naming the other modules. A rename, an addition or a deletion counts as one difference. Below that threshold, the modules the pages use are read from the listing as before. (#85)
- **The difference, said.** The diagnostic log says whether the export was kept, lists up to five differing line items and counts the rest. It shows IDs, items only in one source, and both names where they differ, quoted so spaces and quotes show. Any module read live uses its listing in full, including names and formats changed or removed since the export. (#85)
- **Filters use the names already read.** A filter line item in the export needs no module search. An ID absent from it is still searched for, including in modules the export covered; the existing time limit and Missing rules stay in place. Line Items, Page Filters and Module Usage keep their layout and counts. (#85)

## 0.29.4 (11 October 2026)

- **Classic first for every model.** Polaris models use Model Building's Classic client when it answers, as it usually does, keeping the full settings read, import mappings and process steps. Cardigan waits up to about two minutes; without an answering frame it falls back to a partial read, even when the engine is unknown, and the Overview says why. (#84)
- **The engine check, safely.** Diagnostics lists the field names returned for the model and selected workspace, never their values. The check tries six candidate fields. Polaris-only Line Items columns log **Engine: Polaris, read through the Classic client**, without changing the tables or the map. (#84)

## 0.29.3 (11 October 2026)

- **The whole pill opens its list.** Click the group or module name or chevron in the Model map's path to choose from its list; the module search takes focus, and the keyboard opens and moves through both lists without moving the map. (#83)

## 0.29.2 (11 October 2026)

The pictures and the docs now follow model analysis through the current results page.

- **Eight new pictures.** An invented model shows the Overview, Line Items, import mappings, process actions, map groups and links, page filter arrows and access driver keys, map details and the module picker. The old app pictures are gone. (#82)
- **The words brought up to date.** The README covers the engine check, partial Polaris reads, kept place, details and the map's current controls. The privacy notice lists every Anaplan request, including the platform gateway and Polaris metadata routes. About Cardigan, the manifest description and How to read use the same words. No behaviour changes. (#82)

## 0.29.1 (11 October 2026)

- **One outside module, one box.** Formula, access driver and page filter links share one outside module box on the Model map. With other modules' line items shown, the boxes and hover cards say Module or Line item. Link switches keep every box and the camera in place. (#81)

## 0.29.0 (11 October 2026)

Access drivers can be found at a glance on the Model map.

- **A key beside the funnel.** With **Access drivers** ticked under **Links**, a teal key marks each Read or Write Access Driver. A module's key counts its driver line items; a group's counts its modules that hold drivers. A line item that drives both counts once. A box can carry both a key and a page filter's funnel, clear of its name. At small zooms they become separate dots on the top edge. The legend explains the key at each level. (#80)
- **What it controls.** A driver's hover card counts the line items and modules it controls, separately for read and write. Its details say Read, Write or both, and **Controls** links to each target with its access role. A controlled line item's **Access driven by** links back to its drivers. These lists stay readable with the arrows off. (#80)
- **The same places.** Ticking Access drivers adds marks and arrows without moving any box or the camera, including boxes dragged by hand. With no access drivers to show, the switch is off and its note says why; a result without driver columns, as on Polaris, says they were not read. (#80)

## 0.28.0 (11 October 2026)

Polaris reads the settings the live probe found, with its limits kept visible.

- **Modules and line items.** Modules keep Applies To, Time, Versions and Notes, with dimensions from the socket. Each module's line items are read by one GET, four at a time: Format, Formula, dimensions, summary, Time, Versions and Notes stay as read. Only certain format labels give a Format type. Functional Area stays empty. (#79)
- **Lists and actions.** Lists name their parent and their display property where an ID has a name. The probe did not establish list properties or per-list subset membership, so Properties and Subset Count stay blank. Imports, exports and processes reuse the listings read for page buttons; details say mappings and steps are not read yet. Versions lists names. (#79)
- **A Polaris map.** Once formulas were read, the map matches their names to returned line items and lists. Unknown and ambiguous references stay unresolved; numeric literals stay numbers. The tables keep their original strings. Classic's map and settings reads stay as before. (#79)
- **Partial, said.** The Overview names what was read and what is still missing, with only populated tables in its tiles and tabs. A source that fails is logged and skipped on its own. Possible paging is logged and noted without guessing missing rows; completeness remains unknown. The log counts line-item requests and records their time. Closing the results page stops queued requests. (#79)

## 0.27.0 (11 October 2026)

The Model map's details lead into the box, back to its table, and into Model Building.

- **One row of buttons.** The box's name comes first, with its kind under it. A module offers **Show its N line items**, a group **Show its N modules**. **Table** opens the matching row in Line Items, Modules or General Lists with its details open. **Model** opens the module or list in Model Building, using the same opening as the tables and the IDs the run already read; a line item opens its module. A button with nowhere to go is left out. (#78)
- **The trace in one place.** Its counts and **Only these** sit under the buttons in the details. The separate trace card is gone. Closing the details clears the selection. Opening and closing them leaves every box and the camera in place. Raw format and summary values sit last under **As read**, folded at first. (#78)
- **Back to the same box.** A row's **Model map** button keeps the table's details for the return. **Table** brings the row into view, with its details open; **Model map** selects that box again. The table keeps its sort and column choices, and its search and filters where they include the row. (#78)

## 0.26.0 (11 October 2026)

Coming back to Cardigan keeps the place you were reading.

- **The icon reuses the result.** Click it on the same Anaplan tab to bring its results tab and window forward and run again there. The table or map and the open row stay, where they still exist. A run already in progress comes forward and carries on. With no answering results page after about 300 milliseconds, a new tab opens. No new permission. (#77)
- **A folded log.** Diagnostics starts closed during a run and on the Overview. A failed run opens it; Copy diagnostic log still works. (#77)
- **Maintenance, named.** Anaplan's HTTP 503 or a page title or heading announcing maintenance shows **Anaplan is down for maintenance**, with **Run again**. Ordinary errors keep their own messages. The diagnostic log names the maintenance case. (#77)
- **Fewer remarks.** The Overview keeps **Forget this result** without the sentence about the kept copy. An import's Mapping keeps its own notes; How to read explains saved headers and why columns after the last mapped one are not known. (#77)

## 0.25.1 (11 October 2026)

The Model map keeps its places when links change, and keeps the box you were reading.

- **Links change without a jump.** Ticking or unticking Formulas, Access drivers or Page filters keeps the camera and every box where they were, including a box dragged by hand. Formula links alone place the boxes at every level. A box brought in only by an unticked kind stays in place, dimmed; the other links are drawn over that layout. A taller legend lies over the map. (#76)
- **The bar and foot stay put.** The Links button keeps the room for its dot. The line at the foot always shows, and Legend and About this map keep their places. The trace's name, counts and buttons stand with the selected box's details. (#76)
- **Names in full.** The model, group and module in the path take the room their names need. The path takes its own line before its steps or names wrap. The traced name wraps too, and stays visible on a narrow map. (#76)
- **The selected box is kept.** A refresh or Run again reopens its details where the box still exists, found by its name and its module or parent. Changed formulas, counts and object numbers do not lose it. A missing or ambiguous name leaves the selection clear. (#76)

## 0.25.0 (11 October 2026)

One details panel, in the same order wherever a row opens.

- **Read beside the table.** The details leave the table usable, with no scrim. Click another row to read it there. A link inside the panel shows **Back** to return to the previous row. The header stays whole above the panel, with Timezone, Run again and the theme button together. (#75)
- **The same order.** The row's name and table, the buttons for opening it elsewhere, then Mapping, Actions, or Sources and Imports. **All columns** follows in the table's order, hidden columns after. A section's column is not repeated, so a process lists its actions once. Raw values sit last under **As read**, folded at first. (#75)
- **Names open their rows.** A single item links as several do. Module Name, Target Object, DCA's line items, a page filter's condition line item and modules, a page action's model action and a data source's Source Model link where one row matches. Missing and unmatched names stay plain. DCA and Page Filters offer **Model map** where the box exists. (#75)
- **Keyboard and kept place.** The panel is a labelled region. Opening it moves focus inside; **Esc** closes it and returns focus to the opening row. The open row still comes back after refresh or Run again where it exists. (#75)

## 0.24.0 (11 October 2026)

The Model map has one path, and calls each group a group.

- **One path at every level.** The model, group and module stay in the bar; the Modules and Line items switch is gone. A name goes there and its chevron opens its list. The group list has All groups, All modules, then every group with its module count. A choice always moves the map. Esc goes from a module to its own group, then to the model. (#74)
- **Every module in one picker.** Modules stand under their group headings, in the map's order, with the current module marked and its group scrolled into view. Typing searches every group, leaving the headings that have matches. The 200-module limit is gone; moving through the list with the arrows updates only the rows whose focus changes. (#74)
- **Group by stays.** It is there at every level. Changing it inside a module keeps the module, its selection and its drawing; the group step and the picker's headings follow the new grouping. Other modules' line items is now under Links, where it appears only inside a module. (#74)
- **The words agree.** Group replaces section in the legend, details, search, foot and empty map. The details say Show its modules or Show its line items, with the count. The hover card leaves the double-click shortcut to About this map, and the details' list headings have drawn chevrons. (#74)
- **Kept as before.** Search across the model, Model map from the tables, the traces and page filters, the three kinds of link, full screen and the map's other tools. Views kept for the tab by earlier versions still load. (#74)

## 0.23.1 (11 October 2026)

Run again keeps the place you were reading.

- **The same table and details.** Run again on the same app or model keeps the table shown and reopens the row's details where that row still exists. A row is found by its name and module, or its list or parent, so an edited formula, format, count or note does not lose it. A missing or ambiguous row stays closed. The details panel has its own **Run again** button. (#73)
- **Reading without a jump.** The run button keeps its width, with a small drawn spinner and **Reading**. Its title and the screen reader's live region say the progress. No progress banner pushes the result down; a failure still shows the existing card. (#73)
- **The map stays up.** The Model map remains on screen during a run and is rebuilt on the same view, group or module when the result arrives. Zoom and selection may reset. (#73)
- **Each table's search.** Switching tables and coming back restores that table's search and page. A refresh keeps every search for the life of the tab, along with the other view settings. Settings kept by earlier versions still load. A first run from the icon still opens on the Overview. (#73)

## 0.23.0 (10 October 2026)

Cardigan checks the model's engine first, and reads what it can from Polaris.

- **Polaris, partly read.** Modules and their available dimensions, General Lists, and the published pages' Module Usage, Page Filters and Page Actions. The Overview says why Line Items, Actions and the Model map are absent; only tables with data get tiles and tabs. About this export keeps Workspace, Workspace ID, Model, Model ID and Apps. (#72)
- **The engine first.** Read-only platform requests check the model's engine, then the workspace's. A Classic frame answering is the next fallback, and an unknown engine uses the Classic reader. The raw engine values and the chosen path are in the diagnostic log, including the copy kept with a result. (#72)
- **A model still opening.** Cardigan waits for about two minutes, saying Waiting for the model to open, and reads as soon as the Classic frame answers. A missing reader gets one attempt to put it into the open tab; where that cannot work, Refresh the Anaplan tab and run is offered. (#72)
- **A smaller failure card.** A short title, the reason, a main button to recover and a small Copy diagnostic log button. The log's last line tells a model still opening from a missing or old reader and a tab with no model open. (#72)

## 0.22.0 (10 October 2026)

A model's tables follow a reading order, with fewer columns shown at first.

- **The columns in reading order.** Each model table starts with what its rows are, then what they use or do. Anaplan's names stay as they are, including the names that differ between models. A column the model lacks is skipped; a new column follows the named ones and starts shown. (#71)
- **Hidden columns can be added back.** Line Items starts with its name and module, format, formula, dimensions, summary, references, counts and notes. Its other known columns start hidden, as do a list's references, a module's line items and references, and an action's dashboards. Every hidden column stays in the chooser and the row's details. **Defaults** restores the layout, and column choices kept for the tab still apply by name. (#71)
- **Rows keep their place.** Anaplan's order and headings stay. Module Usage follows Modules, then app and page. Page Filters follows the condition line item's module and name, then app, page and card; Page Actions follows the model action's name, then app and page. These orders start with no sort mark and no **Reset**. (#71)
- **Less repeated text.** Model Calendar, Line Items, DCA, Imports and Source Models leave their explanations to **How to read**. Missing notes and warning counts remain under the tables. (#71)

## 0.21.0 (10 October 2026)

Page filters run from a filter's line item to the line items it filters, and Page Filters says which those are.

- **Filtered line items.** **Page Filters**, and an app's **Filters** table, have a column after **Filtered dimension** that says which line items the filter's grid shows: **All line items**, **Only** or **All except** with the line items' names in full, a name that holds a comma in single quotes, or the Line Items selector's words, or that Line Items is on no axis and no selector. Where a filter is shared by sections of a combined grid that show different line items, each section says its own after its module, and the row's details list them one to a line. Nothing new is read from Anaplan: the page's cards always said it. (#70)
- **Arrows among a module's line items.** With **Page filters** ticked, the **Line items** view draws a plum dashed arrow from each filter line item to each line item it filters. A module's own filter, such as Incomplete Records filtering its module's rows, is arrows inside the module; the filter line item that its grid shows too keeps the funnel, and so does one whose grid does not say which line items it shows. A filter on another module's grid points at that module's box, and the filtered module shows the filter's module pointing at each line item it filters. (#70)
- **Modules and groups as before.** Between modules a filter is one arrow for each filter line item and each other module whose grid it filters, however many line items, and a module its own line items filter keeps its funnel with the count, as a group keeps its count of such modules. (#70)
- **Where the boxes stand.** The line items that formulas link keep their places when page filters are drawn: the filters' arrows are drawn over them, and close no circle of formulas. A line item that only filters link stands next to the line item that filters it, not at the end beyond other modules' boxes. (#70)
- **What a filter does, said.** While page filters are drawn, a line item's hover card says where it filters ("Page filter on Data Hub · Admin · Card 1 · by Customers") and what filters it ("Filtered on pages by Incomplete Records"). Its details list **Line items it filters on pages** and **Filtered on pages by**, and each filter's line says how many line items it filters. The note under **Page filters**, the legend and the run's log say what each kind of picture shows, and the log counts the filters that say which line items they filter. (#70)
- **A result read before.** A result an earlier version kept has no **Filtered line items**: the map draws its filters to the modules they filter, as before, and the note under **Page filters** says to run the model again. (#70)

## 0.20.2 (10 October 2026)

Equal gaps between the navigation's tabs, and still nothing moves.

- **Equal gaps.** Where the tabs fit on one line, the gaps between them are now all the same. Before, **Time**, **Modules** and **Actions** each kept the room of the longest name they can show, such as Model Calendar, even while they showed their own shorter name, so the gaps around them were up to twice the others'. Each tab now takes the room of what it shows when it is not the view shown, and the bar shares out the rest as the gaps. (#69)
- **Nothing else moves.** The tab of the view shown, in bold, and a menu's button naming the table shown in it, such as **Model Calendar** in place of **Time**, grow from their middle into the gaps beside them, and no other tab moves, by as much as a pixel. Where the bar is too narrow for a name to grow so, its menu keeps the extra room it needs beside its own name, so the gaps around it are wider there: a model's bar with every table has all its gaps equal in a window about 1,480 pixels wide or wider, and fits on one line from about 1,280. A menu opens under its button, wherever the button stands. (#69)
- **What stays the same.** The tabs, their names and their order; the menus and their entries; and the one menu that stands in the bar's place in a window narrower than 1,000 pixels. (#69)

## 0.20.1 (10 October 2026)

What a page built on a model points at that the model doesn't have now reads plainly.

- **Missing, with the ID.** In **Module Usage**, **Page Filters** and **Page Actions**, a module, a line item, or an import, export or process that a card points at and the model doesn't have says so: **Missing module (ID 102000000556)**, **Missing line item (ID 1916000000014)**, **Missing process (ID 118000000003)**. Before, such a module read "102000000556 (not in the model)", a filter's line item was a bare ID beside a dash, and a button's action was a dash. Searching for the ID finds the row, and the hidden ID columns hold the ID too. (#67)
- **A missing filter line item.** Where a filter rule has one item that no read names, and the line items of every module were read, that item is the rule's line item and the model doesn't have it: the filter says **Missing line item**, with its ID now also in the hidden **Line item ID**, and the rest of the rule stays in **Condition context**. Its module reads **Missing line item: module not known**, since nothing says which module it was in. Such a filter is the condition of none of the model's line items, so where every page was read, the **Page Filters** column of **Line Items** counts 0 rather than leaving its cells empty. (#67)
- **A line under each table.** Where a table names something Missing, the line under its name says how many filters, buttons or pages point at such things, at what, why, and what to do: "1 filter points at a module and a line item this model doesn't have: deleted since the page was built, or hidden from you. Open its page to fix the card." The Overview's notes say how many cards on the pages built on the model point at things it doesn't have, and **How to read these tables** has a row on **Missing**. (#67)
- **The row's details.** What a row names Missing has no **Model** button, and the line under the details' header says the model doesn't have it; **App** and **Page** still open the page, to fix the card. (#67)
- **What stays the same.** What is read from Anaplan; an app's tables, which still say "(not in the model)"; and the map, where a missing module is no box and a filter on one marks nothing. Only what the model's names prove is said Missing: a dimension or a list that no read names keeps its ID, as does a filter rule with two items that no read names. A result an earlier version kept keeps its words until it is run again. (#67)

## 0.20.0 (10 October 2026)

Taller Overview tiles with large numbers, a Formulas box on the map, and a dash for a module on no page.

- **Taller tiles, larger numbers.** Each tile of the Overview is taller, with the table's icon and name at its top left and the number of rows at its bottom right, in large figures of one width. A count of five figures or more is drawn smaller in a narrow tile, so that it is never cut. A model's **Model Calendar** tile has **Weekly** or **Monthly** at its right in the number's place, with the grouping and the year under it, small. Every tile is still the same size and a button that opens its table, and a name still keeps to one line. (#66)
- **Formulas is a box on the map.** The map's **Links** panel has a box for **Formulas**, ticked as the map opens, as **Access drivers** and **Page filters** have: "An arrow from A to B: B reads A. Untick to see only access drivers and page filters." Unticked, the formulas' arrows are not drawn and every box stays where it was: the map is not laid out again. A trace, the boxes a selection lights up and the boxes the map brings into view beside a box gone to follow only the arrows drawn, and the line at the foot counts only those. With none of the three ticked, the line at the foot and the legend say that no links are drawn. (#66)
- **The legend and the Links button.** The legend says what each kind of link drawn means, and only those: an access driver's arrow has a line of its own. The **Links** button has its dot whenever the links drawn are not formulas' alone, and what you tick is kept for the tab with the rest of the map's place. (#66)
- **A dash for a module on no page.** In **Module Usage**, a module that no page uses has a dash, greyed, for its page, as for its app, in place of the words Not on any page. A filter lists the dash as a value, and the search finds the module by its name. The note on pages that could not be read, and the Overview's words on how to read Module Usage, say the dash too. The map's **App** grouping still names that group Not on any page. A result an earlier version kept says Not on any page until it is run again. (#66)
- **What stays the same.** What is read from Anaplan, the rows of the tables, the map's layout, and a box's details, which list all that feeds it and all it feeds whichever links are drawn. (#66)

## 0.19.1 (10 October 2026)

About this export says what was read, and nothing more.

- **A model's About this export.** On the Overview it says, in this order, **Workspace**, **Workspace ID**, **Model**, **Model ID** and **Apps**: the workspace's name and its ID, then the model's name and its ID, then the apps whose pages use the model. The model's name and its apps still open them in Anaplan. (#65)
- **An app's About this export.** It says **App**, **App ID** and **Models**, the models the app's pages are built on. An app's result names no workspace of its own, so its About has none. (#65)
- **What is no longer said there.** The Anaplan host, **Exported on**, **Exported with**, the Model Calendar's **Captured on**, and an app's **Categories**, **Pages**, **Pages analysed** and **Cards**. Cardigan still reads them and keeps them with the result. The first line of the diagnostic log says the version and the Anaplan host, and the menu of Cardigan's icon says the version; for an app, the Overview's notes still count the pages analysed and the cards, and the Pages tile counts the pages. (#65)
- **Model Calendar's line.** The line under the table's name says that the template's rows about the model are not listed, and that the Overview names the workspace and the model, under **About this export**. (#65)
- **What stays the same.** What is read, the tables, the map, the times in the tables and the Timezone pill. (#65)

## 0.19.0 (10 October 2026)

A cleaner header, one Timezone pill, and the version and an About page in the menu of Cardigan's icon.

- **The header says the name alone.** It says the name of the app or model the result is of, cut with an ellipsis where it is too long and whole in its title, and nothing more: the version pill and the line under the name (the kind, the Anaplan host and when it was exported) are gone. Where it was read and when are under **About this export** on the Overview, as before. (#64)
- **One Timezone pill.** The two buttons **Times: Local · UTC** are one pill, **Timezone**, with a drawn globe: it says the zone the times are in, and a click switches to the other. It stands first on the right, before **Run again** and the theme's button, keeps room for the longer of the two words so that a click moves nothing, and says what a click does to a screen reader. The choice is kept as before, Local unless you chose UTC. (#64)
- **The version in the icon's menu.** Right-click Cardigan's icon in Chrome's toolbar: under **About Cardigan**, the menu says the version, greyed out. The icon's title says it too. (#64)
- **About Cardigan.** The same menu's **About Cardigan** opens a page of the extension's own in a new tab: the logo, the version, what Cardigan is, that it only reads, and links to what's new, privacy, help and the source on GitHub. It follows the theme you chose on the results page. (#64)
- **A third permission, with no warning.** The menu's items take **contextMenus**. Cardigan now asks for activeTab, contextMenus and scripting, and the packager holds the manifest to those three. The zip holds two more files, `about.html` and `dist/about.js`, and the packager checks the About page as it does the results page. (#64)
- **Links under About this export.** On the Overview, the model's name opens the model in Model Building in the model's tab, and each app under **Apps** opens that app in the tab of apps and pages, as the details' **Model** and **App** buttons do, with their icons after the names. Where the model's tab shows the model in Model Building already, it is only brought to the front, with what is open there: Cardigan asks its script in the tab what the tab shows now. Anywhere else the model's address is loaded, the one Model Building's own model menu links to. An app is a link only where the rows of Module Usage, Page Filters and Page Actions give it one ID; an app of no row, or a name two apps share, stays plain, and so does every name where the result does not say where the model is. (#64)
- **What stays the same.** What is read, the tables, the map and what the times say. (#64)

## 0.18.11 (10 October 2026)

The Processes table says what each process runs.

- **The actions after the name.** Each process's row lists the actions it runs right after its name, in the order it runs them, as its details number them; where the result does not have that order, the actions whose **Used in Processes** names the process. A process that runs none has the cell empty. (#62)
- **A filter by each action.** The **Actions** column always offers a filter, which lists each action once with how many processes run it: a process shows while any of its actions is ticked. (#62)
- **One to a line in the details.** A process's details list its actions under **All columns** one to a line, each opening its own row in Imports, Exports or Other Actions where exactly one row there has its name. (#62)
- **Two columns fewer.** **Used in Processes**, since Anaplan runs no process inside another, and **Action**, which a process leaves empty: an **Action** that a process does have stays. Imports, Exports and Other Actions keep both. A column choice kept for the tab of a column that is gone is dropped. (#62)
- **What stays the same.** The numbered **Actions** section of a process's details, what is read from Anaplan, and the other tables. (#62)

## 0.18.10 (10 October 2026)

A table's name and its toolbar share one row, and the toolbar is quieter.

- **One row.** Every table, an app's and a model's, has its name and then its toolbar on one line: the search box, **Reset** when something is in force, and at the right end the count of rows and the pager. The line under a table's name, where it has one, now stands under that row. In a window too narrow for one row, the name takes a line of its own first; the count and the pager go under the search box only after that, and always together: the count, the page buttons and the rows per page are never parted, as they could be before. Under 560 pixels the pager may go under the count, so the page never scrolls sideways. A table with the switch of ways or a page's chip keeps them at the toolbar's head. (#61)
- **The column chooser is in the search box.** The **Columns** button is gone: a button with three lines at the search box's right end, set off by a thin line, opens the same chooser. Its tooltip and its name for screen readers say **Show or hide columns**. (#61)
- **No key drawn in the search boxes.** The search boxes of the tables and of the model map no longer show a `/` key. The key still reaches them, and their tooltips and `aria-keyshortcuts` say so. (#61)

## 0.18.9 (10 October 2026)

Three small mends: a module's code on the model map, what Forget this result forgets, and two tests that a busy machine could fail.

- **A module's code, told from its name whatever stands between.** The map sets a module's code apart from the rest of its name. It took off a dash between spaces (" - ") or a space alone, so a name such as "CLM101 : - Stat Combos: Without Order History" showed ": - Stat Combos: Without Order History". Now any mix of spaces, colons and dashes between the code and the rest is taken off: "CLM101 : - Stat Combos", "FIN03: Cash", "X_1 — Y". A colon with no dash takes only a word of capitals and digits for a code, so "Note: Revenue Plan" stays whole, and a mark written against the rest stays with it ("SYS01 -Time"). (#63)
- **Forget this result forgets where the map was.** Forgetting removed what the tab kept, but the page went on holding where the map had been left: the map built afresh after it took that place back and wrote it to the tab again. It now opens where it opens by itself, and nothing comes back. (#63)
- **Tests that hold on a busy machine.** The page tests now tell a page it goes, as a browser does when a refresh replaces it, so what a page was about to write lands in its own test and never in the next one's storage. The check that a table of 200,000 rows has its column widths worked out quickly counts the cells read and takes the process's own time, not the clock. (#63)

## 0.18.8 (10 October 2026)

Two of a model's tables have shorter names on the page.

- **Data Sources.** Anaplan's Import Data Sources is called **Data Sources**: in the navigation and the Actions menu, on its tile, as its table's heading, in a row's details, in the Overview's rows about it, and in a source model's details, whose lines say what was found in Data Sources, as does the log's note on a source model found in neither table. (#60)
- **DCA.** Dynamic Cell Access is called **DCA**, in the same places and in the Modules menu. Its tab, its group's button and its tile say "Dynamic Cell Access (DCA)" when hovered and to a screen reader, and a screen reader hears the full name when the table is shown. (#60)
- **The navigation is narrower.** The model bar needs about 99px less: about 1,184px instead of 1,283px, so it fits on one line from a window about 1,314px wide instead of 1,413px. (#60)
- **What stays the same.** What is read, and the tables themselves. The export's own log and status lines keep Anaplan's names. A result kept from an earlier version shows the new names as well, since the page names these two tables by their files.

## 0.18.7 (10 October 2026)

The Overview's Model Calendar tile says what the calendar is, not how many of its settings hold a value.

- **Monthly or Weekly.** In the number's place, a months calendar says **Monthly** and any of Anaplan's three weeks calendars **Weekly**. A calendar type stored as its ID reads the same, and a type of another text is said by what it names. (#59)
- **The current year under it.** A smaller line says the current fiscal year by its label, such as **FY24**, after how a weeks calendar is grouped: 4-4-5, 4-5-4 or 5-4-4, 13 periods, or its number of weeks. The tile's title, and its name for a screen reader, hold the calendar type as Anaplan writes it and the year's dates. (#59)
- **Every tile still the same size.** The row of tiles is as high as its highest, and what each tile holds now stands at its top, so the names stay on one line across a row. (#59)
- **What stays the same.** What is read, and the Model Calendar table, whose line under its name still says how many rows it leaves out. A calendar whose type and year were not read is counted like any other table. (#59)

## 0.18.6 (10 October 2026)

A source model's details list what it gives the model.

- **Sources.** A row of **Source Models** now opens with what that source model gives, above **All columns**: each of its objects that the model's imports read, with its kind (**Saved view**, **Module** or **List**), from the rows of **Import Data Sources** that name it. Each opens its own row of Import Data Sources. (#58)
- **Imports.** Under them, each import that reads from the source model, with the objects it reads; each opens its own row of **Imports** where exactly one row has its name. Where Import Data Sources names none of the source model's objects, the imports are found by the Imports table's **Source Object**. (#58)
- **Found by name, nothing guessed.** A source model is found by its name as each table writes it, out of its quotes and with its spaces evened out, or by the model's own name, the part after its workspace, where one table writes the workspace in front and the other does not, and no other source model has that name. A count that is not what the row's **Sources** or **Imports** says is said under its list. A source model neither table names gets no list, and the diagnostic log says so once. (#58)
- **What stays the same.** What is read, the Source Models table and its columns, and **All columns**. (#58)

## 0.18.5 (10 October 2026)

The model map shows the filters a module's own line items put on it, and its **Page filters** box says truly what it draws.

- **Marks for a module's own filters.** Most filters on a model's pages have their condition in the module they filter, such as a module's Incomplete Records filtering that module's rows. No arrow joins a module to itself, so the map drew nothing for them, and a model whose filters were all of that kind had **Page filters** greyed out, with a note that said, wrongly, that none of its filters had a line item of the model as its condition. Ticked, the box now marks each such module: a plum mark on the box's top edge, with a funnel and how many of its own line items filter it. A group's mark says how many of its modules are filtered so, and in the Line items view each line item that filters its own module has the mark, without a number. Zoomed out, where a box is too small for it, the mark is a plum dot at the box's top right. The legend says what it means on the picture shown. A filter on another module keeps its dashed arrow. (#57)
- **A note that tells the truth.** The note under the box says what ticking it draws: arrows, marks or both. Where there is nothing to draw, the box is off and the note says why: the result has no **Page Filters** table; the pages have no filters; none of the filters has a line item of the map as its condition, with how many filters there are; or none of them filters a module of the map. (#57)
- **Names found whatever their spaces.** A filter's line item is found by its module's name and its own. Where Line Items wrote either with a space at its end that **Page Filters** did not have, or the two wrote a run of spaces differently, the line item was not found, and its filter was left off the map and its details; it is found now, where one module or line item alone fits. A filtered module, and a row of **Modules** or **Module Usage**, is found despite a run of spaces written differently too; spaces at the ends were already allowed for there. The map's line items have no ID in the result, so their names are what a filter is matched by. (#57)
- **One line in the log.** When the map is first built, the diagnostic log says how the Page Filters table met the map, such as "Page filters: 32 rows; 32 with the condition line item on the map (30 on its own module, 2 on another module); 0 with a line item the map does not have.", and names the first five line items it could not find, each once. (#57)
- **What stays the same.** A module's details list its own line items under **Filtered on pages by**, as they did. A mark is followed by no trace, a filter's arrow only while it is drawn, and neither changes a module's role in the data flow. The tick is kept for the tab, as it was. (#57)

## 0.18.4 (10 October 2026)

The Overview says no more than it needs to of how a model's imports were matched.

- **Nothing where every import was matched.** The export checks that each import in Anaplan's Imports tab is the same import as a row of its Actions list, which gives the import its last run, its notes and the processes that use it. Where every one was, the Overview showed "Imports: 372 rows (372 matched in the Actions list)" under **Tables**, which says no more than the tile's count. It is no longer shown, and with nothing else to list, neither is **Tables**. (#56)
- **A note where some were not.** Where some could not be matched, a note says how many and what that means: "Imports: 2 of the 372 rows could not be matched between the Imports tab and the Actions list, so some of their columns are empty." It stands with the Overview's other notes, and the row is not said under **Tables** as well. (#56)
- **What stays the same.** What is read, the Imports table, and the diagnostic log. A table that was not exported, and a count with another remark, such as imports read from the Imports tab alone when the Actions list could not be read, are still listed under **Tables**. (#56)

## 0.18.3 (10 October 2026)

A row's buttons stand in one row under its name.

- **One row under the name.** The buttons that open a row elsewhere, **Model map**, **Model**, **App**, **Page** and the others a table has, stood one under another at the top right of the row's details. They now stand side by side on a line of their own under the row's name and the line under it, across the details' width, in the same order, each with its icon and its words. (#55)
- **The close button stays alone at the top right.** It comes before the buttons for the keyboard as it does on screen. (#55)
- **They fit.** The buttons are drawn a little smaller than the page's other buttons, so the most a row has, a page filter's five (**Condition module**, **Filtered module**, **Filtered list**, **App** and **Page**), fit on one row in the details' usual width. Only a narrower window wraps them onto a second row. (#55)
- **What stays the same.** What each button opens, its title and its icon; the line that says why a button is missing, still under the header; and everything below it. (#55)

## 0.18.2 (10 October 2026)

The navigation bar names every table in full again, and its tabs spread out evenly.

- **Full names again.** The shorter names of 0.18.1 are gone: **Model Calendar**, **Dynamic Cell Access** and **Import Data Sources** show in full on the bar, as a tab of their own and as a menu's tab that names the table shown. Each menu's tab keeps the width of its longest name, so choosing a table or a view still moves nothing. (#54)
- **Tabs spread evenly.** Where the tabs fit on one line, the bar shares the room it has beyond them evenly between them, so they reach from one side of the page's column to the other instead of gathering at its left. Each tab keeps its own width, its highlight included. The page measures the tabs' widths when it draws the bar, and the stylesheet does the rest at any window width, so nothing moves as the view changes. A model's bar with every table fits on one line in a window about 1,410 pixels wide or wider, with gaps of about 4 pixels at 1,440 and 13 at 1,840; an app's bar spreads wider. Where the tabs don't fit, they wrap onto a second line, packed at its left, as before. (#54)

## 0.18.1 (10 October 2026)

Three long names are shorter on the navigation bar, so a model's bar fits a narrower window.

- **Shorter names on the bar.** **Model Calendar** shows as **Calendar**, **Dynamic Cell Access** as **Cell Access** and **Import Data Sources** as **Data Sources**, as a tab of their own and as a menu's tab that names the table shown. Hovering over one shows its full name, which is also what a screen reader says. The menus, the one menu of a window under 1,000 pixels wide, the tables' headings, the Overview's tiles and the search keep the full names. (#53)
- **A model's bar on one line from a window about 1,300 pixels wide.** Each menu's tab keeps the width of its longest name as the bar shows it, so a model's bar with every table needs about 1,170 pixels where it needed about 1,285, and stands on one line in a window about 1,300 pixels wide, scrollbar and all, where it needed about 1,410. Nothing in the bar moves as a table or a view is chosen. (#53)

## 0.18.0 (10 October 2026)

The model map draws the pages' filters too, as it draws access drivers: from each filter line item to the module it filters.

- **Page filters in the Links panel.** Beside **Access drivers**, a box **Page filters**: "Boolean line items used as filters on the pages built on the model. Tick to draw an arrow from each filter line item to the module it filters." It is off until ticked, and the tab keeps the tick with the map's other settings. Where the result has no **Page Filters** table, or none of its filters has a line item of the model as its condition, the box cannot be ticked, and its note says which. (#51)
- **One arrow for each line item and module.** A filter's line item, its **Condition line item**, has an arrow to each module of the map its **Filtered module** names, a filter of more than one module's sections to each of them, once however many cards it filters there. A filter of the line item's own module draws none. In the groups and among all modules the arrows run between their boxes, and among a module's line items each module filtered stands beside them. (#51)
- **Drawn apart.** The arrows are plum dashes that stand still, counted apart from the formula links between the same two boxes, with a line in the legend that says what they are while they are drawn. A trace follows them only while they are drawn; no formula link, no list of what feeds what, and no module's role counts them. (#51)
- **In the details.** A line item's page filters now say what each filters, and by which dimension, beside its app, page and card, and **Modules it filters on pages** lists the modules, each with where. A module's details list **Filtered on pages by**: the line items whose filters filter it. Both are there whether the arrows are drawn or not. (#51)
- **What stays the same.** What is read, the tables, and the map's formula and access links. The Links panel's mark for formulas is drawn, no character. (#51)

## 0.17.2 (10 October 2026)

A row's details list what refers to a module and its line items one to a line, as they did a line item's dimensions.

- **More cells listed.** A module's **Referenced By** and its **Line Items** are listed one item to a line, as a line item's **Applies To** and **Referenced By** already were. A module's line items are its rows of Line Items, in their order, so a name that holds a comma, such as "Rate, net", stays one item; a cell that does not read as those names is shown whole. A data source's imports are listed under the header Anaplan's grid gives them, **Imports**, as under **Used in Imports**. (#52)
- **How many.** A value that lists several items says how many beside the column's name: **Referenced By (10)**. (#52)
- **Show all.** A list of more than fifteen shows its first twelve, then **Show all**, which shows the rest in place and hides them again. The rest stay where the browser's find in page finds them, and a match shows them. (#52)
- **Items that are rows open them.** An item that is a row of the model opens that row's details, where exactly one row has its name: a module or a line item that refers to the row, a module's line item, a list among the dimensions, a process among an action's processes, and an import among a data source's. Any other item stays text. (#52)
- **What stays the same.** A cell that names things without quotes, where Cardigan has no names to check them by, is shown whole: **Used in Dashboards**, **Data Tags** and **Users List**. The tables, their search, sorts and filters read each cell as before. (#52)

## 0.17.1 (10 October 2026)

A menu's tab names the table shown again, and nothing in the bar moves.

- **The table shown, in its menu's tab.** While a table of **Time**, **Lists**, **Modules** or **Actions** is shown, its menu's tab names it, with its icon, as it did before 0.16.4. Each menu's tab keeps the width of the longest name it can show, in bold, with what it shows in the middle, so choosing a table or another view moves nothing in the bar. (#50)
- **A closer bar.** The bar's tabs stand closer: 6 pixels at each side of a tab, where there were 10 (9 at a menu's chevron, where there were 14), 4 between an icon and its words, where there were 6, 1 between tabs, where there were 2, and a chevron of 9 pixels, where it was 10. So a model's bar with every table needs about 1,285 pixels, where it would need 1,412 at the old spacing, and stands on one line in a window 1,440 pixels wide, scrollbar and all. An app's bar needs about 795. The menus' entries, and the one menu of a window under 1,000 pixels wide, keep their spacing. (#50)

## 0.17.0 (10 October 2026)

Times in your own time zone, or in UTC, as a switch in the header says.

- **Local by default.** A model's Processes, Imports, Exports and Other Actions say when each action last started by your clock: the column's header names your time zone in the place of "(UTC)", such as "Start Date and Time (Europe/London)". The header and **About this export** say when the export was made the same way, About in both zones. **Times** in the header, **Local** or **UTC**, switches every time on the page at once; UTC shows them as Anaplan writes them, and the choice is kept for every results page, in the browser's local storage, beside the theme. (#49)
- **A row's details say both.** A time in a row's details stands in the zone shown, then in the other: "2026-03-13 08:19:56 local · 2026-03-12 23:19:56 UTC". (#49)
- **Search, sort and ranges follow.** The search finds a time as it is shown. The sort goes by the moment, also where the clocks went back an hour. A range of days on a column of times is days of the zone it was set in, and keeps the same rows when you switch zones or refresh the page: its filter says whose days they are where they are the other zone's. The tab keeps the range with its zone, and the column by the file's name for it, so the settings kept since 0.16.0 hold in either zone. (#49)
- **What stays the same.** Dates without a time, such as when a page was last published, **Captured on** and a version's Edit From and To, are the same in either zone; the result holds every time as Anaplan wrote it, and the diagnostic log keeps its own times. (#49)

## 0.16.4 (10 October 2026)

The navigation bar stays still.

- **No tab moves.** A menu's button named the table shown in it, so it grew or shrank as a table was chosen, and every tab after it moved, by up to 79 pixels; the tab of the view shown was set in bold, which widened it a little too. A menu's button now always shows its own icon and name, **Time**, **Lists**, **Modules** or **Actions**, and is marked while one of its tables is shown: its menu marks that table, and the table's own heading names it. Every entry and menu keeps the width of its words in bold, so neither choosing a table nor changing the view moves anything in the bar. (#47)
- **What stays the same.** The bar is about as wide as it was: a model's with every table still stands on one line in a window 1,440 pixels wide. The one menu of a window under 1,000 pixels wide is unchanged. (#47)

## 0.16.3 (10 October 2026)

The Overview's tiles say one number each, with their table's icon, and are all the same size.

- **One number on a tile.** A tile shows the number of rows its table lists, and nothing else: the line of how many rows there are in all is gone, and so is the word "rows" under the number, which only a screen reader is told. Where a table leaves rows of its file out, as Model Calendar does with the rows about the model and the settings that have no value, the line under the table's name says how many and why. (#48)
- **The table's icon on its tile.** Each tile shows, before its table's name, the icon the navigation has for that table, for a model's tables and an app's alike. (#48)
- **Every tile the same size.** The tiles stand in columns of one width and rows of one height, whatever their names and numbers. A name too long for its tile ends in an ellipsis, and the tile's title holds it whole. In a narrow window the tiles keep their size and flow into fewer columns. (#48)
- **What stays the same.** A click on a tile opens its table, and what the Overview says about the export is as before. (#48)

## 0.16.2 (10 October 2026)

A page of the model's settings opens inside Model Building, as a module and a list do.

- **Settings pages keep the tabs open in Model Building.** **Model** on a row of Model Calendar, Time Ranges, Versions, Line Item Subsets, Processes, Imports, Exports, Other Actions, Import Data Sources, Page Actions or Source Models opens its page (Time, Versions, Line Item Subsets, Actions or Source Models) inside the Model Building page the Anaplan tab shows, where it loaded the page's address, which loaded Model Building afresh and closed the modules and lists open there. Cardigan's script in the model's frame asks the frame to load the page, as the frame loads it when Model Building's own sidebar opens it; Model Building then makes it its settings tab and puts it in its address. Where the tab shows anything else, or the frame cannot, the page's address is loaded, as before, and the log says which way each went. (#46)

## 0.16.1 (10 October 2026)

The map opens on the functional areas its builders set, however many there are.

- **The builders' groupings first.** The map opens on **Functional area** where three in five of the modules or more have one, in two areas or more, however many areas there are and however many modules each holds; and else on **Headings** where three in five or more stand under a heading row. It used to take either only with 3 to 15 sections, none holding more than half the modules, so a model with 22 functional areas opened on **Role in the data flow**. **Name prefix** keeps that test, and the role in the data flow is still the last resort. (#45)
- **Functional areas in the order of their names.** The legend, the path's lists and the map list the areas in the order of their names, numbers as numbers ("000: Global System", "001: Users", "002: Parameters", "010: Reporting"), whatever their case, as Anaplan lists them, where they came in the order of their first modules. The modules with none are still last. (#45)
- **A module's area found with spaces at either end.** A module is matched to its row of Modules by its name as written, and otherwise by its name without the spaces at its ends, whichever side has them, where no other module has that name. Before, only a row of Modules lost its spaces. The same holds for Module Usage. (#45)
- **The log says how Modules met the map.** When the map's graph is first built, the run's log says how many areas the map's modules have, how many of them have one, which rows of Modules are no module of the map, and which modules of the map have no row in Modules, the first five of each, for example "Functional areas: 22 areas; 340 of the map's 352 modules have one; 0 rows of Modules are no module of the map; 2 modules of the map have no row in Modules: …". A heading row of Modules is in neither list. (#45)
- **What stays the same.** Each module's area is its own row's; each box counts the modules and line items of its own group under the grouping shown; a switch of grouping renews the legend, the path's lists, the search and a module's details. Tests on a model of 22 areas now check each of these. (#45)

## 0.16.0 (10 October 2026)

A refresh of the results page keeps how you left the result, until the tab is closed.

- **Tables as you left them.** Each table keeps its filters, its ranges, the columns you showed or hid, its sort and its page; the page keeps the rows it lists, the search of the table shown and how **Where Used** is listed. A page the table no longer has shows as its last. (#44)
- **The map where you left it.** Its view, the group or the module it showed, other modules' line items and access drivers' links. Its zoom, position, selection and search start afresh. (#44)
- **The details that were open** open again, found by what their row holds; where no row or more than one holds it now, none opens. (#44)
- **Run again** on the same app or model keeps what still fits its tables, each column by its name: a filter on **Format type** stays, a column that is gone is let go, and one that is new starts as it always does. Another app or model starts clean. **Reset** clears a table's, and **Forget this result** all of it. (#44)
- **Where it is kept.** The tab's session storage, beside the kept result, a few thousand characters at most; a tab whose storage is missing, full or refuses works the same and keeps nothing. [NOTICE.md](NOTICE.md) says what is kept. (#44)

## 0.15.9 (10 October 2026)

An import's Mapping shows every source its definition knows of, and says what it cannot know.

- **Headers mapped by hand.** Where an import into a module takes its line items from the header row, each header the modeller mapped to a line item by hand is a row of its own, with that line item, and each header ignored a row that says **Ignored**, after the other columns. Anaplan keeps them in the definition's value map for the line items, which the export now reads. (#43)
- **How the other sources are read.** Under a source, a line says how many of a dimension's items are mapped by hand and how many ignored, the format **Time**'s periods are read by or that they are matched by their names, and a date line item's format, where the import keeps them. A line under the table names the dimensions matched on their items' names or codes when the import runs. (#43)
- **What is not stored, said.** Where nothing is mapped by hand, the header row is matched on the line items' names or codes when the import runs, and Anaplan stores no such match: a line says so, and the header row's row lists the line items of the module a header can match, the first five and **Show all**. (#43)
- **No single column of values with the header row.** An import whose line items come from the header row no longer lists **Value** as not mapped: each line item's values are in the column it heads, and Anaplan's dialog asks for no such column. (#43)
- **The log.** Each import's definition has one more line where it holds them, on how its items are matched: each dimension's items mapped by hand and ignored, the type and length of the first two source values but never their text, and the parts on codes, the items cleared first and **Time**'s format. (#43)

## 0.15.8 (10 October 2026)

A model's run reads its pages and names while it reads its settings, and spares the reads it never used.

- **The pages and the first names beside the settings.** Where the Anaplan tab's address names the customer, the workspace and the model, as Model Building's does, Cardigan reads the list of the pages built on the model, each page and their apps while it reads the Model settings, and connects to the model data socket for the names of the model's modules and lists at the same time. The line items, the rest of the names and the tables wait for the settings. Meanwhile the status line says what the settings are at. A live run of 30 s spent 10.5 s on the settings and then 17.7 s on the pages and the names, one after the other; most of those now take place during the 10.5 s. (#42)
- **No saved view's layout for a model.** A model's run asks for no saved view's rows, columns and context selectors, which only an app's **Cards** and **Grid Sections** tables show. The live run asked for 233 and spent 5.3 s on them. (#42)
- **Saved views asked for as Page Builder asks.** An app's run asks for a saved view with the options Page Builder sends for a grid card's view, as an Anaplan grid's data source, by its ID, in its model, where it sent only the grid's options and every view was refused. It reads the first 6 before the others, and where each of those is refused and none answers, the others are not asked; the log and the note say so. (#42)
- **The model's own host first.** In Model Building, the model data socket starts on the host the model's own page is served from, its data centre, so the first run in a tab is no longer sent there by a redirect; where that host cannot be reached, it starts on the tab's host, as before. (#42)
- **A refusal says why.** Where Anaplan refuses a read, the log gives the status code and the reason the refusal carries, as Page Builder reads them, where it said only that the read was refused. (#42)
- **Timings.** The model's names have a line for any time they waited for the settings, and a last line of the log says how long the settings, the pages and the names took, and the run in all: "Run: export … s, pages … s, names … s, overlapped; in all … s". (#42)
- **What stays the same.** The tables, cell for cell; at most four reads at a time of each kind; read-only reads; a closed results page still stops the run between reads; a run that names no workspace in its address, such as the classic model page opened on its own, reads its pages after the settings, as before. (#42)

## 0.15.7 (10 October 2026)

An import's **Mapping** reads from the source to the target.

- **The source first.** Each row of **Mapping** is a source and the target it feeds, **Source** then **Target**: the file's columns first, by their headers, in the file's order where the import gives the columns' places, then the constants, the prompts and the header row. A column that feeds two targets has a row for each, together. (#41)
- **No empty sources.** A target that nothing feeds is no longer a row reading "Not mapped": one line under the table names every such target, "Not mapped: Parent and Code", with why in brackets where there is more to say, "(the list numbers its items itself)" or "(ignored)". (#41)
- **What stays the same.** What is read, the line above the table on how a list's items are told apart, the lines on the columns not used, and the diagnostic log.

## 0.15.6 (10 October 2026)

No arrow drawn as text anywhere on the page.

- **The map's buttons say their words alone.** A box's details offer "Open its 15 line items", where they read "Open its 15 line items →"; so does every other button there. (#40)
- **Marks are drawn.** The map's path separates its parts with a chevron, as its lists draw theirs; the pager's **Previous** and **Next** each draw a chevron, and a sorted column's mark is a chevron up or down, in place of the text marks they showed. Screen readers hear the buttons' names and the header's sort, as before. (#40)
- **Colour stops in words.** A formatting rule's stops read "#F5A5B1 at -10; #627786 at 100,000", where they read "-10 → #F5A5B1; 100,000 → #627786", in **Conditional Formatting** and in a card's **Conditional formatting**. Each colour still has its square, the filter still lists each stop, and the search finds them as written. (#40)
- **What stays the same.** What is read, every other table cell for cell, and how the page sorts, filters and turns its pages. (#40)

## 0.15.5 (10 October 2026)

Clicking a box on the model map no longer moves the map.

- **A box you click stays where it is.** The details open beside the picture, and the camera stays put while the box is whole in view and clear of the details, the legend, the notes, the line at the foot and the small picture. Where one of them would cover the box, or it stands partly outside the map, the map moves by no more than it takes to uncover the box, sideways or up and down, at the same size. It is never fitted again, and never taken nearer or further away, for a click. Clicking another box, with the details open, moves nothing unless the details cover that box. (#39)
- **Clearing the selection moves nothing.** With `Esc`, a click beside every box, a click on the box selected, or the details' close button, the map stays where it is. It no longer goes back to where it stood before the selection, nor is the whole map fitted again; the line at the foot says how much of it is in view, and its button shows the whole. (#39)
- **A box you go to is still brought into view.** The search, a link in the details, **Model map** from a row of the results and the arrow keys bring the box beside the details, with the boxes it has links with where they fit, as before. (#39)
- **A click may shake a little.** A press that moves up to 5 pixels with a mouse, 8 with a pen or 10 with a finger is a click, and moves neither the box nor the map. (#39)
- **What stays the same.** What the map draws, the trace of what feeds a box and what it feeds, dragging a box or the map, zooming, and `F` for the whole map. (#39)

## 0.15.4 (10 October 2026)

An import's **Mapping** names a column by the file's header for it.

- **The header alone.** Where an import keeps the header of the file's column that feeds a target, its **Source** reads that header and nothing else, "Product" where it read "Column headed Product" or "Column 3: Product". A column the import keeps only by its place reads "Column 3", as before, and one it keeps only by an identifier "Column with ID …". (#38)
- **What stays the same.** The lines under the mapping, which still count the columns by their places; what is read; and the diagnostic log. (#38)

## 0.15.3 (10 October 2026)

An update no longer asks for a refresh of an open model's tab.

- **A new version keeps the model's reader when its code is the same.** The part of Cardigan that reads a model, inside the model's page, is marked by its code alone, not by the version, so an update that leaves it as it was needs nothing in an open model's tab. The version an export names is the running Cardigan's. (#37)
- **The new reader goes into the tab, in place of a refresh.** Where the model's page still holds the reader of an earlier version, the results page puts this version's into that tab, as Chrome does when the page loads, and reads the model. Pressing **Model** on a row does the same before it would load the module's link. Chrome allows this where the model is served from the tab's own Anaplan host. (#37)
- **One click where it cannot.** Where the model is served from another Anaplan host, or the new reader does not answer, the results page offers **Refresh the Anaplan tab and run**: the tab reloads, and Cardigan reads the model as soon as it shows. A refresh closes the modules and lists open in Model Building, so nothing refreshes the tab unless you choose it. (#37)
- **What stays the same.** The two permissions, activeTab and scripting; what is read from Anaplan; and a tab Cardigan was not opened on is never touched.

## 0.15.2 (10 October 2026)

An import's **Mapping** reads its columns as Anaplan saves them, and says how an import into a list tells its items apart.

- **A column by its heading.** Anaplan's import dialog often saves a column by its heading, where Cardigan looked only for its number: on a live model every column of such an import read "A column the definition neither numbers nor names". It now reads "Column headed Product", or "Column 3: Product" where the import keeps both. A column saved by neither its place nor its heading is said by what identifies it, "Column with ID …", and where no column has a place the line under the table says Cardigan cannot tell which columns are not used, not that each is named by its heading. (#36)
- **How a list's items are told apart.** Above the targets of an import into a list, a line says it as the dialog's **Items uniquely identified by** does: Name or code, Name only, Code only (Name (#ID) or Code for a numbered list), or a combination of properties, each named. A numbered list told apart by code or by properties numbers its items itself: its items' row says so, rather than "Not mapped". Whether a list is numbered comes from its row of General Lists. (#36)
- **In the diagnostic log**, each import from a file has two more lines: how its definition writes its first column, each of the three ways by its type and at most 20 characters of its value, and the keys of its `source`, `dataFormatDefinitions` and `dataFormatsByTarget`. One live log then shows how a model's definitions write their columns. (#36)
- **What stays the same.** What is read: the same grid of the imports' definitions, read once, and nothing sent. The tables are as they were.

## 0.15.1 (10 October 2026)

Model Calendar's Section starts hidden.

- **Model Calendar's Section starts hidden**, as its Allowed values do: every setting the table lists is in the same section, so the column said the same on every row. The column chooser shows it, the search reads it, and a row's details list it. (#35)
- **What stays the same.** What is read, and what the table holds.

## 0.15.0 (10 October 2026)

A column of numbers or of dates is filtered by a range, from one value to another, rather than by a list of its values to tick.

- **From and To.** A column whose every value is a number, or every value a date, has two boxes in its filter instead of a list: the counts (**Cell Count**, **Item Count**, an app's card counts), a card's or a section's number, an action's duration and start, when a page was last published, and any column of figures, such as the **Sources** and **Imports** of Source Models. Either box may stay empty, for no end there, and both ends are kept: from 3 to 3 keeps card 3. Past 30 values such a column had no filter, and up to 30 it listed its figures to tick. (#34)
  - **Numbers** are read as the cells write them: with a sign, their thousands apart or not, a fraction and a percent sign (40% is 40). A box for numbers shows the column's lowest or highest value until something is typed, with its thousands apart in a column of counts. Figures that begin with a zero, such as 0040, are a code and no number, and an ID or a **Code** is never filtered by a range. (#34)
  - **Dates** are whole days, read by the day they name whatever their time: until 12 March keeps an action that started late on 12 March. A box for dates is the browser's own, held to the column's first and last day, and where the column's header says UTC, the filter says that its dates and times are. (#34)
  - **Blank cells**: where the column has any, **Keep blank cells**, with how many there are, keeps them or leaves them out. (#34)
- **Set, said and cleared.** **Enter** in a box or **Apply** sets the range, and the box for blank cells as it is ticked. A box that cannot be read, or a From after its To, says what is wrong at that box, for a screen reader too, and the range stays as it was. The filter's button says what the range keeps, such as "≥ 10", "10–12, no blanks" or "until 2026-03-12"; **Clear** takes it away, and **Reset** clears ranges with the other filters. Each column is read once for its range, the first time its filter opens or keeps rows. (#34)
- **What stays the same.** A column of words keeps its list to tick, and a column that lists items is filtered by each item; the result itself is never changed by a filter. (#34)

## 0.14.0 (10 October 2026)

The Model map's bar says where the map is, how it is built and what its tools are, and the map can fill the screen.

- **The map's bar in three parts.** Each keeps to one line, and on a narrow map each takes a line of its own, never half of one. (#33)
  - **Where the map is.** The **Modules** and **Line items** switch, then a path that starts with the model's name, which leads back to the groups as a whole. In the Modules view the path's list says what is shown: **All groups**, **All modules**, or one group, with how many modules it holds; it replaces **Show sections** and the list of sections. In the Line items view the path names the module's group and then the module, so the module's name is no longer said twice: the group narrows the module picker, a box to type into that lists the group's modules until something is typed, and then every module whose name holds it, at most 200 at once, with the arrows, Enter and Escape. It replaces the list of every module. The path follows the map wherever it goes: a double-click, the search, Escape, a row's **Model map**. The page's header names the workspace, so the path no longer does; the model's name says it on hover. (#33)
  - **How the map is built.** **Group by**, now under its label, offers each grouping by its name, the map's own pick as "Headings · automatic". In the Line items view, the box **Other modules' line items**, ticked while those line items stand one by one, replaces the button whose words changed with what it did. (#33)
  - **Its tools.** **Links** opens a panel of the links the map draws: formulas, always, and **Access drivers**, a box, with what they are in a modeller's words: line items that decide which cells someone can see or edit. Its button has a dot while access drivers are drawn. Then the search, and full screen. (#33)
- **Full screen.** A button at the end of the bar gives the map the whole screen, with its bar, its details and its legend, and draws it for the new size; the button and Escape leave it, and the button says which it will do, whichever way the screen was left. Where the browser will not give the map the screen, the map fills the browser's window instead, over the page but for its toasts, and Escape and the button leave that too. A map that is hidden leaves either. (#33)
- **A list's Model map.** From a row of **General Lists**, **Model map** shows the list beside the line items of the first module it is linked with, selected, where the map showed nothing before. A list linked with no line item is on no map. (#33)
- **What stays the same.** What the map draws and how it groups modules, and everything Cardigan reads.

## 0.13.0 (10 October 2026)

Buttons that open a row's module, list, app or page in Anaplan, every row of Line Items, a model map grouped six ways, fewer reads, a process's actions in their order, and filters on almost every column.

- **Model map, from a row's details.** What 0.12.0 called **Open in Model map** is now **Model map**, and a row of **Module Usage** has it too. The details of a line item or a module, from **Line Items**, **Modules** or **Module Usage**, have **Model map** at the top right, a filled button with the map's icon. It closes the details and shows the map on that line item, inside its module's view, or on that module among its section's, selected, with what feeds it and what it feeds. A heading of Modules, and a line item or a module the map does not draw, have no such button. (#24)
- **Open a row's module, app and page in Anaplan, from its details.** These buttons replace 0.12.0's double-click.
  - **The buttons.** Under **Model map**, filled buttons with their own icons: **Model** opens the module of a row of **Line Items**, **Modules** or **Module Usage** in Model Building, a line item its module; in **Page Filters**, **Condition module** and **Filtered module** open the filter's two modules, or one **Model** button where they are one; **App** and **Page** open the app and the page of a row of **Module Usage**, **Page Filters** or **Page Actions**, a page by its type's address, as Model Building's own links write it. Each button's title names what it opens, and only those whose place is known are there; where the result keeps every row from one, a line under the header says why. A model's result keeps each module's ID, and where it was read, the site and the customer of the Model Building address, so that a refresh of the results page opens them as well. (#24)
  - **Two tabs, each reused.** Modules open in the Anaplan tab Cardigan read, which comes to the front with its window; apps and pages in a tab of their own, which the first **App** or **Page** opens next to the results page and every later one reuses, so the Anaplan tab never leaves the model and **Run again** reads the model again. No tab opens for each click. Where the Anaplan tab has been closed, the first module opens one tab in its place, which every later one then uses; a closed tab of apps and pages is replaced the same way; a refresh of the results page keeps both, and uses a kept tab only where the browser says the results page opened it. (#24, #30)
  - **A module opens inside Model Building.** Where the Anaplan tab shows the model in Model Building, a module opens inside the page, beside the modules already open, and the page does not load again: Cardigan's reader in the model's frame asks the classic client to open it as its Modules list does (`anaplan/views`), and Model Building adds and selects its tab. Elsewhere, and where the tab cannot (a tab whose reader is of an earlier build, or that does not answer within a second and a half), the module's own Model Building link is loaded; the run's log says which way each module was opened. (#26)
- **Lists open as modules do.** A row of **General Lists** has **Model map** and **Model**, which opens the list in Model Building, and a row of **Page Filters** has **Filtered list**, which opens the list its filtered dimension is, or the list of a subset. A list opens inside the Model Building page the Anaplan tab shows, beside the tabs open there, through the classic client's way of opening one that General Lists uses (the same `anaplan/views` as a module's), and otherwise by its own Model Building link. As in Model Building itself, a list opens only for a workspace administrator. A model's result keeps each list's ID, which the export takes from General Lists, and the log says how many it found. (#30)
- **Model opens the place of every table of a model.** **Model** on a row of Model Calendar or Time Ranges opens Model Building's Time page; of Versions, the Versions page; of Line Item Subsets, that page; of Processes, Imports, Exports, Other Actions, Import Data Sources or Page Actions, the Actions page; of Source Models, that page. A settings page opens by its own Model Building address (`/tabs/` and the ID Model Building's sidebar opens it by), which loads Model Building afresh, on the page as a whole. A row of **Dynamic Cell Access** opens its driver's module and the controlled module, or one **Model** where they are one. (#30)
- **A model's tab from before an update is refreshed first.** The part of Cardigan that reads a model runs inside the model's page, and Chrome takes it out of no page when Cardigan is updated or reloaded: a model's tab that was open before kept the earlier reader, which read the model without what 0.12.0 added, such as the modules' IDs and the mappings of imports. 0.11.2 said that only a model opened before Cardigan was first installed needed a refresh. Each build now marks its reader, and the results page reads a model only with a reader of its own build; for any other it says to refresh the Anaplan tab, and reads nothing. A build that leaves the reader as it was keeps its mark. (#24)
- **Page Filters and Page Actions in their own order.** A filter says first what filters, the condition line item's module and the line item, then what it filters, the module and the dimension, then its condition, and then where it is, by app, page, card and section. A button says first the model's action it runs, by name and type, then where it is, by app, page, card and label, and then how it behaves. They and **Module Usage** end with columns that start hidden: each page's type and the IDs of the page and its app, which the details' buttons open them by. The map reads Page Filters by its columns' names, the first one too. (#24)
- **An import's mapping, step by step in the log.** The diagnostic log follows each step of reading the mappings of imports from a file: the imports by Source Type and how many mappings are to be read, the read of the definitions, each definition's make, and how many were found and read. The column of definitions is found by its label too, where the model's client numbers it otherwise, and an import's name is matched to its row without the spaces around it. (#24)
- **Line Items lists every row.** The table has each module's own row again, in bold above its line items, with its own name under Module Name, so the Overview's tile counts the rows of Anaplan's Line Items grid, with no second number. A column after Format, **Format type**, gives each line item's data type and always has a filter: untick (blank) to list only line items, and No Data as well to leave out the line items that are headings. From a module's own row, **Model map** and **Model** open the module, as from a row of Modules. (#25)
- **The Model map groups modules six ways.** A switch in the map's bar chooses how its sections are made: **by functional area**, each module's Functional Area from Modules; **by headings**, as before; **by name prefix**, the code a module's name starts with where enough modules share it, learnt from the names; **by role in the data flow**, Data, Input, System, Calculation or Output, worked out from imports, exports, formulas and which modules read which, never from names; **by app**, from Module Usage; and **by main dimension**, the first list a module applies to. The map opens on the first of functional area, headings and name prefix that makes 3 to 15 sections, none with more than half the modules and at most a fifth left over, and otherwise on the role in the data flow; the switch marks that pick as automatic. A choice of yours is kept in this browser's local storage for the next map, as the theme is. A module's details say its section and where it comes from ("INP · from module names"), with why for a role, and so does the search. The ninth to the sixteenth section take the first eight colours again in stripes. The button back to the sections says **Show sections**. The map reads nothing more for any of it: Functional Area and Module Usage are tables of the result. (#27)
- **Fewer reads, and the time they take in the log.** Measured on a large model whose run took 35 seconds, more than half of that went to reading again what the run had already read. Now:
  - **The pages built on a model are named with the line items its export read.** The Line Items grid holds every line item's ID, name, module and format, so the model data socket is no longer asked for the line items of each module the pages use, and the search for the line items that page filters use has nothing left to find. One module the pages use is still read from the socket, to compare: where the two differ by an ID or a name, the export's line items are set aside, and every module is read from the socket as before, so a difference costs time and never a name. A module the export did not list is read as before. An app's run, which has no export, reads as it did. (#28)
  - **Each Model settings grid starts with its first page.** A grid was read once for one row, to learn its size, and then again from its first row; its first page now says its size, so a grid that one page holds takes one read. (#28)
  - **A model in another data centre is reached directly.** Cardigan's script in the Anaplan tab remembers, in memory and for that tab only, the host the model data service sent a model to, and the next run there starts on it. The names of imports, exports and processes are asked of the model's own host first, which spares the page's host refusing them after a wait. (#28)
  - **An app's pages are read four at a time**, started in the app's order, and the report keeps that order. Every list of reads, of pages, apps, modules' line items, items' names and saved views, keeps four moving: as soon as one ends, the next starts. (#28)
  - **The diagnostic log says where the time went:** how long each page of a grid took ("Line Items: rows 0–1332 in 0.62 s"), how many line items were named from the export and how the comparison went, and a "Time:" line for the steps of each part of a run, the connection to the model data socket, a redirect included, among them. (#28)
- **A process lists the actions it runs.** The details of a row of **Processes** end with **Actions**, below **All columns**: each action the process runs, numbered in the order it runs them, with its kind, Import, Export or Other action, and each name opens that action's own row where its table has one row of that name. The order is the process's own saved definition's, one more view of the model's settings, read as Anaplan's Actions tab reads it and only for a model with a process; nothing is saved. Where the result has none of a process's actions, as a result an earlier version kept, or where the definitions could not be read, the details list instead the actions whose **Used in Processes** names the process, by kind, and say that the order they run in is not known, and why. The diagnostic log says how many processes there are, then how many were read, with their actions by kind and any the Actions list does not have. (#29)
- **Filters on almost every column.** A column with more than 30 different values has a filter too, as long as its values repeat: a model's **Module Name** in Line Items, a module's **Applies To**, the model's action a page's button runs. Still without a filter past 30 values: a row's own name in a model's tables, free text (**Formula**, **Notes**, a card's **Text content**), IDs, measures, numbers and dates, and a column whose every value is in one row only, such as **Code**. A column with 30 values or fewer keeps the filter it had. (#31)
  - **A column that lists items is filtered by each item.** **Applies To**, **Referenced By**, an action's **Used in Processes**, a card's **Context selectors** and the other columns whose details list their items one per line now list each item once in their filter, with the rows that list it, and keep a row when any of its items is ticked. (#31)
  - **A filter of more than 15 values has a box to find them**, which has the focus when the filter opens. The list shows what it finds, with a line that says how many, and **Tick matches** and **Untick matches** (**Tick all** and **Untick all** while nothing is typed) work on all of that, listed or not. At most 300 values are listed at once. (#31)
  - **Read when it opens.** A filter's values are counted from the table's rows when the filter opens. Deciding which columns have one reads each column until its answer is known: about 10 ms for a Line Items table of 7,400 rows and 30 columns. (#31)
- **What stays the same.** What is read of an app and of a model's settings, apart from the processes' definitions for a model with a process (#29), and that every read is a read, though there are fewer of them (#28); and what their tables hold, apart from the order of Page Filters and Page Actions and the hidden columns they and Module Usage end with (#24), and the How to read rows on Processes (#29), Line Items and Dynamic Cell Access (#25).

## 0.12.0 (9 October 2026)

Shortcuts to where a row or a count leads, the pages built on a model, and new pictures.

- **Open in Model map.** The details of a line item or a module, from **Line Items** or **Modules**, have **Open in Model map** at the top right, a filled button with the map's icon. It closes the details and shows the map on that line item, inside its module's view, or on that module among its section's, selected, with what feeds it and what it feeds. A heading of Modules, and a line item the map does not draw, have no such button. (#17, #18)
- **Double-click a row to open its module in Anaplan.** A double-click on a row of a model's **Line Items** or **Modules** takes the Anaplan tab Cardigan read to that module in Model Building, and brings the tab to the front; no new tab opens. A line item opens its module. The tab loads Model Building's own link to the module, so the page reloads while the model stays open: switching modules inside the page through Anaplan's app shell could not be checked, and is not tried. The rows say so when the pointer rests on them. A model's result now keeps each module's ID, and the content script tells the results page the site and the customer of a model in Model Building; a result an earlier version kept has no IDs, and the page says to run it again. 0.13.0 replaced the double-click with the **Model** button at the top right of a row's details. (#19)
- **Model Calendar's Allowed values start hidden.** They only guide filling the template in by hand; the column chooser shows them, and a row's details list them. (#18)
- **The Overview's tiles open their tables.** A click on a tile, for an app or a model, opens the table it counts, as the table's entry in the navigation does. (#17)
- **Module Usage, Page Filters and Page Actions.** After a model's settings, Cardigan reads the pages built on the model, in every app you can open, with GET requests and the model data socket, as an app's pages are read: Model Building's list of those pages, each page's published version (four at a time), the name of each app, and the names the cards use. Three tables follow Source Models, last before the map, each on its own in the navigation. **Module Usage** lists each module with the apps and pages that use it, in the order of Modules, or says **Not on any page**. **Page Filters** and **Page Actions** are an app's Filters and Action Buttons tables with the app in front, for the cards that work on this model. A page that cannot be read is named in a note. Without a customer in the address, as on the classic model page, or when Anaplan refuses the list, the three tables are listed as not exported, with the reason, and the export is kept. What the step reports joins the result's diagnostic log. (#20)
- **Line Items counts its page filters.** A **Page Filters** column says how many page filters have the line item as their condition: empty rather than 0 when a page could not be read, or a filter's condition line item could not be named. (#20)
- **The Overview names the apps.** Under **About this export**, **Apps**, after Model ID, names the apps whose pages use the model, one per line, or says that no app's pages use it. (#20)
- **The map lists a line item's page filters.** A line item's details on the Model map list the page filters that have it as their condition, by app, page and card: the first ten, and how many more. The map reads them from the Page Filters table, and nothing more from Anaplan. (#20)
- **An import from a file shows its mapping.** The details of a row of **Imports** whose **Source Type** is FILE end with **Mapping**, below **All columns**: each target of the import with what feeds it, a column of the file by its number and, where the import keeps it, its heading, a constant and its value, a prompt, ignored, or not mapped. A line names the columns before the last one mapped that no target uses; whether the file has columns after it is not known, since Anaplan keeps the mapping and not the file's header row, and the page says so. The mapping is read from the import's own saved definition, one more view of the model's settings, read only for a model with an import from a file, so it shows for a file that is no longer available too. Nothing is saved, and Anaplan is never asked for a file's columns. An import into users, versions or line items says what it loads instead, and a result an earlier version kept shows no mapping. (#21)
- **The README's pictures are retaken** on this build: the header has the new logo, and a model's navigation has Module Usage, Page Filters and Page Actions. As before, they show an invented app and model, which Cardigan's own card reader, report and model export read; the model's three new tables are made from the app's pages, as a run makes them from the pages built on a model. (#22)
- **What stays the same.** How an app and a model's settings are read, apart from the imports' definitions for a model with an import from a file (#21); and what their tables hold, apart from the Page Filters column of Line Items (#20) and the How to read row on Imports (#21).

## 0.11.2 (9 October 2026)

An Anaplan tab that was open before Cardigan was installed, updated or reloaded is read without a refresh, and a new logo.

- **No refresh after an update.** Chrome puts Cardigan's script only into pages that load after Cardigan is installed, updated or reloaded, so a tab open since before said **Not connected** until it was refreshed. Clicking the icon on such a tab now puts the script back there, and the reading starts. A model in Model Building that was open before Cardigan was first installed still needs one refresh: the part of Cardigan that reads inside the model runs in the page itself, and is not put back.
- **A tab still loading** is asked again for about five seconds before the page says it cannot reach it.
- **The page says what is wrong.** A tab that shows another site is named, and a closed tab is said to be closed. **Not connected** says to wait for a loading tab before it says to refresh.
- **Two permissions**, neither with a warning: **activeTab** and **scripting**. They reach only the tab the icon was clicked on, and only an Anaplan page there. The packager refuses any other permission.
- **A new logo.** Cardigan's star and its C in navy, orange and peach, on the toolbar and in the results page's header. The README's pictures are retaken with it in 0.12.0.
- **What stays the same.** What is read from Anaplan, and what the tables hold.

## 0.11.1 (7 October 2026)

The model map's selects, and new pictures.

- **The model map's two selects**, of the section and of the module, have the chevron of the page's menus, clear of the round end of their pills, as the page's other chevrons have since 0.11.0.
- **The README's pictures are retaken** on this build, with the bar of icons. As before, they show an invented app and model, which Cardigan's own card reader, report and model export read.
- **What stays the same.** What is read from Anaplan, and what the tables hold.

## 0.11.0 (7 October 2026)

A bar of icons in place of the side navigation, tables that hold still, and values read item by item.

- **The navigation is a bar under the header.** Each entry has a small icon. A model's tables are grouped in menus: **Time** (Model Calendar, Time Ranges), **Lists** (General Lists, Line Item Subsets), **Modules** (Modules, Line Items, Dynamic Cell Access) and **Actions** (Processes, Imports, Import Data Sources, Exports, Other Actions), with Overview, Versions, Source Models and Model map on their own. A menu's button names the table shown when it is one of the menu's. The bar has no counts and never scrolls; in a window narrower than 1,000 pixels one menu holds every entry. The breadcrumb and the button that put the navigation away are gone, and the header shows the toolbar's icon.
- **The page stands in a centred column**, at most 1,400 pixels wide, with room at both sides that grows with the window. The model map takes the whole width.
- **The Overview** no longer has the Cards by type and Models panels. Under About this export, a value that lists several things has each on a line of its own, without semicolons, and an app's models follow its ID.
- **Tables hold still.** Each column's width is worked out once from all of the table's rows, so a sort, a page, a search or a filter no longer moves the columns or the table's sideways scroll. The pager has Previous and Next, without page numbers.
- **Counts have commas.** Cell Count, a Polaris model's Populated Cell Count, Item Count, an app's card counts on Pages, and Pages and Cards in Model Objects show their thousands apart (15,389,009,578). They still sort as numbers, and the search finds them with or without commas.
- **A panel lists items one per line.** Where a value lists several items, such as Applies To, Referenced By, Context selectors or Colour stops, the panel that opens on a row or a card lists them one per line. The table keeps them on one line.
- **Colours show as squares.** A conditional formatting rule's colour stops show a small square of each colour before its code.
- **The model map's trace keeps moving.** The dashes on a selected box's links move for as long as it is selected, where they stopped after 1.4 seconds, and are drawn a fifth thinner. They still stand still for a user who asked for less motion.
- **Where Used is now Model Objects**: the model's objects the app uses, and where each is used.
- **A refresh keeps the view.** A refreshed page opens on the table or the map it showed. The page's address marks the view by the table's place, and names nothing of the result.
- **Filters.** A filter's condition line item is told apart from its filter context, and the system's Current User item reads "Users = Current User".
- **More context selectors are named.** A dimension that no answer named is named from the grid's own metadata or from the lists with their subsets. For at most ten still unnamed, Cardigan asks which modules have the dimension and reads their dimensions, within 30 seconds in all. The diagnostic log has a line for each one that stays unnamed.
- **A model's tables as the page shows them.** Model Calendar lists only the settings that hold a value, without the template's Applies to and Notes. Imports shows Source Object as **Source Model**, **Source Module** and **Saved View**; Source Model names the model itself for an import from its own modules, and a saved view written without quotes is read too. Source Models shows Mapped To as **Mapped Workspace** and **Mapped Model**. A row's panel still has the cell as it was read.
- **Other Actions has an Action List column**, which names the list an action deletes from or orders, in place of its ID.
- **Plain hyphens.** The dash for nothing to say in an app's tables is a plain hyphen, and no text of the page or the tables uses an em dash.
- **What stays the same.** What is read from Anaplan, apart from the reads for unnamed dimensions above. The tables hold what they held, apart from the hyphen, the Action List column, reworded How to read rows, and the App Details values that list several things, now one to a line; Model Calendar, Imports and Source Models are shown differently, but their tables are as the export wrote them.

## 0.10.0 (7 October 2026)

No downloads: the results page is the only place to see a result.

- **The two download buttons are gone.** "Download all (.zip)" and "Download this table (.csv)" are removed, for an app and for a model. Cardigan makes no file and offers no download. Copying the diagnostic log or an ID to the clipboard works as before.
- **The page speaks of tables.** Every sentence that spoke of a file, a CSV or a zip is reworded: "How to read these tables", "rows in all" on a tile, "module rows are not listed here" under Line Items, and so on. The model map's details no longer end with a file and a row.
- **No longer shown anywhere.** A module's own row of the Line Items list is a row of no table: the Modules table and the model map hold a module's settings. Two rows of the Model Calendar's template that were left for the reader to fill in, Model size (GB) and Captured by, are shown nowhere, and the note about long IDs in a spreadsheet is gone.
- **What stays the same.** What is read from Anaplan, and what the tables hold: the stored comparisons still hold every table cell for cell, apart from the reworded sentences. The last result is still kept for its tab, so that a refresh brings it back, and **Forget this result** removes it. A result kept by an earlier version is not shown.
- **The extension's description** in Chrome no longer says "with CSV export".
- **README and NOTICE** say the same. Four of the README's pictures showed sentences that are gone and were removed; the others lost the bar at the top of the page, which showed the two buttons.

## 0.9.1 (7 October 2026)

A new icon.

- **The extension's icon is the star logo.** It shows on the toolbar button, on Cardigan's card in `chrome://extensions` and as the results page's own icon. `npm run icons` now makes the four sizes from `icons/source.png`, where it used to draw them.
- **What stays the same.** What is read, the page and every file written, apart from the version number.

## 0.9.0 (7 October 2026)

A model's Dynamic Cell Access listed from the driver's side, a page as wide as the window, and a navigation that can be put away.

- **Dynamic Cell Access.** A model's export has one more table, right after Line Items: `Dynamic Cell Access.csv`, with its page. The Line Items list names an access driver on the line item it controls, in that row's **Read Access Driver** and **Write Access Driver** cells. This table lists the same uses with the driver first: one row for each use of a driver, with the driver's module and name, **Read** or **Write**, and the module and name of what it controls. A line item that one driver controls for reading and for writing has two rows. A driver that could not be matched to a line item comes last, written as its cell is, and the page says how many there are. A model that drives no access gets the table with no rows.
- **Nothing more is read.** The table is made from the Line Items grid the export already reads, by the rules the model map uses for its access links, so the two agree wherever the map places a row; the table also lists a driver named on a row the map leaves out. It is not written when Line Items was not exported or lacks its Module Name column or one of the two driver columns; the Details file then says why.
- **In `Model Details.csv`.** A **Files** row and a **How to read** row for the new file.
- **The page uses the window's width.** It was held to 1600 pixels and centred. Now the navigation stands at the window's left edge and a table or the model map takes all the room beside it; the space around them is smaller too. The Overview's notes keep to a readable line length.
- **The navigation can be put away.** The button beside the Cardigan name hides the navigation and brings it back, so that a table or the model map can take the whole window. The browser remembers the choice. In a narrow window the button opens the navigation over the content, as before.
- **What stays the same.** A model's other files, `Line Items.csv` among them, hold the bytes 0.8.1 writes, apart from the version number and those two rows. An app's files are unchanged apart from the version number, and so is the manifest.

## 0.8.1 (6 October 2026)

Housekeeping, so that the repository stands on its own.

- **Two error messages reworded.** A page definition that is too large to read is now said to exceed "the bounded JSON traversal" or "the 8 MB character bound". Nothing else in the extension changes.
- **Repository.** The research notes under `docs/research/` and the script that compared the card reader with a second copy are no longer part of this repository, and the comments in the source say what the code does without pointing elsewhere.
- **What stays the same.** What is read from Anaplan, and every file written: apart from the version number, and those two messages where one is written into a file, they hold the bytes 0.8.0 writes. The manifest is unchanged apart from the version.

## 0.8.0 (6 October 2026)

The model map: a picture of a model's modules and line items and of what feeds what, on the results page.

- **Model map.** A model's navigation ends with **Model map**. It draws the model from the tables of the export and from nothing else, so nothing more is read from Anaplan. It opens on the model's sections, which are the heading rows of the Line Items list, goes into a section's modules or all modules, and into one module's line items. A model without headings opens on its modules. An arrow from A to B means that B reads A.
- **Trace, details and search.** Click a box to mark everything that feeds it and everything it feeds. The details beside it give a line item's formula, its format and summary in the words the Line Items table uses, what feeds it directly and what it feeds directly, and the file and row it comes from. Search finds sections, modules and line items. The legend hides and shows layers, and **Access drivers** adds the links of read and write access drivers.
- **Readable at its size.** A view opens with every name whole where the names fit. A larger view opens at a readable size on its start, says how many boxes are in view and offers **Whole map**. The map follows the page's light and dark themes. A trace's dashes move for a moment and then stand still, and nothing moves when the system asks for less motion.
- **What it leaves out.** **About this map** lists what the map could not hold for this export, such as a file or a column that was not exported, a name that matched no object or a row that was left out, and what no export says. Formulas are shown as text and are never worked out; every link comes from a column of the export that names another object.
- **If it cannot be drawn.** The page says so in the map's place, the reason goes to the diagnostic log, and the tables and downloads work as before.
- **README.** Rewritten as the front page of the tool, with pictures of an invented app and model.
- **NOTICE.** It says that the model map reads and sends nothing, and that the socket client also opens and closes its connection.
- **What stays the same.** What is read from Anaplan, and the zip with its CSV files: apart from the version number they hold the bytes 0.7.2 writes for the same input. The manifest is unchanged apart from the version. The release zip holds twelve files: `map.css` joined.

## 0.7.2 (5 October 2026)

A wider search for the line items of filter rules, and corrections to **Forget this result**.

- **A filter rule's line item is looked for in the whole model.** A filter rule can use a line item of a module that no card of the app shows. Cardigan looked for it in the first 60 modules that have a dimension of the filtered axis, and a rule whose line item was not among them kept its IDs: the line item, its module, the value and the context all stayed numbers. The search now goes on through the model's other modules, the likeliest first, until every such rule has its line item, for at most 45 seconds per model. A rule whose line item is found is named like any other rule.
- **What is read for it.** The read is the one used before, a module's line items, made for more modules, a few at a time. A module that has not answered after ten seconds no longer holds up the others, and its answer still counts if it comes within the 45 seconds. No new kind of read is made.
- **When the 45 seconds run out.** A note says that some filter line items were not found and how many modules were not read, or that the model had not said which modules have the filtered dimension. Such a rule keeps its IDs.
- **In `App Details.csv`.** The search's reads do not write their frames to the diagnostic log. The search writes a few lines that begin "filter line items": how many modules were read, how long it took, what was found and what was not, and how many reads were given up while waiting. `Filters.csv` and `Where Used.csv` change only where a rule that kept its IDs is now named.
- **Fix: nothing more is asked once the work has ended.** Once the model has reported that it is closed or gone, or the run was stopped, no step sends another read. Before, the step that followed could still send one.
- **Fix: a redirect during the search.** The modules being read when the model's data moved to another host were taken for unreadable and left out of the search. They are now read again on the new host.
- **Forget this result says what happened.** When the browser refuses to remove the kept copy, the page says "The copy kept for refreshes could not be removed." and keeps the control; before, it said that the copy was removed. The sentence that the copy is removed is no longer read twice by a screen reader, and the Overview no longer moves when the control arrives.
- **What stays the same.** Apart from the version number, a model's files are, byte for byte, what 0.7.1 writes, and so are an app's when no filter rule's line item had to be looked for. The manifest is unchanged apart from the version.

## 0.7.1 (4 October 2026)

Two additions to 0.7.0.

- **A new column in `Line Items.csv`.** A model's `Line Items.csv` has one more column, after **Ratio Denominator**: **Format List**. For a line item formatted as a list it holds the list's name, as `General Lists.csv` names it; the Format cell gives the list only by its ID. It is empty for any other format, for a list that is not a row of General Lists, such as a list subset or a line item subset, and when General Lists could not be read. No read is added for it: the names come from the General Lists grid the export already reads. The results page says such a format with the name, as "List: Products", and with the list's ID where the column is empty. The file's other columns hold what 0.7.0 wrote. In `Model Details.csv` the **How to read** row about Line Items now says what each of the three added columns holds; the model's other files are unchanged.
- **Forget this result.** On the Overview, under what was analysed, a line says that a copy of the result is kept for a refresh of the page, with **Forget this result** beside it. It removes the kept copy at once; the result stays on the page, with its downloads, until the page is refreshed or closed. The control shows only while a copy is kept, and comes back when **Run again** keeps a new result. [NOTICE.md](NOTICE.md) says where the copy is kept.
- **Line Items without a Modules file.** When a model's Modules file was not exported, or lists no modules, the line under the Line Items table says so: a row with only a name is then taken for a module's row.
- **What stays the same.** Apart from the version number, an app's files are, byte for byte, what 0.7.0 writes, and so are a model's apart from the column and the row above. Nothing new is read from Anaplan, and the manifest is unchanged apart from the version.

## 0.7.0 (4 October 2026)

The results now open on a page of their own, and nothing is added to Anaplan's pages.

- **Toolbar icon instead of buttons.** The floating **Analyse app** and **Export model** buttons and their panel are gone. Open an Anaplan app, or a model in Model Building, then click the Cardigan icon in Chrome's toolbar. A results page opens in a new tab, right after the Anaplan tab, and runs the analysis by itself. Nothing is read from Anaplan until then.
- **Results page.** It shows each step while the analysis runs, then an overview and one table per file. The overview holds the result's notes and the details of the export, with the diagnostic log in its **Diagnostics** section, which starts closed. A table can be searched and sorted and its columns chosen. Its page numbers and the choice of 25, 50 or 100 rows per page are at its top right, and its first column stays in view when it is scrolled sideways. A column that holds 2 to 30 different values can also be filtered, and a row opens in full from its first cell, by mouse or keyboard, with every value whole. In an app's tables, a page's name shows that page's cards, and a card opens with its grid sections, filters, formatting and buttons. Where two pages share a name, the name shows the cards of both, and a card whose parts cannot be told from another card's says so and leaves them out. An app's ID columns, **Card #** and **Section #** start hidden until chosen under **Columns**; the CSV files always hold every column. A model export uses the same page. **Download all (.zip)** saves the zip, and **Download this table (.csv)** saves the one file on screen.
- **A model's tables.** They come in the order of Anaplan's Model settings: Model Calendar, Time Ranges, Versions, General Lists, Modules, Line Items, Processes, Imports, Import Data Sources, Exports, Other Actions, Source Models, then **Model map**, listed as coming in a later version. **Model Calendar** lists the calendar's own rows, and the rows about the model are on the overview. **Line Items** lists line items only, each with its module next to its name and the dimensions it has, its module's when it has none of its own. The overview's tile for each of these two says both numbers: the rows listed and the rows the CSV has. A format, a summary and an action's definition are said in words, which the search, the filters and the sorting go by; a row opened in full also shows the CSV's text. The CSV files keep every row, Anaplan's layout and the JSON.
- **Where Used by object.** An app's Where Used table opens **By object**: one row per object, with how many pages and cards use it and what as, in the order of an index. A row opens the object with its uses, a page named once for its group of uses and linked to the cards of that name; a use's card number is a link only where the result settles which card it is. Where two pages share a name, which the CSV cannot tell apart, a count that cannot be exact reads "2+" (at least 2), the note under the table's name and the object's drawer say so, and a card's number is plain text where a card of that number or ID is on more than one of those pages. **Every use** lists the uses as the CSV has them, with a use's card number a link on the same condition, and the download is the file with every use in both ways.
- **Stopping and running again.** Closing the results page stops the analysis in the Anaplan tab. A run that is stopped while it is still connecting ends at once, and a connection that opens after that sends nothing. **Run again** analyses the tab again, and the result stays on the page until the new one is complete. If the new run fails, its message stands above the result, with a **Copy diagnostic log** button.
- **Only the icon starts a run unasked.** The results page starts the analysis by itself only when the icon has just opened it: its address carries the time of the click, and the page starts only within a minute of it. A results page that is reloaded, duplicated, restored from history or reopened later starts nothing: it shows the result its tab kept, or says "That Anaplan tab shows an app." (or "a model.") and waits for **Run**. After a run the control reads **Run again**.
- **A refresh keeps the result.** The last result that finished in a results tab is kept for that tab, compressed, in the browser's session storage. After a refresh the page shows it again under a line that says when it was analysed, and reads nothing from Anaplan until **Run again** is chosen. A page the icon has just opened always analyses afresh, a result too large to keep says so, and a kept result the page cannot show is forgotten. [NOTICE.md](NOTICE.md) says where it is kept and when it goes.
- **When a run fails.** The page says in a plain sentence what happened and what to do next. The codes and statuses behind it are in the diagnostic log, which **Copy diagnostic log** copies.
- **After updating.** Reload the extension in `chrome://extensions`, then refresh the Anaplan tab. Otherwise the results page says "Cardigan cannot reach that tab."
- **What stays the same.** What is read, apart from the reads for the items of filter rules, and the zip: its name, its CSV files and their columns. For the same input the files hold the bytes 0.6.1 wrote, apart from the version number in **Exported with** and what the next four entries list. Tests compare them with two zips written by 0.6.1. The extension still asks for no permissions: the manifest only gains the toolbar icon, a background service worker and a content security policy. The classic model page opened on its own is still exported.
- **The first line of the diagnostic log.** It names the build, what is read and the host:
  - An app: it was `page-analyzer v0.6.1: <app id> on <host>` and is now `Cardigan 0.7.0: app <app id> on <host>`. It is the first **Diagnostics** row of `App Details.csv`.
  - A model in Model Building: the results page shows `Cardigan 0.7.0: model <model id> on <host>` while the export runs, where the panel's log began `model-export-shell v0.6.1: <model id> on <host>`. `Model Details.csv` does not change: it holds the log of the model's own frame, which never had this line.
  - The classic model page opened on its own: the Diagnostics rows of `Model Details.csv` began with `model-export v0.6.1: <model id> on <host>` and now begin with `Cardigan 0.7.0: model <model id> on <host>`.
- **Filter items by name.** An item in a filter rule, chosen as the filter context or compared with a line item formatted as a list, is shown by its name where the model gives one, and by its ID otherwise. A named value changes the rule's **Value** in `Filters.csv`. A named context item tells its rule apart, which changes more: in `Filters.csv` the rule's **Condition line item**, that line item's module, the **Line item ID** and the **Condition context**; in `Where Used.csv` the rule's **Filter** row, and the file gains a **Filter context** row where the rule's context names a dimension. Either changes the **Filters** text in `Cards.csv`. The names take at most 40 extra reads for a model and at most 30 seconds for all of them together, of the kind already made for item names, and none when no rule has such an item. An item not named in that time keeps its ID. A rule that has its line item no longer has other modules searched for its context item, so the note that some filter line items were not found in the first 60 candidate modules is no longer written for it.
- **In `App Details.csv`.** The **How to read** row about these items is reworded, under the label **Filter context and values**. The **Diagnostics** rows are the run's own log, and gain lines when the items of filter rules are looked for: what was searched or asked, how many names came back and, when the 30 seconds ran out, how many items were not finished (most of these lines begin "filter"), the step "Reading filter item names in …", and the socket lines of the extra reads. The **Files** row for `Where Used.csv` gives that file's number of rows, so it changes when the file's rows do.
- **Fix: `Where Used.csv` no longer drops uses that share a name.** A page with the name of an earlier page lost the uses the earlier page also had, and a second object of the same type and name with another ID (line items of two modules, say) on the same card in the same role was dropped. Those rows are now written, so for such apps the file has more rows than 0.6.1 wrote.
- **Content security policy.** The manifest declares one for the extension's own pages and its service worker: scripts, the stylesheet and the icon come from the extension's own package, and nothing is loaded from anywhere else. `npm run package` refuses a manifest whose policy would allow more, or that declares none.
- **Build and packaging.** `npm run build` writes four bundles: `dist/background.js` and `dist/results.js` are new. The release zip holds eleven files: `manifest.json`, the four bundles, the four icons, `results.html` and `results.css`.

## 0.6.1 (3 October 2026)

- **Renamed to Cardigan.** Chrome now lists the extension as **Cardigan** instead of Anaplan Analyzer. The bundles' banner and the **Exported with** row of `App Details.csv` and `Model Details.csv` say Cardigan too. Nothing else changes: the same reads, files and columns.

## 0.6.0 (3 October 2026)

The first release as a standalone project, Cardigan, moved out of another project with its history. The extension's name stays **Anaplan Analyzer**.

- **Standalone repository.** The extension builds, tests and packages on its own (`npm ci`, `npm run build`, `npm run check`). It carries its own copy of the card reader in `src/card-reader/`, kept byte-for-byte identical to the other project's by `npm run check:card-reader`. GitHub Actions runs `npm run check` on every push and pull request.
- **Australia.** Both content scripts now also run on `https://*.app2.anaplan.com/*`, where Anaplan's au1 region serves the app (`au1a.app2.anaplan.com`). The host checks already accepted that host; tests now pin it and its lookalikes.
- **Icons.** 16, 32, 48 and 128 px icons, drawn by `scripts/icons.mjs` (`npm run icons`).
- **Packaging.** `npm run package` writes `release/cardigan-<version>.zip` with only the runtime files and prints its SHA-256. The zip is deterministic: the same files give the same bytes on every run.
- The bundles' code is that of 0.5.5, the last version inside the other project; only the version, the banner and the source paths in comments differ.

## 0.5.2 to 0.5.5 (1 to 3 October 2026), inside another project

Developed as part of another project, sharing that project's card reader:

- 0.5.2: the first version: the app page analysis (**Analyse app**) and the model export (**Export model**).
- 0.5.3 and 0.5.4: refactoring with no change in behaviour (shared helpers, named read phases) and many more tests.
- 0.5.5: fixes to what the exports say. In the model export, `Model Calendar.csv` writes the fiscal year's day and month by name where the settings grid returns Anaplan's stored IDs (7 and 12 became Sat and Dec), and **Current Fiscal Year** with its dates, as the Model Calendar tab shows it (FY24: 31 Dec 2023 - 28 Dec 2024); `Line Items.csv` gains **Ratio Numerator** and **Ratio Denominator**, naming the line items a Ratio summary divides. In the app export, **Pages analysed** counts unpublished pages apart ("93 of 93 (published versions); 3 unpublished, not analysed").
