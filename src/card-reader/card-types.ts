import type { UxPageType } from "./definition-types.js";

/** Read-only card descriptions shared by the tolerant extractor, the Integration name resolver and the MCP tool.
 * Native documents stay behind the service boundary; these projections carry IDs, typed settings and names only. */
export type UxEntityKind = "module" | "lineItem" | "dimension" | "listItem" | "view" | "action" | "page" | "unknown";

/** Every model/page reference in a card description uses this shape so names can be filled in one pass.
 * `unknown` marks IDs whose kind the native field does not establish (for example filter rule items). */
export interface UxEntityRef {
  kind: UxEntityKind;
  id: string;
  name?: string;
  /** Owning module when the native card states it or name resolution finds it (line items, saved views). */
  moduleId?: string;
  /** Owning module's name, filled by name resolution. */
  moduleName?: string;
  /** Native action type for `action` references, for example IMPORT or PROCESS. */
  actionType?: string;
  /** Kind established by name resolution for an `unknown` reference. */
  resolvedKind?: Exclude<UxEntityKind, "unknown">;
  /** Dimension (list) whose show/hide/reorder entry produced a `listItem` reference. Not part of the dedupe key. */
  dimensionId?: string;
}

export const entityKey = (ref: Pick<UxEntityRef, "kind" | "id">): string => `${ref.kind}:${ref.id}`;

/** One card on the page. The extractor owns the optional detail sections; absent means not applicable. */
export interface UxCardDetail {
  id: string;
  type: string;
  title?: string;
  description?: string;
  placement: UxCardPlacement;
  hasSavedWidgetReference: boolean;
  /** Only when the card names a model other than the page's; names still resolve against the page model. */
  modelId?: string;
  sources?: UxCardSource[];
  /** Grid and chart kind: `customView` (a module shaped on the page), `savedView` or `moduleView` (built in the model and
   * only selected on the page: a named saved view or the module's default view) and `combinedGrid` (several module sections). */
  viewType?: "customView" | "savedView" | "moduleView" | "combinedGrid";
  grid?: UxGridDetail;
  conditionalFormatting?: UxConditionalFormatRule[];
  contextSelectors?: UxContextSelector[];
  actions?: UxActionButtonDetail[];
  widgetActions?: unknown;
  navigation?: UxNavigationDetail;
  image?: UxImageDetail;
  text?: UxTextDetail;
  fields?: UxFieldDetail[];
  kpi?: UxKpiDetail;
  chart?: UxChartDetail;
  savedCustomizations?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  unrecognised?: UxUnrecognisedField[];
  /** Unrecognised entries beyond the per-card cap. */
  unrecognisedOmitted?: number;
  [section: string]: unknown;
}

// Section shapes produced by describePageCards (card-details.ts). Indexes are zero-based unless named `order`.
// Plain-data fields (`unknown`) are bounded JSON copies with credential-like keys redacted; IDs under
// moduleId/lineItemId/dimensionId/listId/listItemId/viewId/actionId keys become UxEntityRef values.

export type UxCardPlacement =
  | { kind: "board"; area?: string; sectionId?: string; rowId?: string; rowIndex?: number; rowHeight?: number; columnStart?: number; columnEnd?: number; height?: number }
  | { kind: "worksheet"; role: "main" | "insight"; index: number; height?: number; showPreview?: boolean }
  | { kind: "report"; slideId?: string; slideIndex?: number; slideTitle?: string; position?: Record<string, number>; locked?: boolean }
  | { kind: "unplaced" };

/** One entry per native `widgetDataSources` item. `dataSourceType` is native, except `CARD_LEVEL` for a card-level
 * `dataSourceId`/`lineItemId` binding that no data source repeats. `modules` lists every grid-section module when there are several.
 * A `CLASSIC` ID is a module (default view) only when it has the module prefix 102; otherwise it is a saved `view`, whose
 * owning `module` and `viewLayout` the service adds from Integration metadata. */
export interface UxCardSource {
  dataSourceType: string; module?: UxEntityRef; modules?: UxEntityRef[]; lineItem?: UxEntityRef; view?: UxEntityRef; descriptionId?: string;
  viewLayout?: UxViewLayout; viewNote?: string;
}

