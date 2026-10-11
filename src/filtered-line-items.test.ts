import { describe, expect, it } from "vitest";
import { ALL_LINE_ITEMS, BY_SELECTOR, filteredLineItemsText, NOT_PLACED, readFilteredLineItems, type LineItemsShown } from "./filtered-line-items.js";
import { quoted, splitOutside, unquote } from "./map/graph-names.js";

// Made-up names only. Names an Anaplan user can type that would end a name in a list, or a section's part, if they were
// written as they are.
const AWKWARD = ["Rate, net", "Bob's plan", "In | Out", " Padded ", "-", "", "'Quoted'", "Plain: colon", "Only these", "All line items"];

describe("Which line items a filter's grid shows, as a cell says it", () => {
  it("says what one section shows in the words of the Cards table, every name written so that it stays one", () => {
    const one = (shown: LineItemsShown | undefined): string => filteredLineItemsText([{ module: "REV01 Revenue", shown }]);
    expect([one({ all: true }), one({ all: true, selector: true }), one(undefined), one({ only: ["Revenue", "Units"] }), one({ except: ["Show?"] })])
      .toEqual(["All line items", "Chosen by the Line Items selector", "Line Items not on rows, columns or a selector", "Only Revenue, Units", "All except Show?"]);
    expect([ALL_LINE_ITEMS, BY_SELECTOR, NOT_PLACED]).toEqual(["All line items", "Chosen by the Line Items selector", "Line Items not on rows, columns or a selector"]);
    // A name that holds a comma, a bar or a quote, has a space at an end or says nothing on its own is in single quotes,
    // its own quotes doubled, as the export writes names.
    expect(one({ only: AWKWARD })).toBe("Only 'Rate, net', 'Bob''s plan', 'In | Out', ' Padded ', '-', '', '''Quoted''', Plain: colon, Only these, All line items");
    expect(AWKWARD.map(quoted).map(unquote)).toEqual(AWKWARD);
    expect(splitOutside(AWKWARD.map(quoted).join(", ")).map(unquote)).toEqual(AWKWARD);
  });

  it("says it once for sections that show the same, and otherwise each section's after its module, in quotes", () => {
    expect(filteredLineItemsText([{ module: "REV01 Revenue", shown: { all: true } }, { module: "REV02 Margin", shown: { all: true } }])).toBe("All line items");
    expect(filteredLineItemsText([{ module: "REV01 Revenue", shown: { only: ["Units"] } }, { module: "Bob's | margins: all", shown: undefined }]))
      .toBe("'REV01 Revenue': Only Units | 'Bob''s | margins: all': Line Items not on rows, columns or a selector");
    expect(filteredLineItemsText([])).toBe("-");
  });

  it("reads back what it wrote, part by part, and nothing from a cell that says nothing", () => {
    const sections: LineItemsShown[] = [{ all: true }, { all: true, selector: true }, { only: AWKWARD }, { except: ["Rate, net", "Units"] }];
    for (const shown of sections) expect(readFilteredLineItems(filteredLineItemsText([{ module: "REV01 Revenue", shown }]))).toEqual([{ shown }]);
    const modules = ["REV01 Revenue", "Bob's | margins: all", " Padded "];
    expect(readFilteredLineItems(filteredLineItemsText(modules.map((module, index) => ({ module, shown: sections[index + 1] })))))
      .toEqual(modules.map((module, index) => ({ module, shown: sections[index + 1] })));
    // What it does not know is a part without what it shows; and a cell that says nothing has no part at all.
    expect(readFilteredLineItems(NOT_PLACED)).toEqual([{}]);
    expect(readFilteredLineItems("'REV01 Revenue': All line items | 'REV02 Margin': Line Items not on rows, columns or a selector"))
      .toEqual([{ module: "REV01 Revenue", shown: { all: true } }, { module: "REV02 Margin" }]);
    expect([readFilteredLineItems(""), readFilteredLineItems("-"), readFilteredLineItems("'Unclosed: All line items")]).toEqual([[], [], [{}]]);
  });
});
