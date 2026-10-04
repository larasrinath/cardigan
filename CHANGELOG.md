# Changelog

## 0.7.0 (3 October 2026)

The results now open on a page of their own, and nothing is added to Anaplan's pages.

- **Toolbar icon instead of buttons.** The floating **Analyse app** and **Export model** buttons and their panel are gone. Open an Anaplan app, or a model in Model Building, then click the Cardigan icon in Chrome's toolbar. A results page opens in a new tab, right after the Anaplan tab, and runs the analysis by itself. Nothing is read from Anaplan until then.
- **Results page.** It shows each step while the analysis runs, then an overview with the result's notes, one table per file, and the details of the export with the diagnostic log. A table can be searched and sorted, shown 25, 50 or 100 rows at a time, and its columns chosen. A column that holds 2 to 30 different values can also be filtered, and a row opens in full from its first cell, by mouse or keyboard, with every value whole. In an app's tables, a page's name shows that page's cards, and a card opens with its grid sections, filters, formatting and buttons. A model export uses the same page. **Download all (.zip)** saves the zip, and **Download this table (.csv)** saves the one file on screen. **Model map** is listed as coming in a later version.
- **Stopping and running again.** Closing the results page stops the analysis in the Anaplan tab. **Run again** analyses the tab again, and the result stays on the page until the new one is complete. If the new run fails, its message stands above the result, with a **Copy diagnostic log** button.
- **Only the icon starts a run unasked.** The results page starts the analysis by itself only when the icon has just opened it: its address carries the time of the click, and the page starts only within a minute of it. A results page that is reloaded, duplicated, restored from history or reopened later says "That Anaplan tab shows an app." (or "a model.") and waits for **Run**. After a run the control reads **Run again**.
- **After updating.** Reload the extension in `chrome://extensions`, then refresh the Anaplan tab. Otherwise the results page says "Cardigan cannot reach that tab."
- **What stays the same.** What is read, and the zip: its name, its CSV files, their columns and, for the same input, their bytes. Tests compare them with two zips written by 0.6.1. The extension still asks for no permissions: the manifest only gains the toolbar icon, a background service worker and a content security policy. The classic model page opened on its own is still exported.
- **The first line of the diagnostic log.** It names the build, what is read and the host. Apart from the version number in **Exported with**, it is the one line of the files that changes:
  - An app: it was `page-analyzer v0.6.1: <app id> on <host>` and is now `Cardigan 0.7.0: app <app id> on <host>`. It is the first **Diagnostics** row of `App Details.csv`.
  - A model in Model Building: the results page shows `Cardigan 0.7.0: model <model id> on <host>` while the export runs, where the panel's log began `model-export-shell v0.6.1: <model id> on <host>`. `Model Details.csv` does not change: it holds the log of the model's own frame, which never had this line.
  - The classic model page opened on its own: the Diagnostics rows of `Model Details.csv` began with `model-export v0.6.1: <model id> on <host>` and now begin with `Cardigan 0.7.0: model <model id> on <host>`.
- **Content security policy.** The manifest declares one for the extension's own pages and its service worker: scripts, the stylesheet and the icon come from the extension's own package, and nothing is loaded from anywhere else. `npm run package` refuses a manifest whose policy would allow more.
- **Build and packaging.** `npm run build` writes four bundles: `dist/background.js` and `dist/results.js` are new. The release zip holds eleven files: `manifest.json`, the four bundles, the four icons, `results.html` and `results.css`.

## 0.6.1 (3 October 2026)

- **Renamed to Cardigan.** Chrome now lists the extension as **Cardigan** instead of Anaplan Analyzer. The bundles' banner and the **Exported with** row of `App Details.csv` and `Model Details.csv` say Cardigan too. Nothing else changes: the same reads, files and columns.

## 0.6.0 (3 October 2026)

The first release as a standalone project, Cardigan, moved out of SAM (anaplan-sam) with its history. The extension's name stays **Anaplan Analyzer**.

- **Standalone repository.** The extension builds, tests and packages on its own (`npm ci`, `npm run build`, `npm run check`). It carries its own copy of the card reader in `src/card-reader/`, kept byte-for-byte identical to SAM's by `npm run check:card-reader`. GitHub Actions runs `npm run check` on every push and pull request.
- **Australia.** Both content scripts now also run on `https://*.app2.anaplan.com/*`, where Anaplan's au1 region serves the app (`au1a.app2.anaplan.com`). The host checks already accepted that host; tests now pin it and its lookalikes.
- **Icons.** 16, 32, 48 and 128 px icons, drawn by `scripts/icons.mjs` (`npm run icons`).
- **Packaging.** `npm run package` writes `release/cardigan-<version>.zip` with only the runtime files and prints its SHA-256. The zip is deterministic: the same files give the same bytes on every run.
- The bundles' code is that of 0.5.5, the last version inside SAM; only the version, the banner and the source paths in comments differ.

## 0.5.2 to 0.5.5 (1 to 3 October 2026), inside SAM

Developed in SAM as `extension/page-analyzer`, sharing SAM's card reader in `src/domains/ux-designer/`:

- 0.5.2: the first version: the app page analysis (**Analyse app**) and the model export (**Export model**).
- 0.5.3 and 0.5.4: refactoring with no change in behaviour (shared helpers, named read phases) and many more tests.
- 0.5.5: fixes to what the exports say. In the model export, `Model Calendar.csv` writes the fiscal year's day and month by name where the settings grid returns Anaplan's stored IDs (7 and 12 became Sat and Dec), and **Current Fiscal Year** with its dates, as the Model Calendar tab shows it (FY24: 31 Dec 2023 - 28 Dec 2024); `Line Items.csv` gains **Ratio Numerator** and **Ratio Denominator**, naming the line items a Ratio summary divides. In the app export, **Pages analysed** counts unpublished pages apart ("93 of 93 (published versions); 3 unpublished, not analysed").