/** A saved view's dimensions per axis, from Integration view metadata. */
export type UxViewLayout = Record<"rows" | "columns" | "pages", { id: string; name: string }[]>;

/** Native LEAF rule. `selectedItems` keeps ID-like items in native order as `unknown` references (the filter
 * line item plus its filter context; kinds are left to name resolution). Other items stay raw in `otherItems`.
 * Name resolution (card-naming.ts) adds `filterLineItem` and `filterContext` once it knows every selected item's kind, or
 * the last one is the rule's line item: a dimension in the context means the page's current selection. The analyser
 * shows a context fixed to Current User as the Users dimension with that selection (catalog.ts `describeSystemContext`). */
export interface UxFilterCondition {
  operator: string; values: unknown[]; selectedItems: UxEntityRef[]; otherItems?: unknown[]; identifier?: UxEntityRef | string; axisKey?: unknown;
  filterLineItem?: UxEntityRef; filterContext?: ({ dimension: UxEntityRef; selection: "current" | "Current User" } | { item: UxEntityRef })[];
}
/** Native BRANCH node; conditions and groups each keep native order. `match` is the Page Builder label
 * ("Show items that match: All/Any") for the native AND/OR operator. */
export interface UxFilterDetail { operator: string; match?: "all" | "any"; conditions: UxFilterCondition[]; groups: UxFilterDetail[] }

/** Show/hide/reorder entries are `listItem` references (with `dimensionId`), `lineItem` references on the Line Items
 * dimension, or raw values when they are not ID-like. `dimensionKey` replaces `dimension` for a non-numeric native ID. */
export interface UxAxisDimension { dimension?: UxEntityRef; dimensionKey?: string; levels?: unknown[]; totalsPosition?: string; sorts?: unknown[]; shows?: unknown[]; hides?: unknown[]; reorder?: unknown[] }
export interface UxAxisDetail { dimensions: UxAxisDimension[]; filter?: UxFilterDetail; raggedShows?: unknown[]; raggedHides?: unknown[] }
export interface UxPivotPage { dimension: UxEntityRef; source: "axis" | "contextSelector"; visible?: boolean; syncedToPage?: boolean }
export interface UxGridPivot { rows: UxEntityRef[]; columns: UxEntityRef[]; pages: UxPivotPage[] }
/** One grid section (axis description region) in native order. `pages` are the region's off-axis dimensions. */
export interface UxGridRegion {
  region: string; module?: UxEntityRef; regionType?: string; rowAxisKey?: string; columnAxisKey?: string;
  rows?: UxAxisDetail; columns?: UxAxisDetail; pages?: UxAxisDimension[]; otherAxes?: Record<string, UxAxisDetail>; pivot: UxGridPivot;
}
export interface UxGridSummary { hasFilters: boolean; hasSorts: boolean; hasHiddenItems: boolean; hasLevelSelection: boolean; hasConditionalFormatting: boolean }
/** `order` is the one-based "Grid Section" number. */
export interface UxGridDetail { sections: { region: string; module?: UxEntityRef; order: number }[]; regions: UxGridRegion[]; summary: UxGridSummary; breakbackSelections?: unknown }

/** Identifiers that look like entity IDs are line items (module from the targeted region, or the KPI's module); others
 * are `unknown`. Other scalar settings are copied as-is; non-scalar ones stay as bounded raw `config`. Card-level rules
 * without a native type (KPI `conditionalFormatting` or its flat `cf*` fields) use type `CARD_LEVEL`; flat-field pegs
 * carry `position` min/mid/max. */
export interface UxConditionalFormatRule { type: string; source?: UxEntityRef; target?: UxEntityRef; pegs?: unknown; regions?: Record<string, unknown>; config?: Record<string, unknown>; [setting: string]: unknown }

export interface UxContextSelector {
  dimension?: UxEntityRef; dimensionKey?: string; visible?: boolean; syncedToPage?: boolean; editable?: boolean; enableMultiSelect?: boolean; syncOnSelection?: boolean;
  /** Module reference when numeric (Line Items selectors), otherwise raw. */
  scope?: unknown; defaultValue?: unknown; selections?: unknown; filter?: unknown; itemHierarchyLevels?: unknown; parentItem?: unknown; resolutionPolicy?: unknown; ancestry?: unknown;
}
/** Action tokens are never included. `runAutomatically` absent means Page Builder's default (run without asking), which
 * applies to import, export and process; `disableCancelButton` applies to process. `module`/`lineItem`: WRITEBACK and NOTIFICATION. */
