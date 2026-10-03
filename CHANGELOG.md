# Changelog

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
