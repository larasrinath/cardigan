# UX card details: sources, grid queries and card settings

Research date: September 27, 2026. [Definitions (SAM)](https://github.com/larasrinath/anaplan-sam/blob/main/docs/research/ux-designer/definitions.md) | [Contracts (SAM)](https://github.com/larasrinath/anaplan-sam/blob/main/docs/research/ux-designer/contracts.md) | [Coverage register (SAM)](https://github.com/larasrinath/anaplan-sam/blob/main/docs/tool-catalog/ux-designer-coverage.json)

> **Copied from SAM.** This note was written in SAM (anaplan-sam, `docs/research/ux-designer/`), whose card reader Cardigan shares in [`src/card-reader/`](../../src/card-reader/). Its companion notes, SAM's source files and the archive paths below (`docs/plans/…`, `.sam/…`, Git-ignored) are in SAM's repository, not here.

> **Superseded in part:** [Page Builder card formats](card-formats-designer.md) traces the designer bundles of the same date. Its findings replace sections 3 (conditional-formatting types: `BG_COLOR`, `FONT`, `SLOT` = Border, `MORSE`), 5 (KPI formatting and indicators) and 7 (action button types), and refine section 4 (saved-view grids).

This note supports a read-only tool that describes each card on a board, worksheet or report. It traces the fields that one captured board definition does not explain. The work read archived public JavaScript as text only and one previously captured board definition. **No Anaplan service, model, browser session or MCP tool was used, and no bundle was executed.** No identifiers, names or tokens from the capture appear here. Placeholders such as `<moduleId>` stand in for them.

## Sources

| Archive | Public source | SHA-256 | Used for |
| --- | --- | --- | --- |
| `docs/plans/browser-api-sources/app-shell.js` | [`/a/apps/` shell](https://us1a.app.anaplan.com/a/apps/assets/index-BhLlXpVf.js) | `edba134eeba2e13e05bb94ad5458d0878c2ac966f65034245e629dd9d253a813` | Card viewer library: axis-description helpers, per-user customisations, context options, chart settings, grid renderer |
| `docs/plans/model-building-sources/modeling.js` | [Modeling UI](https://us1a.app.anaplan.com/a/modeling-ui/assets/index-Bgn-bBJZ.js) | `7fb0edcbaa81873bad78c19135622d2723c69ef785171fd9063bbfbfab59bf69` | The same shared card library at other offsets, plus the Pages list and **Page details → Modules** panel |
| `docs/plans/model-building-sources/translations.en.js` | [Modeling UI strings](https://us1a.app.anaplan.com/a/modeling-ui/assets/translations.en-D6blp6aW.js) | `5ec3c07a7c6187363238bbb0487d1464def848b9c4256514c039d7c5de61457c` | English labels for Page details |
| `.sam/ux-pages/hc18-board.json` (Git-ignored) | One board read back by SAM | — | Observed shapes only |

Both `vendor.js` archives were searched and contain none of these contracts. The Page Builder designer bundles (`designer.js`, `report.js` in [definitions.md](https://github.com/larasrinath/anaplan-sam/blob/main/docs/research/ux-designer/definitions.md)) were **not present in SAM's working tree**. Designer-only behaviour is therefore unknown here unless definitions.md already traced it.

**Offsets** are zero-based UTF-16 indices (`source.slice(offset)`), as in definitions.md. These archives contain non-ASCII text, so `grep -bo` byte offsets are larger. Every offset below was recomputed from a unique substring. Minified names apply only to these snapshots. The shared library appears in both bundles; app-shell offsets are primary.

## Evidence levels

- **Observed (capture):** present in the captured board definition.
- **Observed (UI):** reported by the user from the live Page Builder on September 27, 2026. This was relayed, not captured.
- **Traced:** read in bundle code at the cited offset.
- **Inferred:** consistent with traced or observed evidence but not established. Every inference is labelled.
- **Unknown:** no evidence available offline.

## Key points for an extractor

1. Grid content lives in `widgetDataSources[0].axisDescriptionQuery` (ADQ). This covers the module, axis arrangement, filters, sorts, show/hide, levels, totals and conditional formatting. Detect the version as the client does:
   - Use `version` (1 or 2) when it is present.
   - Otherwise, a non-array object `regions` means v1, and a present `rowAxis` means v2.
   - Treat anything else as unknown.
2. Filters can use line items from **other modules**. The module is not stored in the rule. The `pdi` (`x-api-version: 2`) dependency summary warns that it omits modules used as filters or by action cards; whether the `derived` summary includes them is unknown. Parse ADQ filter leaves; do not rely on either summary.
3. Per-user pivots, filters and sorts are browser-side customisations and never appear in the page definition.
4. `actionToken` appears twice on action cards, including inside the `actions` JSON string. Redact both.

## 1. `axisDescriptionQuery` schema

### Versions

| Evidence | Code | Level |
| --- | --- | --- |
| app-shell 1585955, 1586066 | `vo=e=>{if(e.version)return e.version===1;const t=e.regions;return typeof t=="object"&&!Array.isArray(t)}`, `er=e=>e.version?e.version===2:e.rowAxis!==void 0` | Traced |
| app-shell 908859, 908909; modeling 888686 | `La` = `{v1:1, v2:2}`; `const Je="SINGLE"` (modeling `_t="SINGLE"`) | Traced |
| Capture | `version: 1`; only `regions.SINGLE` | Observed (capture) |

`Ps()` returns `{version, typedAdq}`. Every getter branches on it.

### Version 1 (observed and traced)

```text
axisDescriptionQuery = {
  id: <guid>,                          // equals widgetDataSources[0].dataSourceId and card dataSourceId (observed)
  version: 1,
  regions: {
    SINGLE: {
      rows:    { dimensions: [<dim>], filters: { rootNode }, raggedShows: [], raggedHides: [] },
      columns: { dimensions: [<dim>], filters: { rootNode }, raggedShows: [], raggedHides: [] },
      offAxisDimensions: [<dim>],      // traced (pivot helper); absent in capture
      moduleId: <moduleId>
    }
  },
  conditionalFormattingRules: [<rule>],
  breakbackSelections: [],             // traced default (YEe 1588715); absent in capture
  zeroSuppression: <unknown shape>     // traced pass-through only (XA 1611423); absent in capture
}
<dim> = { id, levels: [], sorts: [], shows: [], hides: [], reorder: [], totalsPosition: "AFTER" }   // fve 1604955
```

An axis without filters holds `filters: {rootNode: {nodes: [], operator: "AND", type: "BRANCH"}}`. This was observed on the capture's unfiltered axis, and it is the same empty tree that `I0` (1604818) writes when it resets an axis. The v1 query sent for data is `{rowAxis, columnAxis, conditionalFormattingRules, zeroSuppression, breakbackSelections, moduleId}` (`XA`, 1611423; modeling equivalent 1042282). The capture has no `offAxisDimensions` key. Module dimensions that are on neither axis still appear as card `contextOptions`: a Line Items option scoped to the grid's module was observed. Page Builder may omit off-axis dimensions entirely; this is **inferred**.

**Region keys besides `SINGLE`:** v1 `regions` is a map, and some helpers handle several keys. `_Te` (1592070) marks a v1 query as combined when it has more than one key. `dTe` counts keys, and `YEe` (1588715) and `bTe` iterate them. Most other v1 getters read only `regions[SINGLE]`. The names of any other keys are **unknown**.

### Version 2: the merged grid (traced only)

```text
{
  version: 2,
  rowAxis:    { childAxes: { <axisKey>: { dimensions: [<dim>], filters, raggedShows, raggedHides } } },
  columnAxis: { childAxes: { <axisKey>: { ... } } },
  regions: [ { id: <regionId>, rowAxisKey, columnAxisKey,  // or coordinates: [<columnKey>, <rowKey>]
               moduleId, offAxisDimensions: [<dim>] } ],
  conditionalFormattingRules: [...]
}
```

- `hve` (1604034) finds a module by axis key: `Object.values(i.regions).find(r=>r.columnAxisKey==t||r.rowAxisKey==t)?.moduleId`.
- `UEe` (1586905) reads `[e.coordinates?.[0]??e.columnAxisKey, e.coordinates?.[1]??e.rowAxisKey]`. `Lve` (1611115) converts a region ID to `{rowKey, columnKey}`.
- `aTe` (1590539) marks a v2 query as combined when it has more than one region and more than one child axis on either axis. `isMergedGrid` means one data source with a v2 query.
- Before querying, the client clears each region's `offAxisDimensions` and applies `reorder` to each child axis (`Rve`, `Ave`).
- Server grid metadata for these grids carries `regionInfos{<regionId>: {rowAxisKey, columnAxisKey}}` (`tbe` 1460658, `O_e` 1440671).

### Populated contents (traced)

| Field | Contents | Evidence |
| --- | --- | --- |
| `levels` | Level tokens, replaced wholesale from a `LEVEL_SELECTION_SET` transform's `selectedLevels`. Only `["LEAF"]` was observed, on a Time (`20000000003`) entry; other tokens are unknown. | `v0` 1598168 |
| `sorts` | `[{selectedItems: [<itemId>...], direction, axisKey?, isActive?}]`. The sort is stored on the only (v1) or innermost (v2) dimension of the axis being ordered. `selectedItems` is the header coordinate on the opposite axis, split from `a:b` or `a,b`, with `"-1"` and `""` removed. Directions are `ASCENDING` and `DESCENDING`; `UNSORTED` removes the sort. In v2, a sort is matched on `axisKey`; what the key denotes is **inferred** to be the opposite child axis. | `MTe` 1595122, `OTe` 1594280, `oTe` 1589887, `Rc` 1212887 |
| `shows` | Item-ID array: show only these items. | `FTe` 1596947 |
| `hides` | Item-ID array; new items are appended. | `FTe` |
| `reorder` | Ordered item-ID array. When non-empty, it is sent as `shows`. | `Dc` 1609925 |
| `raggedShows`, `raggedHides` | Array of `{<dimensionId>: <itemId>, ...}` tuples, one per nested combination. Each applies to the dimension at depth equal to its key count. | `lC` 1605200, `HTe` 1596734 |
| `totalsPosition` | `GROUP_START`, `BEFORE`, `AFTER` or `GROUP_END`; the default is `AFTER`. | `bo` 1586527 |
| `offAxisDimensions` | Dimension entries for page dimensions. | `HEe` 1586187 |

## 2. Filters

**Observed (capture):** one row filter.

```text
rows.filters.rootNode = { type: "BRANCH", operator: "AND", nodes: [
  { type: "BRANCH", operator: "AND", nodes: [
    { type: "LEAF", rule: { selectedItems: [<listId>, <lineItemId>], operator: "NOT_EQUALS",
                            values: ["0"], identifier: "", axisKey: null } } ] } ] }
```

The columns axis held the empty default. The `<listId>` is also the `dimensionId` of one of the card's page-synced `contextOptions`; it is not the rows dimension. The `<lineItemId>` belongs to another module, which the rule does not store.

**Observed (UI):**

- The Filter panel has Rows and Columns tabs. Each axis dimension offers "Show items that match: All | Any".
- Each rule has a module selector, a line-item selector, an operator ("Is not equal to" for `NOT_EQUALS`), a value and "Filter context (- current -)". "Add rule" adds another rule.
- The saved rule matched the capture: `[<list ID of the filter line item's other dimension>, <filter line item ID>]`.

**Traced:** the viewer bundles contain only the empty default tree (`"BRANCH"` at app-shell 1604942; modeling 1035475). No code in them builds, reads or evaluates `LEAF` rules. The server evaluates the tree.

| Question | Answer | Level |
| --- | --- | --- |
| Where do filters live? | `rows.filters` or `columns.filters` of the axis being filtered (v1). Each v2 child axis has its own `filters`; the per-child-axis reset `FEe` uses `I0`. Rows and columns use the same shape. | Observed, traced |
| How are several conditions stored? | The root `BRANCH` holds inner `BRANCH` groups whose `nodes` are `LEAF` rules. Inner `operator` is `AND` for "All". "Any" is reported to map to `OR`. | `AND` observed (capture). `OR` is a UI-reported mapping; the stored literal is not captured or traced. |
| Inner group per axis dimension? | Probably one inner group per filtered axis dimension. How a group identifies its dimension on nested axes is **unknown**; `identifier` or order are candidates. | Inferred |
| `selectedItems` | The last element is the filter line item. Earlier elements are the filter context for the line item's other dimensions; a list ID means "current", following the page or card selection. | Inferred (UI + capture) |
| Fixed, non-current context | Encoding **unknown**. An item ID in place of the list ID is plausible but unverified. | Unknown |
| `operator` | `NOT_EQUALS` observed. No other ADQ operator names appear in these bundles. | Observed; rest unknown |
| `values` | Strings (`["0"]`). The rule has no `dataType`; typing is presumably server-side. | Observed; inferred |
| `identifier`, `axisKey` | `""` and `null` observed. `axisKey` probably addresses a v2 child axis, by analogy with v2 sorts. | Unknown or inferred |

Only `AND` (BRANCH) and `NOT_EQUALS` (LEAF) are known operator strings. An extractor should report any other `operator` value verbatim rather than reject or translate it.

For comparison, the classic-view transform in both bundles is `ADVANCED_FILTER: {rows: {matchType: "ALL", filterConditions: [{context: [<dimensionId>...], lineItemId, values: [], operator: "IS_NOT_BLANK"}]}}` (modeling 1717240). Its `context` is also a list of dimension IDs. It is a different contract and supports the `selectedItems` reading only by analogy.

## 3. Conditional formatting

**Observed (capture):** one rule at ADQ top level.

```text
conditionalFormattingRules: [{ type: "SLOT", sourceIdentifier: <lineItemId>, targetIdentifier: <same lineItemId>,
  pegs: [{ value: <number>, color: "#RRGGBB" }, { value: <number>, color: "#RRGGBB" }],
  targetRegionId: null, targetRegionCoordinates: null, valuesRegionCoordinates: null }]
```

**Traced client handling:**

- `ZA` (1610164) upper-cases every rule's peg colours to `#RRGGBB` and otherwise passes rules through to the data query (`XA`). Charts receive them through `S1` (1610242).
- No client code reads `type`, `sourceIdentifier`, `targetIdentifier` or the region fields. Rules are evaluated server-side.
- The value is an array, so a grid can carry several rules. Any per-grid limit is unknown.

**Traced server output per cell:** `cf: s.cf||s.conditionalFormatting` normalised to `{t, cfg}` (1233977). The render types are `Ni = {FONT:"font", MORSE:"morse", BACKGROUND_FILL:"fill", SLOT_FILL:"slot"}` (1212801), plus `"sausage"`.

- `fill` and `slot` set the cell background from `cfg.color`; `slot` also adds a slot CSS class, except on image cells.
- `font` sets the text colour.
- `morse` and `sausage` draw a bar of width `cfg.normalizedValue` from 0 to 1 (`rge` 1231956, 1234712).
- This grid renderer's conditional-formatting path has no icon branch. A different presenter elsewhere cannot be ruled out.

**Inferred:**

- A `SLOT` rule yields `slot` cells.
- `pegs` are value-to-colour stops evaluated on `sourceIdentifier` and painted on `targetIdentifier`.
- The region fields address v2 regions.

**Unknown:** other stored rule `type` names and the region-field shapes.

Charts expose `scatterBubble.withConditionalFormatting`, `gantt.withBarCF` and `gantt.withMilestoneCF`, and a series "prefer conditional formatting" toggle (`Ch`, near 1691677). These names are traced; their semantics are inferred.

## 4. Data source types

**Traced enums:**

- `Ow` (app-shell 908675) and `Gl` (modeling 888452): `CLASSIC`, `CUSTOM_VIEW`, `LINE_ITEM`, `VIEW_DESCRIPTION`, `MULTI_AXIS_DESCRIPTION`.
- `As` (modeling 2012560): `SAVED_VIEW`, `DEFAULT_VIEW`, `CUSTOM_VIEW`, `LINE_ITEM`. The Page details panel derives these on the client; they are never stored in cards.

**Observed entry keys:** each `widgetDataSources[]` entry has `{widgetGuid, dataSourceId, subEntityId, dataSourceType, axisDescriptionQuery, viewDescription}`.

| Type | Stored identity | Module resolution | Level |
| --- | --- | --- | --- |
| `CLASSIC` placeholder (TEXT, ACTION) | `dataSourceId: ""`, `subEntityId: ""` | None | Observed |
| `CLASSIC` data card | `dataSourceId` holds a module ID (default view) or a saved-view ID | The summary consumer `oGe` (modeling 2053136) treats an ID with `floor(id/1e9) === 102` as `DEFAULT_VIEW` (`E1` 70423; `Ce` 65035: 101 list, 102 module, 114 line-item subset, 115 dashboard). Otherwise it treats the ID as `SAVED_VIEW` and resolves it through the model's view list (`qUe` 2051051). | Traced in the summary consumer; inferred for card definitions |
| `LINE_ITEM` | `dataSourceId: <moduleId>`, `subEntityId: <lineItemId>` | If the module is `0`, the summary finds it from line-item maps (`YUe` 2051323). | Observed (IMAGE); traced |
| `MULTI_AXIS_DESCRIPTION` | `dataSourceId` is the ADQ `id`; the query is inline | `regions.SINGLE.moduleId` (v1) or `regions[].moduleId` (v2) | Observed; traced |
| `CUSTOM_VIEW`, `VIEW_DESCRIPTION` | The card-side shape is **unknown**. `viewDescription` is only passed through opaquely to the grid subscription (994429). | The summary uses the reported `dataSourceId` as the module ID (`QUe` 2051999, `DR` 2052061). | Traced (summary only) |

`isSavedModuleView` means exactly one `CLASSIC` source (`UA`, 1603074). The identifier used for transforms is the ADQ `id` when present, otherwise `dataSourceId` (`ETe`).

**References that need a second read:**

- A saved-view `CLASSIC` source needs a view-to-module lookup. SAM's Integration reader can already list views per module.
- A `LINE_ITEM` source with module `0` needs a line-item-to-module lookup.
- Saved widget references (`widgetGuid`) are materialized in the board read (observed). The wrappers offer no single-widget GET, only `POST widgets` and `PUT widgets/{guid}` (modeling 32937). `GET widget-templates/{id}` is for library templates.
- All model entity names need the Integration API.

**Unknown:** loaders branch on `dataSourceId.startsWith("view")` (`QTe` 1601029). Which cards carry such IDs is not established.

## 5. KPI, field, chart and other card types

| Card | Binding | Level |
| --- | --- | --- |
| `CARD` (KPI) | Module plus line item: a `LINE_ITEM` source. Not present in these bundles; see definitions.md (`fQt`, `dQt`, `ble`). | Traced earlier (designer) |
| `FIELD` | `fields: [{moduleId, lineItemId, label}]`, matching its sources. From definitions.md; SAM's `bindings.ts` enforces it. | Traced earlier (designer) |
| `COMBOCHART` | The card `dataSourceId` and source, plus a serialized `chartConfig` JSON string. The string storage comes from SAM's implementation (`definition-editor.ts`, around line 283), which rests on earlier designer tracing; these bundles show only the settings keys. | SAM implementation (designer-traced); keys traced |
| `MAP`, `PRESENTATION_TABLE` | Named only as Page details widget labels (modeling 2035501). `PRESENTATION_TABLE` is also a grid theme (app-shell 1212022), which suggests a grid-backed card. | Binding unknown; inferred |
| `SHAPE`, `HIERARCHY`, `NETWORK`, `WEB_XL` | No card code in these bundles. `WEB_XL` hits are `/xlweb` routes; `HIERARCHY` hits are entity constants. | Unknown |

**`chartConfig` keys (traced in the shared chart settings):**

- `chartType` from `Ee` (1576639): `areachart`, `barchart`, `columnchart`, `combochart`, `donutchart`, `dotchart`, `ganttchart`, `linechart`, `piechart`, `scatterbubblechart`, `waterfallchart`.
- Presentation: `chartColors`, `chartFontSize`, `legendPosition` (`bottom`, `top`, `left`, `right`, `hidden`, `top-right`, `top-left`, `bottom-right`, `bottom-left`), `showDataLabels`, `showTooltips`.
- Series: `series`, `globalSeriesOptions`, `defaultComboSeriesType`, `columnStacking`, `markersSize` (reset together at 1712627).
- Axes: `primaryAxisScaleType` with its min and max, the matching `secondaryAxis*` keys, and axis titles, prefixes, suffixes and decimals.
- Chart-type blocks: `scatterBubble{…}`, `gantt{withBarCF, withMilestones, withMilestoneCF}` and `waterfall{suppressZeros, includeIntermediateTotals, autoAxis}`.

**Series identity:** `chartConfig.series` is `[{id, ...overrides}]`, merged by `id` with the series headings returned by the data query. A single default series has ID `"0"`. That `id` is the series-axis item ID, such as a line item, is **inferred**.

**Charts and the ADQ:** charts use the card's ADQ only when it is v1: `axisDescriptionQuery:i&&w1.isAdqV1(i)?S1(i):void 0` (1647215). `S1` reads only `regions.SINGLE`. Data comes from `/subscriptions/core` (`A1` 1612035). `branchSync` becomes `hierarchyFilter` and `BRANCH_SYNC` transforms. `Owe` (1674715) dispatches on `chartType`.

## 6. Context options and page context

**Card `contextOptions[]`, traced** from the card context settings panel (app-shell 1009526–1011900) and defaults `kw` (908981):

| Field | Meaning |
| --- | --- |
| `dimensionId` and `scope` | Identity is the pair (`c1`). `scope` separates one dimension used by different modules. Observed: a Line Items (`20000000012`) option whose `scope` is the grid's module. |
| `visible` and `editable` | On-card appearance (`Wu` 908192): `OFF` is (false, false), `LABEL` is (true, false), `SELECTOR` is (true, true). |
| `syncedToPage` | "Sync to page". Switching it off stores the current item as `defaultValue` (1009776). |
| `syncOnSelection` | Selecting in this card updates the page context. Not offered for branch-sync filters. |
| `defaultValue`, `parentItem`, `ancestry` | The default item's ID, parent ID and ancestry, set from the picker (1009951). |
| `enableMultiSelect` | Not offered for Line Items (1009634). Disabled while `syncOnSelection` or `syncedToPage` is on. |
| `resolutionPolicy` | The UI offers `any` ("model default") and `parent`. The enum `Nn` (906944) also has `exact` and `ancestry`. `null` was observed. |
| `filter`, `selections`, `itemHierarchyLevels` | Passed to the selector's item query as `filters`, `selections` and `levels` (1016780). Their shapes are **unknown**. |

The `kw` defaults are: `visible`, `editable`, `syncedToPage` and `syncOnSelection` all true. Grid context filters are sent as `[{selectedItem, parent, parentItem}]` (1500052).

**Branch sync:** the card `branchSync` JSON string holds `[{dimensionId, allowSyncToLeafLevel, isEnabled}]` (`J_` 910436). The UI toggles are "hierarchyFilter" and "syncToLeafItem" (905615). Enabled entries become `{type: "BRANCH_SYNC", options}` transforms (`Hf` 1609823).

**Page level:**

- Observed values: `contextOptions: []`, `layout.defaultContext: []`, `layout.contextFilterOrder: []`, `layout.syncScroll: []`, `layout.syncBrowser: false`.
- These fields have no code in these bundles, so their semantics are **unknown**. From the names only, they are inferred to cover page selectors, default selections, selector order and synchronized scrolling.
- `widgetStyles.contextPlacement` was observed as `"BOTTOM"`. Enum `Wm` is `TOP` or `BOTTOM` (908927); the link between them is inferred.

## 7. Action cards

**Observed (capture):**

- `actionButtons[] = {id: <numeric action ID>, type: "IMPORT", name, actionToken, runAutomatically: null, actionDriverId: null, destinationListId: null, disableCancelButton: false, style: null, description: null}`.
- `actions` is a JSON string of the same array, with a different key order and the same values, **including `actionToken`**.
- `actionWidgetStyle = {layoutType: "BUTTON", directionType: "HORIZONTAL", spacingType: "MEDIUM", alignmentType: "CENTER", optionalComponents: {image, chevron, text}, titleColor, descriptionColor, chevronColor, <each>ColorTheme}`.
- Every card has `widgetActions: []`.

**Traced:** nothing. `actionButtons`, `actionToken`, `runAutomatically`, `destinationListId` and `widgetActions` do not occur in either bundle.

**Unknown:**

- Other button `type` values. `PROCESS`, `EXPORT`, `DELETE` and navigation are plausible but unverified.
- The meaning of `runAutomatically`, `actionDriverId` and `destinationListId`.
- The element shape of `widgetActions`.
- The purpose of `actionToken`. Treat it as a secret in both places. Never echo the raw `actions` string.

## 8. Navigation and image cards

**Traced** in the card overview panel (1036610; ADS variant 1039830). Choosing a target page writes `{pageIdentifier, pageName, pageType, pageAppIdentifier: <target app GUID>, isTargetPagePublished: <target has a published version>, pageLinkType}`. `pageLinkType` is `title`, `icon` or `none` (`Jn` 1028547). It defaults to `title` and is set to `""` when the link is cleared. The same object caps titles at 60 and descriptions at 300 characters.

**Observed (capture):** unlinked cards still carry `pageType: "NONE"` and `pageLinkType: "title"` and have no `pageIdentifier`.

**`navLinks`:** the insight panel had `navLinks: []`. Its element shape is **unknown**.

**Image cards:**

- Observed: `sourceType: "model"`, `dataSourceId: <moduleId>`, `lineItemId` and `scaleType: "scale"`, with a `LINE_ITEM` source.
- Other `sourceType` values and the external-URL field name are **unknown**; no image-card code is present.
- The bundles' `scaleType` is an unrelated chart-axis setting.

## 9. `lineItemConfigs`, `customizations`, `branchSync` and per-user state

| Card field | Observed | Traced | Status |
| --- | --- | --- | --- |
| `branchSync` | `"[]"` | JSON array of `{dimensionId, allowSyncToLeafLevel, isEnabled}` | Page Builder setting |
| `customizations` | `""` | `XA` accepts `customizations[]` and maps `target.regionId` to `regionCoordinates` (1611423). `A1` passes `[]`. | Link to this field unproven |
| `lineItemConfigs` | `""` | None | Unknown |
| `styleConfig` | `"{\"themeId\":\"Base\"}"` | Default theme `Base` (definitions.md) | Page Builder setting |
| `gridColumnWidths`, `lineItemWidthOverrides`, `timeDimensionWidthOverrides`, `defaultColumnWidth`, `defaultColumnLabelHeight` | Empty | The viewer takes `resizedColumns[{compositeId, width}]`, `lineItemWidthOverrides`, `listLevelOverridesByDimensionId` and `timeDimensionWidthOverrides` (1498948, 1500169) | Name mapping inferred |

**Per-user customisations (traced):** these are held in the Redux slice `endUserAxisDescriptions` (1609732), where `customisations[<widgetClientGuid>] = {queries: [<ADQ>], transforms: [...]}`. The slice is reset on every route change.

The end-user query starts from `createEndUserAxisDescriptionFromPageBuilderQuery` (`YEe` 1588715 for v1, `JEe` for v2). It keeps the page query's axes, modules and conditional-formatting rules but clears levels, sorts, shows, hides, reorder, ragged selections and filters (`I0`, `gve`). Page Builder settings and per-user changes are therefore separate layers. How the server combines them is **unknown**. `getStateForWidgetFromPageLoad` (`ave` 1603128) runs when `populateCustomisationsFromLocalStorage` is set and fills it through an injected `loadSetting` from these keys:

- `<clientGuid or pageGuid>:pivots`: data keyed by `dataSourceId` as `{c, r, p}` dimension lists.
- `…:selections`: `SELECTION_SHOW` and `LEVEL_SELECTION_SET` transforms.
- `…:<dataSourceId>:sorts`: `{selectedDimension, selectedItem, direction}`.
- `…:<dataSourceId>:filters`: `{filterGroups, filterConditions}`, converted to `QUICK_FILTER {options: [{selectedItem, dataType, values, operator}]}` (`BA` 1601673).
- `ADQ:<clientGuid>` and `transforms:<clientGuid>` caches.

Two further rules apply:

- Keys prefixed `mainGrid:` belong to a worksheet main grid.
- When pivot is not allowed, stored per-user queries are re-aligned to the page's axes (`QTe` 1601029). That the card's `pivotEnabled` drives this is **inferred**.

**Transform types:** the viewer's `Ot` (1600336) lists `QUICK_FILTER`, `SORT`, `ZERO_SUPPRESSION`, `BREAKBACK_HOLD`, `LEVEL_SELECTION_SET`, `SELECTION_SHOW`, `BRANCH_SYNC`, `EXPAND_COLLAPSE` and `FREEZE`. `$c` (1595945) is a wider list that includes `ADVANCED_FILTER`, `CONDITIONAL_FORMATTING`, `PIVOT`, `RAGGED_SELECTION*`, `REORDER_ITEMS`, `TOTALS_POSITION` and `TRANSPOSE`. `allowExpandOrCollapseRows` only seeds a runtime `EXPAND_ALL` transform on rows (1481909).

**Conclusion:** page-defined filters, sorts, show/hide, levels and conditional formatting are in the ADQ. Per-user equivalents live in browser storage and client state, never in the page definition.

## 10. Page details → Modules (`pageDataSources`)

**Route (traced):** the wrapper is `getPageByModel:async(l,c,d,u)=>…get(`${s}customer/${l}/model/${c}/pages/${d}`,{headers:{"x-api-version":u}})` (modeling 39642; app-shell 649766). `s` is `<prefix>definition-service/`, where the prefix is `/a/springboard-` or the configured `hubApiUrl` (modeling 30168, 30536). The full path is:

```text
GET /a/springboard-definition-service/customer/{customerId}/model/{modelId}/pages/{pageId}
```

**API version:** the caller `B_` (2054217) sends `x-api-version: 1` for the `derived` summary and `2` for `pdi`. The source is `usePdiModelPageSummary ? "pdi" : "derived"` (2214677).

**Consumed response fields (not a full schema):** `pageDataSources: [{dataSourceId, dataSourceType, dataSourceSubEntityId, widgetType}]`. The client groups entries by (id, type, sub-entity) with widget-type counts (`eGe` 2052265), then by module (`aGe` 2053776). It calls `Number(dataSourceId)` and uses the result as the module ID for custom and ADQ types. The service therefore reports module IDs for those types; this is **inferred**.

With `pdi`, the tab is labelled "Dependencies" and warns: "You won't see modules that are used in action cards, as a filter or from other models" (translations 18401). The capture's filter line item is exactly this case.

**SAM:** the UX transport accepts paths matching `^/a/springboard-(definition|clone|report-export)-service/` and `apiVersion` `"1"` or `"2"`, defaulting to `"1"` (`src/domains/ux-designer/program.ts`, lines 28–29 and 42). The route is therefore inside the allowed family, and both versions are permitted. Per [contracts.md](https://github.com/larasrinath/anaplan-sam/blob/main/docs/research/ux-designer/contracts.md), do not assume the v1 and v2 responses have the same shape. The summary is a cross-check, not a replacement for parsing cards.

## 11. Worksheet and report placement

- **Board (observed):**
  - Main path: `layout.areas.main → BOARD_CONTENT → sections → BOARD_SECTION → rows → BOARD_ROW {height, padding} → columns`.
  - Columns are `BOARD_COLUMN {columnStart, columnEnd}` on a 12-column grid, separated by `BOARD_COLUMN_SPACER` with `areas: null`.
  - Cards are `{type: <card type>, id: <widgets key = clientGuid>, height}` inside `BOARD_COLUMN.areas.cards`, framed by `BOARD_COLUMN_WIDGET_SPACER {height}`.
  - `sidepanel` holds an `INSIGHT_PANEL {areas: {navLinks, cards}}`, and `expanded: []`.
- **Worksheet (definitions.md):** `widgets` is an array of wrappers `{height, widgetGuid, guid, showPreview, widgetDefinition}`, with separate navigation links, a default related card and an optional `GRIDPAGE` layout. The main grid's runtime customisation key uses the `mainGrid:` prefix (traced).
- **Report (definitions.md):** root layout `REPORT` holds slides in `areas.main`. Each slide is `SLIDE` with `title`, orientation and its own `areas.main`. Cards have `position: {x, y, width, height}`. Unchanged saved widgets are sent as `widgetGuids`.
- **Report reads (traced):** `reports/{id}/slides?s=<slideId>…` (`loadReportSlides` 640979, optionally through the report-export service), `reports/{id}/slides/summary` and `reports/{id}/slides?filterSlidesFromLayout=true&s=…` (645738).

## 12. Grid sections (multi-module grids)

**Observed (UI, relayed):** the Columns panel lists up to four "Grid Section" entries, each with its own module selector.

The bundles support two multi-region forms:

1. **v1 multi-key:** `regions` holds keys beyond `SINGLE`. `YEe` expands each key into its own `{rows, columns, moduleId}`, so each region has its own axes.
2. **v2 merged grid:** `regions[]` combines shared child axes. Several regions can reuse a `rowAxisKey` and differ by `columnAxisKey`, which fits column-wise sections sharing rows; this is **inferred**. Dimension settings, filters and ragged selections belong to a child axis, so every region on that axis shares them. `moduleId` and `offAxisDimensions` belong to each region.

**Unknown:**

- Which form Page Builder writes.
- The key names of extra v1 regions.
- Where the limit of four is enforced.
- How the conditional-formatting region fields reference sections. `Lve`'s `{rowKey, columnKey}` is the only traced region-coordinate convention.

No "Grid Section" label, `gridSection` identifier or section limit exists in these bundles.

## 13. Page Builder grid toolbar mapping

A sweep of both bundles and both translation files for toolbar labels and test IDs found no Page Builder grid toolbar. It found only chart conditional-formatting controls and the modeling UI's own zero-suppression dialog. The mapping below is therefore by field semantics only.

| Toolbar control | Probable stored field | Level |
| --- | --- | --- |
| Pivot | Which dimensions sit in `rows.dimensions`, `columns.dimensions` and `offAxisDimensions` (v1), or in the child axes (v2) | Inferred; the end-user pivot is traced (`HEe`, `DA`) |
| Filter | `rows.filters` and `columns.filters` | Observed (capture + UI) |
| Sort | `dimensions[].sorts` | Inferred; the end-user sort is traced (`MTe`) |
| Show/hide (eye) | `dimensions[].shows`, `hides`, `reorder`; `raggedShows`, `raggedHides` | Inferred; traced (`FTe`) |
| Stepped lines | `dimensions[].levels` | Inferred |
| Stacked bars | Unknown. Candidates: `totalsPosition`, `conditionalFormattingRules`, `styleConfig` | Unknown |
| Vertical double arrow | Unknown. Candidates: the sizing fields in section 9, or expand/collapse | Unknown |

## Observed in later captures (September 27, 2026)

Two more published boards were captured from the same model after these sections were written. Values below are placeholders.

**KPI, field and chart cards.**

- A KPI (`CARD`) has a card-level `dataSourceId: <moduleId>` and one `LINE_ITEM` source. Its settings include `textStyle`, `paddingStyle`, `numberScale` and sparkline fields. It carries empty flat `cf*` fields and an **object** `config`: `{conditionalFormatting: {targets: ["INDICATOR"]}, iconIndicatorType: "THRESHOLD", trendIndicatorConfig: {…}, thresholdIndicatorConfig: {icons: [{index, iconId}]}}`.
- A field card has `dataSourceId: ""` and `fields[{moduleId, lineItemId, label, formatSpecificProperties}]`, plus a matching `LINE_ITEM` source.
- A combo chart has `chartConfig: "{\"chartType\":\"combochart\",…}"` with a `MULTI_AXIS_DESCRIPTION` source carrying an inline v1 grid query: Line Items on rows and Time on columns.

**Grid built on a saved view.** The card stores `dataSourceId: <viewId>` and one source, `{dataSourceType: "CLASSIC", dataSourceId: <viewId>, subEntityId: "", axisDescriptionQuery: null, viewDescription: null}`.

- The view ID has 13 digits and lacks the module prefix `102`, which confirms the summary-code rule in section 4.
- No pivot, filter or show/hide state is stored on the card.
- The card also had `isReadOnly: true`, `pivotEnabled: true` and `branchSync: ""`.

**Integration view metadata for saved views.**

- The model-wide views listing (`GET /models/{m}/views`) names a saved view `Module.'View'` or `'Module'.'View'`. The module name is left unquoted even when it contains spaces.
- In this model the listing rendered no module column.
- `GET /models/{m}/views/{viewId}` returns the view's `rows`, `columns` and `pages`.

**Action button types.** One card held five buttons:

| `type` | `id` form |
| --- | --- |
| `IMPORT` | numeric, prefix `112` |
| `EXPORT` | numeric, prefix `116` |
| `PROCESS` | numeric, prefix `118` |
| `FORECASTER` | 32-character hexadecimal string |
| `WORKFLOW_TEMPLATE` | GUID |

On that card:

- The `actions` JSON string held only `{id, name, type}` per button.
- `actionButtons` still carried an `actionToken` for every button.
- `widgetDataSources` was an empty array.

## Open questions for live verification

1. Capture a grid with several filter rules, "Any" matching, nested row dimensions and a **fixed** filter context. Record `selectedItems`, `identifier`, `axisKey` and the inner `BRANCH` operators.
2. Capture 2-section and 3-section grids. Determine whether they use v1 extra keys or v2 regions and axes, record the key names and region fields, and locate the four-section limit.
3. For each other conditional-formatting style (font, fill, data bar, icons), record the rule `type`, pegs and region-coordinate fields. Record also a rule whose source differs from its target.
4. Capture cards bound to a custom view and a view description (saved-view and default-view cards are now observed above). Record `dataSourceType`, `dataSourceId`, `subEntityId` and `viewDescription`.
5. Capture KPI, chart, map, presentation-table and field cards, and read each `chartConfig`, especially the `series[].id` values.
6. For action types not yet observed (delete, navigation), and for buttons that set them, record `type`, `runAutomatically`, `actionDriverId` and `destinationListId`. Also capture a non-empty `widgetActions`. Keep every `actionToken` redacted.
7. Capture populated `lineItemConfigs`, `customizations`, page `contextOptions`, `defaultContext`, `contextFilterOrder`, `syncScroll`, `syncBrowser` and `navLinks`.
8. Capture an image card that uses an external URL.
9. Call `getPageByModel` with `x-api-version` 1 and then 2 on the same page. Compare `pageDataSources` against the parsed ADQ bindings.
10. Capture populated `levels` values for lists and for Time periods other than `LEAF`.