export interface UxActionButtonDetail {
  action: UxEntityRef; name?: string; runAutomatically?: boolean; actionDriver?: unknown; destinationList?: UxEntityRef; disableCancelButton?: boolean;
  description?: string; style?: unknown; module?: UxEntityRef; lineItem?: UxEntityRef;
}
export interface UxNavigationDetail { page: UxEntityRef; appGuid?: string; pageType?: string; linkType?: string; targetPublished?: boolean }
/** `url` only for an absolute http(s) image source, without query or fragment. */
export interface UxImageDetail { sourceType?: string; module?: UxEntityRef; lineItem?: UxEntityRef; scaleType?: string; imageName?: string; url?: string; imageSource?: string; opacity?: number; imageAlign?: string }
export interface UxTextDetail { plainText: string; truncated?: boolean; styles: string[]; hasDynamicContent: boolean; entityTypes?: string[] }
export interface UxFieldDetail { module?: UxEntityRef; lineItem?: UxEntityRef; label?: string; formatSpecificProperties?: unknown }
/** KPI `config` indicator: `targets` are where conditional formatting applies; `trend.referenceLineItem` is a line item of the KPI module. */
export interface UxKpiIndicator { type?: string; targets?: unknown; threshold?: unknown; trend?: Record<string, unknown> }
export interface UxKpiDetail { module?: UxEntityRef; lineItem?: UxEntityRef; indicator?: UxKpiIndicator; [setting: string]: unknown }
export interface UxChartDetail { chartType?: string; series?: unknown; settings?: Record<string, unknown> }
/** `value` only for primitives of at most 200 characters; credential-like keys and values read "[redacted]". */
export interface UxUnrecognisedField { path: string; valueType: string; value?: string | number | boolean }
export interface UxSlideSummary { id?: string; index: number; type?: string; title?: string; orientation?: string; cardCount: number; contextSelectors?: UxContextSelector[]; source?: string }

export type UxPageContext = {
  layoutType?: string; contextSelectors?: UxContextSelector[]; defaultContext?: unknown; contextFilterOrder?: unknown; syncScroll?: unknown; syncBrowser?: boolean;
  layoutSettings?: Record<string, unknown>; modelCount?: number; categoryGuid?: string; currentDraftVersionGuid?: string; currentPublishedVersionGuid?: string;
  categoryUpdatedAt?: string | number; publishedAt?: string | number; updatedAt?: string | number; createdAt?: string | number;
  defaultRelatedCardId?: string; navLinks?: unknown; pageMetadata?: unknown; slides?: UxSlideSummary[];
  unrecognised?: UxUnrecognisedField[]; unrecognisedOmitted?: number;
};

export interface UxPageCardDetails {
  pageType: UxPageType;
  pageGuid: string;
  appGuid: string;
  name: string;
  customerId: string;
  workspaceId: string;
  modelId: string;
  pageContext: UxPageContext;
  cards: UxCardDetail[];
  /** Deduplicated by kind, ID and owning module. */
  references: UxEntityRef[];
  warnings: string[];
}

export interface UxNameTarget { workspaceId: string; modelId: string }

/** Names keyed by entityKey of the requested reference. Lookups that fail are reported, never thrown. */
export interface UxResolvedNames {
  names: Record<string, string>;
  /** Kind found for requested `unknown` references. */
  kinds: Record<string, Exclude<UxEntityKind, "unknown">>;
  /** Owning module found for line items and saved views (including `unknown` references resolved as line items). */
  modules: Record<string, { moduleId: string; moduleName?: string }>;
  /** Dimension layout of resolved saved views. */
  views?: Record<string, UxViewLayout>;
  unresolved: { kind: UxEntityKind; id: string; reason: string }[];
  warnings: string[];
}

export interface UxNameResolver {
  resolve(target: UxNameTarget, refs: readonly UxEntityRef[]): Promise<UxResolvedNames>;
}
