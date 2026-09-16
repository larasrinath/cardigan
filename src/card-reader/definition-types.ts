/** Native response documents stay behind the service boundary; MCP receives summaries and typed edits. */
export const UX_PAGE_TYPES = ["BOARD", "GRID-PAGE", "REPORT"] as const;
export type UxPageType = typeof UX_PAGE_TYPES[number];
export type NativePageDefinition = Record<string, unknown>;

export interface PageDefinitionSummary {
  pageType: UxPageType;
  pageGuid: string;
  appGuid: string;
  name: string;
  workspaceId: string;
  modelId: string;
  customerId: string;
  currentDraftVersionGuid?: string;
  cards: { id: string; type: string; title?: string; hasSavedWidgetReference: boolean }[];
  layoutIds: string[];
}

export class UxDefinitionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "UxDefinitionError";
  }
}
