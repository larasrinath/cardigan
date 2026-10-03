# UX card formats from the Page Builder designers

Research date: September 27, 2026. [Definitions (SAM)](https://github.com/larasrinath/anaplan-sam/blob/main/docs/research/ux-designer/definitions.md) | [Card details](card-details.md) | [Contracts (SAM)](https://github.com/larasrinath/anaplan-sam/blob/main/docs/research/ux-designer/contracts.md)

> **Copied from SAM.** This note was written in SAM (anaplan-sam, `docs/research/ux-designer/`), whose card reader Cardigan shares in [`src/card-reader/`](../../src/card-reader/). Its companion notes, SAM's source files and the archive paths below (`docs/plans/…`, `.sam/…`, Git-ignored) are in SAM's repository, not here.

This note settles three shapes that [card details](card-details.md) could not trace, because the designer bundles were missing from SAM's working tree:

- the conditional-formatting rules that grid and KPI cards store;
- action-card buttons and card-level `widgetActions`;
- grid cards built from a classic saved view.

It also records how Page Builder looks up module, line-item, view and list names, for a possible browser-only naming tool.

It downloaded the public designer assets without authentication and read them as text only. **No Anaplan service, model, browser session or MCP tool was used, and no bundle was executed.** No identifiers, names or tokens from captures appear here. Placeholders such as `<lineItemId>` stand in for them.

## Sources

Unauthenticated GET requests were made on September 27, 2026, with no cookies or credentials. The files are archived in SAM's Git-ignored `docs/plans/ux-designer-sources/`, and `manifest.json` records each file's URL, byte count, SHA-256 and retrieval time.

| Archive | Public source | Bytes | SHA-256 | Retrieved (UTC) |
| --- | --- | ---: | --- | --- |
| `springboard-ui.html` | [`/a/springboard-ui/`](https://us1a.app.anaplan.com/a/springboard-ui/) | 62,817 | `8a486a8ed50f1a1e78d7dfd74fdb57d3648d8ee15f7f3e5d3cfd2ddc4d50f85f` | 22:51:09 |
| `report-report-page.html` | [`/a/report-report-page/`](https://us1a.app.anaplan.com/a/report-report-page/) | 62,182 | `162473e35ce14eb7a90d2fe954b40546e348ad89eaa3e5c7eda953629b4bcfce` | 22:51:10 |
| `designer.js` | [Board and worksheet designer](https://us1a.app.anaplan.com/a/springboard-ui/assets/index-B2r9cWsE.js) | 4,683,782 | `54d9068fcf49e2c45db740dbcb057c4be4272ffc291b727e0e6ae3a2397f7ae7` | 22:51:19 |
| `report.js` | [Report designer](https://us1a.app.anaplan.com/a/report-report-page/assets/index-D2KPKwih.js) | 4,055,259 | `0fa71173f24ae07e4ff403d44a864b0860bd16bcbd79f2f6ec75514f20b0668c` | 22:51:19 |
| `designer-translations.en.js` | [Designer English strings](https://us1a.app.anaplan.com/a/springboard-ui/assets/translations.en-DoT5Cxgw.js) | 823,154 | `3462ab26bf4f0294aae3a6cf0a9c4083be36bcb86beeb08260ef9e41a46017d2` | 22:51:38 |
| `report-translations.en.js` | [Report English strings](https://us1a.app.anaplan.com/a/report-report-page/assets/translations.en-B2TOmf_V.js) | 759,207 | `ac33b02bea6aee68306fb024a976d19b30233eb8f186ba9985305a071d4a8e65` | 22:51:38 |
| `designer-vendor.js` | [Designer vendor chunk](https://us1a.app.anaplan.com/a/springboard-ui/assets/vendor-BDE573yj.js) | 11,955,216 | `28df0d24f4d4168c1268f744f7de321b415613cb6dae9e8c4fbc023467f9cf11` | 23:04:11 |

**Snapshot.** The designer hashes have rotated since the September 16 snapshot in [definitions.md](https://github.com/larasrinath/anaplan-sam/blob/main/docs/research/ux-designer/definitions.md) (`index-DVgePbpw.js`, `index-DfID3-t3.js`). That note's offsets and symbol names describe files that are no longer archived. Here, offsets are zero-based UTF-16 indices (`source.slice(offset)`). Each was recomputed from a unique substring, and each applies to this snapshot only. `designer.js` offsets are primary. Report equivalents are listed where they were checked; everything else was traced in `designer.js` only. The vendor chunk was searched and contains none of the field names discussed here.

**Evidence levels.** **Traced**: read in the cited bundle code. **Observed (relayed)**: seen in a Git-ignored capture that the lead reviewed; no values are reproduced here. **Inferred**: consistent with the evidence but not established. **Unknown**: no evidence.

## Key points for an extractor

1. A grid rule's `type` is one of `BG_COLOR`, `FONT`, `MORSE` or `SLOT`. Report any other value verbatim.
2. A version 1 rule is `{targetIdentifier, sourceIdentifier, type, pegs}`. A merged-grid (version 2) rule adds `targetRegion` and `targetRegionId`; `valuesRegion` appears only on converted rules. The read-back version 1 rule also had `targetRegionId`, `targetRegionCoordinates` and `valuesRegionCoordinates`, all `null`. No client code uses the `*Coordinates` names. Accept both spellings.
3. For KPI cards, read the nested `conditionalFormatting` first, then fall back to the flat `cf*` fields. The flat values are strings and keep only three stops. `config` is an object.
4. For action buttons, prefer `actionButtons` and fall back to parsing the `actions` string. Redact `actionToken` in both.
5. The client serializer passes `widgetActions` through unchanged, with the keys `{actionId, actionType, label, …}` rather than `{id, name, type}`. Accept both key sets.
6. A saved-view grid is `CLASSIC` plus the view ID, with no ADQ. The page definition stores no pivot, filter or sort state for it.

## 1. Grid conditional formatting types and fields

### Stored rule types

**Traced in both bundles.** The enum is `k1` (949502; report `mg` 694025): `k1=(e=>(e.BG_COLOR="BG_COLOR",e.FONT="FONT",e.MORSE="MORSE",e.SLOT="SLOT",e))`.

| Stored `type` | Page Builder label | Offered | Viewer cell style (from card-details.md) |
| --- | --- | --- | --- |
| `BG_COLOR` | Background | Always; the first and default option | `fill`: inferred mapping |
| `FONT` | Font | Only with feature flag `gridConditionalFormattingFontColor` | `font`: inferred mapping |
| `SLOT` | **Border** | Always | `slot`: background from `cfg.color` plus class `cf-slot`; inferred mapping |
| `MORSE` | Morse | Always | `morse`: a bar of `normalizedValue`; inferred mapping |

- Every style picker offers exactly these four values: `bRt` (1387346) and the lists inside `YFt`, `VGt` and `dBt`.
- The presentation-table calculated-column editor offers the same four (`IK` 2017456).
- No icon-set, threshold, data-bar or "based on another line item" rule type exists. The source line item is a field, not a type.
- The viewer's `sausage` style has no stored counterpart. Its origin is **unknown**.
- The labels come from `conditional_formatting_cf_styleOption_*` in the translations.

### How Page Builder writes rules (traced)

**Choosing the panel.** `HGt` (1855482) opens one of three panels:

- `dBt` (1819822) for version 2 ADQs;
- `VGt` (1853428) when flag `nonNumericConditionalFormatting` is set;
- `YFt` (1787109) otherwise.

**Building the rule.** `YFt` and `VGt` both build `{targetIdentifier, sourceIdentifier, type, pegs}`. They then dispatch the transform `{type: "CONDITIONAL_FORMATTING", options: {rules}}`. Any existing rule with the same `targetIdentifier` is replaced, so there is one rule per target line item.

**Storing it.** `K8` (1786934; report `SP` 1588675) writes `{...adq, conditionalFormattingRules: [...options.rules]}`. The rules are therefore stored as built, in `widgetDataSources[0].axisDescriptionQuery.conditionalFormattingRules`.

| Field | Meaning | Level |
| --- | --- | --- |
| `targetIdentifier` | "Line item": the line item that is formatted. It is chosen from all of the module's line items and defaults to the Line Items context selection (`20000000012`) or the grid selection (`FGt` 1852196). | Traced |
| `sourceIdentifier` | "Values from": the line item whose values are compared. It defaults to the target ("- Same as Line Item -"). `YFt` offers only `NUMBER` line items. `VGt` offers the `q0` types `NUMBER`, `BOOLEAN`, `ENTITY` and `TIME_ENTITY` (1848773). | Traced |
| `type` | One of the four values above | Traced |
| `pegs` | `[{value: <number>, color: "#RRGGBB", colorTheme?: <palette token>}]`, described below | Traced |

**Pegs.**

- The editor `xRt` (1385536), with one row `l3` (1383711) per peg, shows Minimum, "Midpoint (optional)" and Maximum. It starts with three slots (`GGt=3` at 1853416), and further midpoints can be added.
- Apply requires the first and last pegs to have both a value and a colour.
- `R5` (1818547) rejects values that are not strictly increasing.
- Only pegs with a numeric value and a colour are saved.
- The colour picker writes `color`, normalised to `#hex` by `W7` (1339686), and `colorTheme`. `colorTheme` survives the save filter. The observed rule had only `{value, color}`, so whether the service keeps `colorTheme` is **unknown**.
- The service evaluates the rules. Pegs as colour stops evaluated on the source and painted on the target is **inferred**.

**Non-numeric sources (traced).** Behind `nonNumericConditionalFormatting`, a `BOOLEAN` source shows true/false colour pickers (`SNt` 1436366) and a list source shows per-item pickers (`ANt` 1437437). Both keep local state only. Apply stays disabled without numeric minimum and maximum pegs, and the save filter keeps only numeric pegs. This snapshot therefore has **no stored shape** for boolean or list rules.

### Merged grids (ADQ version 2)

**Traced.**

- `dBt` targets a line item within a region.
- `Bw` (1818773) builds `{id, targetIdentifier, sourceIdentifier, type, pegs, targetRegion: {columnAxisKey, rowAxisKey} | undefined, valuesRegion: undefined, targetRegionId}`.
- `DZ` (1819039) serializes `{targetIdentifier, sourceIdentifier, type, pegs, targetRegion, targetRegionId}`. It drops the client `id` and `valuesRegion`.
- Merging a version 1 grid (`NBt` 1830562) keeps its rules and adds three fields:
  - `targetRegion` and `valuesRegion`, both `{columnAxisKey: "col-0", rowAxisKey: "row-0"}`;
  - `targetRegionId`, set to the first region's ID, or `"SINGLE"` when there is none (constants at 908739; report 653678).
- A version 2 source drops rules whose `targetRegionId` no longer names a region.
- On read, `getConditionalFormattingRules` (1773740) defaults a missing `targetRegionId` to `"SINGLE"` and a missing `targetRegion` to `col-0`/`row-0`.

**Contradiction with the capture.** `targetRegionCoordinates` and `valuesRegionCoordinates` were observed as `null` in the read-back version 1 rule. They occur in no client file: not the designer, report or vendor bundles, nor the viewer archives. They are therefore service-side names. Whether version 2 reads return `targetRegion` or `*RegionCoordinates` is **unknown**.

### Other formatting stores an extractor may meet (traced)

**Presentation tables.** `dataConfig` is a JSON string (`gJt` 2109406) holding a view description. Its `customizations[]` store conditional formatting as follows (`O_t` 1039188 writes it; `V_t` 1041336 reads it back):

```text
{type: "CONDITIONAL_FORMAT",
 target: {context: [{dimensionId: "20000000012", selectedItem: <lineItemId>}], types: ["DATA"]},
 source?: {context: [{dimensionId: "20000000012", selectedItem: <lineItemId>}]},
 options: {type: <BG_COLOR|FONT|MORSE|SLOT>, pegs: [{value, color}]}}
```

- Calculated (variance) columns target `target.columns.set` instead of `context`.
- `DNt` (1438277) keeps a formatting entry only when it has an `options.type` and at least two pegs, each with a colour and a numeric value.
- A missing `options.type` becomes `BG_COLOR` (`G_t` 1041321).
- Other customization types, from `zs` (949188), are `NUMBER_FORMAT`, `FORMAT_LINKS_AS_IMAGES`, `FORMAT_TEXT_AS_RICH_TEXT` and `COMPARISON_BIAS`. `COMPARISON_BIAS` takes `INCREASE_IS_GOOD` or `INCREASE_IS_BAD`.

**Grid `customizations`.** On `TABLE` cards this is a JSON string (`yJt` 2111401). It holds per-line-item `FORMAT_LINKS_AS_IMAGES` and `FORMAT_TEXT_AS_RICH_TEXT` entries of the form `{type, target: {context: [{dimensionId: "20000000012", selectedItem: <lineItemId>}]}}` (written at 2034229). It never holds ADQ formatting rules.

## 2. KPI formatting and indicators

### Stored fields

**Traced in both bundles.** The `CARD` serializer is `qQt` (2106961; report `yft` 1909177):

```text
cfTargetIdentifier: e.conditionalFormatting?.targetIdentifier,
cfSourceIdentifier: e.conditionalFormatting?.sourceIdentifier,
...$Wt(e.conditionalFormatting),
conditionalFormatting: e.conditionalFormatting ? lue(e.conditionalFormatting) : void 0,
config: e.config
```

| Field | Written from | Notes |
| --- | --- | --- |
| `cfTargetIdentifier` | `conditionalFormatting.targetIdentifier` | The KPI's own line item: the panel sets it from `targetLineItemContext.id` (`_Y` 2883102). |
| `cfSourceIdentifier` | `conditionalFormatting.sourceIdentifier` | "Value" line item. It defaults to the target. |
| `cfMinValue`, `cfMinColor` | `pegs[0]` | The value is a **string** (`toString`, `$Wt` 1921285). |
| `cfMidValue`, `cfMidColor` | `pegs[1]` | String |
| `cfMaxValue`, `cfMaxColor` | The **last** peg, only when there are more than two pegs | String |
| `conditionalFormatting` | `{sourceIdentifier?, targetIdentifier?, pegs?: [{value?, color?, colorTheme?}]}` | **Keeps every peg and `colorTheme`** (`lue` 1921646). This field was not in the brief. |
| `config` | Stored unchanged, as an object | Described below |

**Reading.** The deserializer `QQt` (2107567) takes `conditionalFormatting ?? FWt(flat fields)` (`FWt` 1921899). `PWt` (1921060) parses the flat strings with `parseFloat`. `config ?? {}` falls back to an empty object, and an empty `config` means the defaults below. With more than three pegs, the flat fields keep only the minimum, the first midpoint and the maximum.

**Not stored.** The KPI data query sends `{type: "simple", targetIdentifier, sourceIdentifier, pegs}` (`MSn` 2893118). It does so only when both identifiers are set and the pegs are valid and ascending. `simple` is a query-time type.

### `config`

**Traced.** A new KPI card gets these defaults (`KB` case `CARD` 3773587; `D1e`/`k1e` 2866566; report 2699751):

```text
config: {
  conditionalFormatting: {targets: ["INDICATOR"]},      // subset of "TEXT", "INDICATOR" (mb 905597; report Vg 650536)
  iconIndicatorType: "THRESHOLD",                       // "THRESHOLD" | "TREND" (Ba)
  trendIndicatorConfig: {referenceLineItemId?: <lineItemId>,
    icons: {greaterThanReferenceIcon: "ARROW_TRENDING_UP",
            equalToReferenceIcon: "ARROW_TRENDING_STABLE",
            lessThanReferenceIcon: "ARROW_TRENDING_DOWN"}},
  thresholdIndicatorConfig: {icons: [{index: 0, iconId: "CIRCLE_FILLED"}, {index: 1, …}, {index: 2, …}]}
}
```

| Field | UI | Semantics (traced in viewer `G1e`, near 2902100) |
| --- | --- | --- |
| `conditionalFormatting.targets` | "Apply conditional formatting to": Text, Indicator | `TEXT` colours the value with the rule colour. `INDICATOR` shows the icon. An empty `config` uses `["INDICATOR"]`; a non-empty `config` without `targets` means `[]`. |
| `iconIndicatorType` | "Threshold Indicator" or "Trend Indicator" | `THRESHOLD` (`gjn` 2898760): the icon at the first index `i` whose peg value is ≥ the KPI value; otherwise the last icon. `TREND` (`pjn` 2898563): compares the KPI value with the reference line item's value and picks the greater, equal or less icon. |
| `thresholdIndicatorConfig.icons` | One icon picker per peg | `{index, iconId}`. `P1e` (2882803) pads the list to the peg count with `CIRCLE_FILLED`. |
| `trendIndicatorConfig.referenceLineItemId` | Reference line item, limited to number line items (`mSn` 2879142) | |

The icon IDs (`td` 2866827) are `CHEVRON_UP`, `CHEVRON_STABLE`, `CHEVRON_DOWN`, `ARROW_TRENDING_UP`, `ARROW_TRENDING_STABLE`, `ARROW_TRENDING_DOWN`, `TRIANGLE_UP`, `CIRCLE`, `TRIANGLE_DOWN`, `TRIANGLE_UP_FILLED`, `CIRCLE_FILLED`, `TRIANGLE_DOWN_FILLED`, `SUCCESS`, `WARNING`, `ALERT`, `ARROW_UP`, `ARROW_DOWN` and `NO_SELECTION` (no icon).

- The indicator controls exist only with flag `enableKPIConfigV2`. Without it, the panel edits pegs only.
- Reset writes `conditionalFormatting: {}` plus the default `config` (`sb` 2867414).
- At run time, the colour comes from the service cell's `cf.cfg.color` and the pegs come from query metadata (`Ajn` 2904134).

## 3. Action button types and fields

### Stored `type` values

**Traced in both bundles.** The sources are the enum `Yn` (2337677; report `Pt` 2052370) and the render registry `xv` (2760514; report `I0` 2480212). A button renders only when its `type` is a registry key with a `RunActionButton` (`J_n` 2761221; report 2480920).

| Stored `type` | Added in Page Builder through | `id` refers to | Gate |
| --- | --- | --- | --- |
| `IMPORT`, `EXPORT`, `PROCESS` | Model action lists | Model action; numeric (observed, relayed) | None |
| `BULK_COPY`, `ASSIGN`, `COPY_BRANCH` | Service action lists: `GET …actions-service/customers/{customerId}/actions?workspaceId=…&modelId=…`, each type with its own `Accept` (2343753, 2345076, 2350812) | Action in the collaboration actions service | None |
| `INTEGRATION` | "Integrations" list (`…actions-service/actions?modelId=…`) | Integration action (CloudWorks is **inferred**) | None |
| `FORECASTER` | "Forecast" list | Forecaster action; 32-hex (observed, relayed) | Entitlement `forecaster` |
| `WORKFLOW_TEMPLATE` | "Workflow templates" list | Workflow template `guid`; a GUID (observed, relayed) | Entitlement `workflow` or `dms` |
| `NOTIFICATION`, `WRITEBACK` ("Data write"), `NAVIGATION` ("Navigation link"), `FORM` ("Create") | Create menu; a wizard creates the action in the actions service | The created action | None |
| `DMS_EXTRACT`, `DMS_LINK` | Create → "Data Orchestrator" | DMS action (`Fhn` 2519655; report `jjt` 2239426) | Entitlement `dms` |
| `DATA_ORCHESTRATOR` | Has a runner, but the create flow stores `DMS_*` | — | Whether it is ever stored is **unknown** |
| `EXAMPLE` | Test action | — | Flag `exampleActions` |

- **These are not button types:**
  - `ACTION_DRIVER`, `RENAME_ACTION` and `exportCurrentView` are modal keys.
  - `ASSIGN_ONLY` is an `ASSIGN` metadata subtype. It is in `Yn` but has no registry entry.
- **Traced absence:** there is no `DELETE`, `OPTIMIZER` or other delete or optimizer type in either enum or registry. Model action lists load only imports, exports and processes.

### Button fields

**Traced in both bundles.** The serializer `SQt` (2100272; report `eft` 1902387) maps the client `{actionId, label, description, actionType, ...rest}` to `{id, name, type, description, ...rest}`. It writes that array both to `actionButtons` and, stringified, to `actions`. The deserializer `jQt` (2101287) reads `actionButtons` when present and otherwise parses `actions`.

| Field | Set by | Meaning | Level |
| --- | --- | --- | --- |
| `runAutomatically` | Manage menu, `IMPORT`/`EXPORT`/`PROCESS` only (`uhn` 2501364) | "Run steps automatically". `null` or absent means **true** (2407300; default 2407880). When on, the run dialog starts without confirmation if nothing needs input (`l9` 2654599). An `EXPORT` always qualifies. An `IMPORT` qualifies with no file or mapping prompt (2404348). A `PROCESS` qualifies with no file, mapping or parameter prompt and no validation error (2405600). | Traced |
| `disableCancelButton` | `PROCESS` only | "Disable cancel button": cancel is unavailable while the process starts or runs (2407442). | Traced |
| `actionDriverId` | "Select a driver line item"; action-card buttons only, not `widgetActions` or templates (2503133) | GUID of an action-driver record `{moduleId, lineItemId}` in the collaboration actions service (`createActionDriver`, 2350152). The button is enabled only while that line item's cell reads `"true"` in context (`Dun` 2395990; report `ISt` 2114770). Otherwise it is disabled with the message "You do not have permissions to use this action…". A driver whose metadata is missing also disables the button. | Traced |
| `style` | Style panel and button options | `{sourceType: "icon"\|"model"\|"direct"\|"library", icon, iconPosition: "left"\|"right", fillType, color, colorTheme, imageSource, imageName, dataSourceId, lineItemId}` (`Uhe` 2510388, `oEn` 2762393) | Traced |
| `moduleId`, `lineItemId` | `WRITEBACK` (2536490) and `NOTIFICATION` (2716829) buttons | The line item the action writes or keys on | Traced |
| `actionToken` | Never created by the client; carried through `...rest` | The only reader is the `WORKFLOW_TEMPLATE` runner, which sends it as `X-Action-Token` with `X-Page-Id` (2352095, 2752273). That the service issues it per page is **inferred**. Treat it as a secret. | Traced use |
| `destinationListId` | Nowhere in any client file | A service-side field. `ASSIGN` metadata has `sourceList` and `destinationList` (`Edn` 2359628), so a relation to `ASSIGN` is **inferred**. | Unknown |

The observed `null` values for `runAutomatically`, `actionDriverId`, `destinationListId`, `style` and `description` are **inferred** to be service defaults.

**Contradiction with a capture (relayed).** A newer card's `actions` string holds only `{id, name, type}`, while its `actionButtons` hold tokens. `SQt` writes identical arrays, so another writer or the service rewrote that string. The earlier capture had tokens in both places, which matches this client carrying service-provided `actionButtons` through a save.

**Card layout.** The default `actionWidgetStyle` is `i4` (2337156): `{layoutType: "BUTTON", directionType: "HORIZONTAL", spacingType: "MEDIUM", alignmentType: "CENTER", optionalComponents: {image, chevron, text}, titleColor, descriptionColor, chevronColor}`, each colour with a matching `*ColorTheme`.

## 4. `widgetActions`

**Traced in the client serializer only.**

- **What it is.** Card-level actions appear in any card's toolbar menu. At run time, `getWidgetActionsWithExportActionsWithGuid` (960846) prepends local export actions and a `{rule: true, …}` separator. Neither is stored.
- **Allowed types.** Only registry entries with a `RunActionMenuItem` qualify (`eEn` 2761221): `IMPORT`, `EXPORT`, `PROCESS`, `FORM`, `NAVIGATION`, and `EXAMPLE` behind a flag. The add panel `e9` (2504841) writes to `widgetActions` instead of `actions` when `inWidgetActions` is set.
- **Element shape.** `kc` (2099656) and `Pc` pass `widgetActions` through unchanged, so elements keep the client keys `{actionId, actionType, label, description?, runAutomatically?, disableCancelButton?}`. A model-action toggle appends `{actionId, actionType, label}` (2505173).
- **Limits.** Driver line items and reordering are not offered (2503133).
- **Service shape.** Unobserved; the capture held only `[]`.

## 5. Saved-view grid cards

| Question | Answer | Level |
| --- | --- | --- |
| What is stored? | Choosing a view writes `{dataSourceId: <viewId>, widgetDataSources: lg(<viewId>)}`, which is `[{dataSourceId: <viewId>, dataSourceType: "CLASSIC"}]` (`lg` 1455475; `TABLE` panel 3684460; report `xh` 1319079). An ID containing `view:` becomes `CUSTOM_VIEW` instead. | Traced; observed (relayed) |
| Is there an ADQ? | No. A grid built in Page Builder gets `ql(<id>, <adq>)`, which is `MULTI_AXIS_DESCRIPTION` with the query inline (1456141). | Traced |
| Default view or saved view? | The client does not distinguish them when writing: both are `CLASSIC` with the chosen ID. The module-ID prefix rule exists only in the Page details summary ([card details](card-details.md) §4). | Traced |
| Are pivots, filters or sorts stored? | Not in the definition. For single-`CLASSIC` cards (`Are` 1007129), user sorts, show/hide, levels, zero suppression and breakback become transforms kept in browser storage (`Is`/`EF` 2142260/2141885; for example 3630143). The card keeps only flags such as `pivotEnabled` and `isReadOnly`. | Traced |
| What other card fields appear? | `customizations` and `lineItemConfigs` are JSON strings that can still appear; they hold image and rich-text flags per line item. `branchSync` is a JSON string or is omitted (`yJt`). | Traced |
| Which fields does the service fill? | `subEntityId: ""`, `axisDescriptionQuery: null`, `viewDescription: null` | Observed (relayed); the client does not write them |

## 6. Model metadata endpoints used by Page Builder

**Traced in `designer.js`.** The report bundle contains the same client, and the same destinations and `widget/model` accept type were found in it by text search.

### Transport: a STOMP socket, not REST

Page Builder reads module, view, line-item and list names over one WebSocket connection. A sweep of the designer's REST wrappers found none for modules, views, line items or lists.

| Aspect | Traced detail |
| --- | --- |
| Socket | `wss://<host>/a/springboard-widget-data-service/ws?tracePath=…&clientVersion=…&clientSessionId=…`: `bft` (877757), query parameters (885978), `servicePath` (4651596), `API_URL: "/a/springboard-"` (72374). No token is added, so the browser session authenticates it (**inferred**). After a failed connection the client checks the session with `POST …/widget-data-service/authTokenVerify`. |
| Connect | STOMP `CONNECT` with `enabled-features`, `accept-language`, `close-mode: error-frame` and `anaplan-customer: <customerGuid>` (882483). |
| Redirect | An `ERROR` frame carrying `REDIRECTION_REQUIRED` and an `fqdn` makes the client reconnect to that host (884012). |
| Request | `SUBSCRIBE` with a `core://<workspaceId>:<modelId>/…` destination and an optional `accept` header (`Yft` 889720). Then `SEND` with `action-type: update-subscription` and `subscription-revision`, whose body is the JSON options object (`qft` 889911). |
| Response | `MESSAGE` frames with a `message-type` header. The payload types are `update` (exposed as `json`), `metadata`, `context-filters`, `view-info` and `subscription-settings` (`Jft` 890883). `unchanged`, `error` and `action-status` are handled separately (`Mb` 887572, `cn` 893500). |

### Destinations

| Purpose | Destination | Options body | Response keys (id, name) | Caller |
| --- | --- | --- | --- | --- |
| **Model status** | `core://{ws}:{model}` with `accept: widget/model` | `{}` | `{status: "NO_SUCH_MODEL"\|"LOADING"\|"READY"\|"BUSY"\|"CLOSED", reason}` | `rbt` (946582); status banner (2845466) |
| **Modules, saved views and dimension names** | `core:/{ws}:{model}/moduleViews` (one slash in the source) | none | `data[] = {id, name, views: [{viewId, viewName, default}]}`; `dimensions = {<dimensionId>: {label}}` | View designer (`vVt` 1873508, `EVt` 1873134, `DFt` 1776162). `EVt` replaces a default view's name with the UI string "Default view". |
| Modules | `core://{ws}:{model}/modules` | none | `data[] = {id, label}` | Field card (`xWt` 1909085) |
| **Line items of a module** | `core://{ws}:{model}/modules/{moduleId}/lineItems`, optionally with `?format=number`, `?format=text`, `dataType=…&textType=…` or `&fullAppliesTo=` | `{}` | `data[] = {lineItemId, lineItemLabel, lineItemInfo: {format: {dataType, textType, …}}}` | Pickers (`zRt` 1403262), conditional formatting (`PGt`), KPI |
| Modules that use given dimensions | `core://{ws}:{model}/applicableModules` | `{dimensions: [<dimensionId as number>]}` | `data[] = {id, label}` | Filter-rule module picker (`T6t` 1662169) |
| Dimensions of modules | `core://{ws}:{model}/dimensions` | `{moduleIds: [<moduleId>]}` | `modules[<moduleId>].dimensions[] = {id, label}` | 1979264 |
| **Lists** | `core://{ws}:{model}/lists` or `…/lists?subsets=true` | none | `data[] = {id, name}` | `YCn` (2696788), `Exn` (2574739) |
| **Labels of items** | `core://{ws}:{model}/modules/{moduleId}/dimensions/{dimensionId}` with `accept: widget/selection` | `{itemIds: [<itemId>…], filter?, axisDescription?}` (`_R` 945547) | `data[]` of selections, each with a `label`. `Rc` (945835) asks for one item. | Filter-group chips (`EOn` 3199618) |
| List items | `core://{ws}:{model}/lists/{listId}/items`, optionally `?properties=true` | `{}` | Tree items, with `accept: widget/tree_item` (950472); keys not traced | Assign and navigation |
| View or module grid data | `core://{ws}:{model}/views/{viewId}[?…]` (`pNt` 1435052) and `core://{ws}:{model}/modules/{moduleId}` | Transforms | Grid cells plus `contextFilters` | Data; not needed for naming |

- **Model open.** The client has no open-model step (traced absence). The status destination reports `LOADING` while the service initializes the model, and the UI shows "Initializing the model", "Model is busy" or "We could not connect to the model". A tool should subscribe to the status and wait for `READY`. That a subscription triggers the model load is **inferred**.
- **GET-only.** Not applicable: none of these is an HTTP request. The read destinations need only `SUBSCRIBE`, `update-subscription` and `UNSUBSCRIBE`. The same socket also carries writes: `SUBMIT_VALUE`, `CHANGE_PARENT` and `DELETE_ITEM` actions (`Nb` 946794), and a `/deleteListItems` destination. A read-only tool must send no other action types.
- **Related REST call.** `getFQDN` on `platform-gateway-service` (`workspaces/{ws}/models/{model}/fqdn`, base at 2176624) exists, but it was not traced into the socket setup.
- **Stability.** These are internal, undocumented contracts, so exact strings may change between releases. The service or a client normalizer accepting the single-slash `core:/` spelling is **inferred**.

## Open questions

1. Do version 2 reads return `targetRegion` or `targetRegionCoordinates`? Capture a merged grid with a rule on a second region.
2. Does the service keep peg `colorTheme` in grid rules and in KPI `conditionalFormatting.pegs`?
3. Which stored rule type produces the viewer's `sausage` style? Confirm the four inferred type-to-style mappings.
4. What populates `destinationListId`, and for which button types?
5. Which key names does the service return for `widgetActions`: the client form, or `id`/`name`/`type`?
6. Is `DATA_ORCHESTRATOR` ever stored as a button type? What rewrote the token-free `actions` string?
7. What formatting shape does a non-numeric source get once `nonNumericConditionalFormatting` ships?
8. What does a browser-only tool need to use the section 6 destinations: is the page's session cookie enough, and what `CONNECT` headers are required? What keys do list items use? Does `moduleViews` list a module's default view with `viewId` equal to the module ID, so that default-view `CLASSIC` IDs resolve through the same lookup? No call was made here.
