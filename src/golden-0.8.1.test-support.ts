import { IMPORTS_ROW_REWORDED, MODEL_ACTIONS_COLUMN_ADDED, MODEL_ACTIONS_ROW_REWORDED, MODEL_FILE_ADDED, MODEL_ROW_ADDED, MODEL_ROW_REWORDED, MODEL_ROWS_FOR_THE_PAGE, withColumnAdded, withRowsAdded, withRowsReworded, ZIPPED_AT } from "./golden-0.6.1.test-support.js";
import { zipEntries, zipStore } from "./zip.test-support.js";

/** A made-up model whose line items drive who may read and write one another, and the zip exactly as version 0.8.1
 * (commit d55eaff) wrote it for that model, kept here as base64. 0.8.1 is the last version whose export did not make
 * Dynamic Cell Access.csv, a file the export makes from Line Items.csv and reads nothing for (model/access.ts). The zip
 * pins that the file is all an export gained with it: model/model.test.ts exports the same model and compares with this
 * zip but for what is named below, as it compares another model with 0.6.1's zip (golden-0.6.1.test-support.ts), whose
 * Line Items grid has none of the columns the file is made from and which gets no such file. Tests only. Every name is
 * made up.
 *
 * Made once by running 0.8.1's own exportModel on the model, with the clock at 2026-09-28 12:30:10 UTC, the export's
 * steps and log lines kept as the model's frame keeps them and given to it as its log (bridge.ts `serveCore`), and
 * `ZIPPED_AT` on every entry of the zip. Never regenerate it from newer code: a difference means the export changed.
 *
 * Cardigan no longer writes a zip: a result is read on the results page, which makes no file of it. The tests write the
 * engine's tables as the files they were (result-zip.test-support.ts) and hold them against this zip all the same. */

/** A Model settings grid as the page's client serves it to a test: its columns' labels, and each row with its IDs, its
 * labels and its cells (model/model.test.ts `FakeGrid`). */
export interface AccessGrid { columns: string[]; rows: { ids: number[]; labels: (string | null)[]; cells: string[] }[] }

/** The Line Items grid's columns, as a real model's grid has them, in its order (results/line-items-view.test.ts). */
const LINE_ITEM_COLUMNS = ["Format", "Formula", "Summary", "Applies To", "Time Scale", "Time Range", "Versions", "Style", "Cell Count", "Calculation Effort", "Notes",
  "Read Access Driver", "Write Access Driver", "Users List", "Parent", "Is Summary", "Formula Scope", "Code", "Use Switchover", "Breakback", "Brought-Forward",
  "Start of Section", "Data Tags", "Referenced By", "Module Name"];
const NUMBER = '{"minimumSignificantDigits":4,"decimalPlaces":-1,"dataType":"NUMBER"}';
const BOOLEAN = '{"dataType":"BOOLEAN"}';
const SUM = '{"summaryMethod":"SUM","timeSummaryMethod":"SUM"}';
const NO_SUMMARY = '{"summaryMethod":"NONE","timeSummaryMethod":"NONE"}';

/** A row's cells by their columns: every other cell is empty. */
const cells = (given: Record<string, string>): string[] => LINE_ITEM_COLUMNS.map(column => given[column] ?? "");
/** A module's own row, as the grid's axis gives it: under its own ID, with no module beside it. A heading among the
 * modules is such a row too, with nothing in it. */
const moduleRow = (id: number, name: string, given: Record<string, string> = {}): AccessGrid["rows"][number] => ({ ids: [id, -1], labels: [name, null], cells: cells(given) });
/** A line item's row: under its ID and its module's, a number that is summed with its module's dimensions, unless the
 * cells say otherwise. A line item that nothing drives has two empty driver cells. */
const lineItem = (id: number, [moduleId, moduleName]: readonly [number, string], name: string, given: Record<string, string> = {}): AccessGrid["rows"][number] =>
  ({ ids: [id, moduleId], labels: [name, moduleName], cells: cells({ Format: NUMBER, Summary: SUM, "Applies To": "-", "Time Scale": "Month", Versions: "All", "Cell Count": "480", "Is Summary": "false",
    "Start of Section": "false", "Module Name": moduleName, ...given }) });
/** What a line item that is a tick box holds, and what one holds in a module without time and versions. */
const flag = { Format: BOOLEAN, Summary: NO_SUMMARY };
const timeless = { "Time Scale": "Not Applicable", Versions: "Not Applicable", "Cell Count": "12" };

const ACCESS = [102000000002, "ACC01 Access, by role"] as const;
const REVENUE = [102000000004, "REV01 Revenue v1.2"] as const;
const COSTS = [102000000005, "COST01 Costs"] as const;
/** A driver as these cells name it, which is how the model map reads such a cell (map/graph-names.ts): a line item of
 * another module behind that module's name and a dot, each name in single quotes where it needs them, with a quote of
 * its own doubled. A line item of the row's own module is named alone. */
const CAN_READ = "'ACC01 Access, by role'.Can read";
const CAN_WRITE = "'ACC01 Access, by role'.Can write";
const EDITORS_LOCK = "'ACC01 Access, by role'.'Editor''s lock'";
const OPEN = "'REV01 Revenue v1.2'.Open for input";

/** The model: two headings, three modules and eleven line items. Four line items drive access:
 * - Can read drives who may read five line items, one of them in its own module, where it is named without its module.
 * - Can write and Editor's lock each drive who may write one line item.
 * - Open for input drives who may write three, one of them in its own module.
 * Units and Price have a read driver and a write driver each. Two cells name a driver that is no line item of the
 * model: Gone.Flag, and Can write of a module the model does not have. The two grids are given by their two axes, as
 * model/model.test.ts gives its grids; every other grid of the model is the one that test has. */
export const ACCESS_GRIDS: Record<string, AccessGrid> = {
  "LINE ITEMS × LINE ITEM PROPERTIES": { columns: LINE_ITEM_COLUMNS, rows: [
    moduleRow(102000000001, "-- ACCESS --"),
    moduleRow(ACCESS[0], ACCESS[1], { "Applies To": "Roles", "Time Scale": "Not Applicable", Versions: "Not Applicable", "Cell Count": "36" }),
    lineItem(1901000000001, ACCESS, "Can read", { ...flag, ...timeless,
      "Referenced By": "'Editor''s lock', 'REV01 Revenue v1.2'.Units, 'REV01 Revenue v1.2'.Price, 'REV01 Revenue v1.2'.Revenue, 'COST01 Costs'.Salaries" }),
    lineItem(1901000000002, ACCESS, "Can write", { ...flag, ...timeless, "Referenced By": "'REV01 Revenue v1.2'.Units" }),
    lineItem(1901000000003, ACCESS, "Editor's lock", { ...flag, ...timeless, "Read Access Driver": "Can read", "Referenced By": "'REV01 Revenue v1.2'.'Rate, net (50%)'" }),
    moduleRow(102000000003, "-- PLANNING --"),
    moduleRow(REVENUE[0], REVENUE[1], { "Applies To": "Products, Roles", "Time Scale": "Month", Versions: "All", "Cell Count": "2400" }),
    lineItem(1901000000004, REVENUE, "Units", { "Read Access Driver": CAN_READ, "Write Access Driver": CAN_WRITE, "Referenced By": "Revenue" }),
    lineItem(1901000000005, REVENUE, "Price", { Summary: NO_SUMMARY, "Read Access Driver": CAN_READ, "Write Access Driver": "Open for input", "Referenced By": "Revenue" }),
    lineItem(1901000000006, REVENUE, "Open for input", { ...flag, "Referenced By": "Price, 'COST01 Costs'.Rent, 'COST01 Costs'.Rates" }),
    lineItem(1901000000007, REVENUE, "Revenue", { Formula: "Units * Price", "Read Access Driver": CAN_READ }),
    lineItem(1901000000008, REVENUE, "Rate, net (50%)", { Summary: NO_SUMMARY, "Write Access Driver": EDITORS_LOCK, Notes: "Says \"net\", after tax" }),
    moduleRow(COSTS[0], COSTS[1], { "Applies To": "Cost Centres", "Time Scale": "Month", Versions: "All", "Cell Count": "1440" }),
    lineItem(1901000000009, COSTS, "Rent", { "Write Access Driver": OPEN }),
    lineItem(1901000000010, COSTS, "Rates", { "Read Access Driver": "Gone.Flag", "Write Access Driver": OPEN }),
    lineItem(1901000000011, COSTS, "Salaries", { "Read Access Driver": CAN_READ, "Write Access Driver": "'Old access'.Can write" })] },
  "MODULES × MODULE PROPERTIES": { columns: ["Applies To", "Cell Count"], rows: [
    { ids: [102000000001], labels: ["-- ACCESS --"], cells: ["", "0"] }, { ids: [ACCESS[0]], labels: [ACCESS[1]], cells: ["Roles", "36"] },
    { ids: [102000000003], labels: ["-- PLANNING --"], cells: ["", "0"] }, { ids: [REVENUE[0]], labels: [REVENUE[1]], cells: ["Products, Roles", "2400"] },
    { ids: [COSTS[0]], labels: [COSTS[1]], cells: ["Cost Centres", "1440"] }] },
};

/** Dynamic Cell Access.csv for that model, as the export is to write it: the file's text after its byte order mark. The
 * drivers in the order of their rows in Line Items.csv, for each driver Read before Write, then what it controls in that
 * file's order; the two rows whose driver is no line item of the model last, without a Driver Module and with the cell as
 * it is written. Every name is written as Line Items.csv writes it, in the CSV's own quotes where it holds a comma. */
export const ACCESS_CSV = [
  "Driver Module,Driver Line Item,Access,Controlled Module,Controlled Line Item",
  '"ACC01 Access, by role",Can read,Read,"ACC01 Access, by role",Editor\'s lock',
  '"ACC01 Access, by role",Can read,Read,REV01 Revenue v1.2,Units',
  '"ACC01 Access, by role",Can read,Read,REV01 Revenue v1.2,Price',
  '"ACC01 Access, by role",Can read,Read,REV01 Revenue v1.2,Revenue',
  '"ACC01 Access, by role",Can read,Read,COST01 Costs,Salaries',
  '"ACC01 Access, by role",Can write,Write,REV01 Revenue v1.2,Units',
  '"ACC01 Access, by role",Editor\'s lock,Write,REV01 Revenue v1.2,"Rate, net (50%)"',
  "REV01 Revenue v1.2,Open for input,Write,REV01 Revenue v1.2,Price",
  "REV01 Revenue v1.2,Open for input,Write,COST01 Costs,Rent",
  "REV01 Revenue v1.2,Open for input,Write,COST01 Costs,Rates",
  ",Gone.Flag,Read,COST01 Costs,Rates",
  ",'Old access'.Can write,Write,COST01 Costs,Salaries",
  ""].join("\r\n");

const bytes = (base64: string): Uint8Array => Uint8Array.from(atob(base64), character => character.charCodeAt(0));

/** `<model> - Model Export - <date>.zip` for that model as 0.8.1 wrote it: Model Details.csv and eleven Model settings
 * files (Source Models was not exported). The Diagnostics rows of Model Details.csv are the export's own steps and log
 * lines, every one of them, in order. */
export const ACCESS_ZIP_0_8_1 = bytes([
  "UEsDBBQAAAgAAMVjPF14lOY+nREAAJ0RAAARAAAATW9kZWwgRGV0YWlscy5jc3bvu79TZWN0aW9uLERldGFpbCxWYWx1ZQ0KTW9kZWwsTW9kZWwsRGVtYW5kOiBwbGFuDQpNb2RlbCxXb3Jrc3BhY2",
  "UsV29ya3NwYWNlIG9uZQ0KTW9kZWwsTW9kZWwgSUQsRkVEQ0JBOTg3NjU0MzIxMEZFRENCQTk4NzY1NDMyMTANCk1vZGVsLFdvcmtzcGFjZSBJRCwwMTIzNDU2Nzg5YWJjZGVmMDEyMzQ1Njc4OWFi",
  "Y2RlZg0KRXhwb3J0LEV4cG9ydGVkIG9uLDIwMjYtMDktMjggMTI6MzAgVVRDDQpFeHBvcnQsRXhwb3J0ZWQgd2l0aCxDYXJkaWdhbiBkZXYNCkV4cG9ydCxBbmFwbGFuIGhvc3QsZXUyYS5hcHAuYW",
  "5hcGxhbi5jb20NCkZpbGVzLExpbmUgSXRlbXMuY3N2LDE2IHJvd3MNCkZpbGVzLE1vZHVsZXMuY3N2LDUgcm93cw0KRmlsZXMsR2VuZXJhbCBMaXN0cy5jc3YsMiByb3dzDQpGaWxlcyxQcm9jZXNz",
  "ZXMuY3N2LDEgcm93cw0KRmlsZXMsSW1wb3J0cy5jc3YsMyByb3dzICgyIG1hdGNoZWQgaW4gdGhlIEFjdGlvbnMgbGlzdCkNCkZpbGVzLEltcG9ydCBEYXRhIFNvdXJjZXMuY3N2LDEgcm93cw0KRm",
  "lsZXMsRXhwb3J0cy5jc3YsMSByb3dzDQpGaWxlcyxPdGhlciBBY3Rpb25zLmNzdiwxIHJvd3MNCkZpbGVzLFRpbWUgUmFuZ2VzLmNzdiwxIHJvd3MNCkZpbGVzLFZlcnNpb25zLmNzdiwyIHJvd3MN",
  "CkZpbGVzLFNvdXJjZSBNb2RlbHMuY3N2LE5vdCBleHBvcnRlZDogVGhpcyBtb2RlbCBwYWdlIGhhcyBubyBSRU1PVEVfTU9ERUwgYXhpcy4NCkZpbGVzLE1vZGVsIENhbGVuZGFyLmNzdiwzMSByb3",
  "dzDQpIb3cgdG8gcmVhZCxMYXlvdXQsIkVhY2ggZmlsZSBpcyBsYWlkIG91dCBhcyBBbmFwbGFuJ3Mgb3duIGV4cG9ydCBvZiB0aGUgc2FtZSBNb2RlbCBzZXR0aW5ncyBncmlkOiBhbiB1bmxhYmVs",
  "bGVkIGZpcnN0IGNvbHVtbiwgdGhlbiB0aGUgZ3JpZCdzIGNvbHVtbnMsIHdpdGggZWFjaCBjZWxsJ3MgdW5kZXJseWluZyB2YWx1ZS4iDQpIb3cgdG8gcmVhZCxMaW5lIEl0ZW1zLCJFYWNoIG1vZH",
  "VsZSdzIHJvdyBzaXRzIGFib3ZlIGl0cyBsaW5lIGl0ZW1zLiBBbmFwbGFuJ3Mgb3duIGNvbHVtbnMgY29tZSBmaXJzdCBhbmQgYXJlIHVuY2hhbmdlZCwgYW5kIHRocmVlIGNvbHVtbnMgZm9sbG93",
  "IHRoZW0uIFJhdGlvIE51bWVyYXRvciBhbmQgUmF0aW8gRGVub21pbmF0b3IgbmFtZSB0aGUgbGluZSBpdGVtcyBhIFJhdGlvIHN1bW1hcnkgZGl2aWRlczogdGhlIFN1bW1hcnkgSlNPTiBnaXZlcy",
  "Bvbmx5IHRoZWlyIElEcy4gRm9ybWF0IExpc3QgbmFtZXMgdGhlIGxpc3Qgb2YgYSBsaW5lIGl0ZW0gZm9ybWF0dGVkIGFzIGEgbGlzdCwgYXMgR2VuZXJhbCBMaXN0cy5jc3YgbmFtZXMgaXQ6IHRo",
  "ZSBGb3JtYXQgSlNPTiBnaXZlcyBvbmx5IHRoZSBsaXN0J3MgSUQuIEl0IGlzIGVtcHR5IGZvciBhbnkgb3RoZXIgZm9ybWF0LCBmb3IgYSBsaXN0IHRoYXQgaXMgbm90IGluIEdlbmVyYWwgTGlzdH",
  "MuY3N2LCBzdWNoIGFzIGEgbGlzdCBzdWJzZXQgb3IgYSBsaW5lIGl0ZW0gc3Vic2V0LCBhbmQgd2hlbiBHZW5lcmFsIExpc3RzLmNzdiB3YXMgbm90IGV4cG9ydGVkLiINCkhvdyB0byByZWFkLCJQ",
  "cm9jZXNzZXMsIEV4cG9ydHMgYW5kIE90aGVyIEFjdGlvbnMiLCJUaGUgQWN0aW9ucyBsaXN0IHNwbGl0IGF0IGl0cyBoZWFkaW5ncywgaW4gaXRzIG93biBjb2x1bW5zOiBkZWZpbml0aW9uLCBsYX",
  "N0IHJ1biAoc3RhcnQgdGltZSBhbmQgZHVyYXRpb24pLCBub3RlcywgdGhlIHByb2Nlc3NlcyB0aGF0IHVzZSBlYWNoIGFjdGlvbiBhbmQgdGhlIGRhc2hib2FyZHMgaXQgYXBwZWFycyBvbi4iDQpI",
  "b3cgdG8gcmVhZCxJbXBvcnRzLCJUaGUgSW1wb3J0cyB0YWIgKHNvdXJjZSBhbmQgdGFyZ2V0KSwgdGhlbiBlYWNoIGltcG9ydCdzIGNvbHVtbnMgZnJvbSB0aGUgQWN0aW9ucyBsaXN0IChsYXN0IH",
  "J1biwgZHVyYXRpb24sIG5vdGVzLCBVc2VkIGluIFByb2Nlc3NlcywgVXNlZCBpbiBEYXNoYm9hcmRzKSwgbWF0Y2hlZCBvbiB0aGUgaW1wb3J0J3MgSUQuIFRoZSBBY3Rpb25zIGxpc3QncyAiIklt",
  "cG9ydCBpbnRvIOKApiIiIHRleHQgaXMgbGVmdCBvdXQ6IFRhcmdldCBPYmplY3QgYW5kIFRhcmdldCBUeXBlIHNheSB0aGUgc2FtZS4iDQpIb3cgdG8gcmVhZCxJbXBvcnQgRGF0YSBTb3VyY2VzLC",
  "JFYWNoIGRhdGEgc291cmNlLCB3aXRoIHRoZSBpbXBvcnRzIHRoYXQgdXNlIGl0LiINCkhvdyB0byByZWFkLE1vZGVsIENhbGVuZGFyLCJGb2xsb3dzIHRoZSBhc3Nlc3NtZW50IHRlbXBsYXRlLiBN",
  "b250aHMgYW5kIGRheXMgYXJlIHRoZWlyIG5hbWVzLCBhbmQgQ3VycmVudCBGaXNjYWwgWWVhciBpcyBzaG93biB3aXRoIGl0cyBkYXRlcywgYXMgdGhlIE1vZGVsIENhbGVuZGFyIHRhYiBzaG93cy",
  "BpdC4gU2V0dGluZ3MgdGhhdCBkbyBub3QgYXBwbHkgdG8gdGhpcyBjYWxlbmRhciB0eXBlIGFyZSBibGFuazsgTW9kZWwgc2l6ZSAoR0IpIGFuZCBDYXB0dXJlZCBieSBhcmUgbGVmdCBmb3IgeW91",
  "IHRvIGZpbGwgaW4uIg0KRGlhZ25vc3RpY3MsMTI6MzA6MTAsTG9hZGluZyB0aGUgbW9kZWwgcGFnZSdzIGNsaWVudOKApg0KRGlhZ25vc3RpY3MsMTI6MzA6MTAsbW9kZWwgRGVtYW5kOiBwbGFuIG",
  "luIFdvcmtzcGFjZSBvbmU7IHBhZ2UgL2NvcmUtd2ViYXBwL2FuYXBsYW4vZnJhbWV3b3JrLmpzcA0KRGlhZ25vc3RpY3MsMTI6MzA6MTAsUmVhZGluZyBMaW5lIEl0ZW1z4oCmDQpEaWFnbm9zdGlj",
  "cywxMjozMDoxMCxMaW5lIEl0ZW1zOiAxNiByb3dzIMOXIDI1IGNvbHVtbnM7IGNvbHVtbnM6IEZvcm1hdCB8IEZvcm11bGEgfCBTdW1tYXJ5IHwgQXBwbGllcyBUbyB8IFRpbWUgU2NhbGUgfCBUaW",
  "1lIFJhbmdlIHwgVmVyc2lvbnMgfCBTdHlsZSB8IENlbGwgQ291bnQgfCBDYWxjdWxhdGlvbiBFZmZvcnQgfCBOb3RlcyB8IFJlYWQgQWNjZXNzIERyaXZlciB8IFdyaXRlIEFjY2VzcyBEcml2ZXIg",
  "fCBVc2VycyBMaXN0IHwgUGFyZW50IHwgSXMgU3VtbWFyeSB8IEZvcm11bGEgU2NvcGUgfCBDb2RlIHwgVXNlIFN3aXRjaG92ZXIgfCBCcmVha2JhY2sgfCBCcm91Z2h0LUZvcndhcmQgfCBTdGFydC",
  "BvZiBTZWN0aW9uIHwgRGF0YSBUYWdzIHwgUmVmZXJlbmNlZCBCeSB8IE1vZHVsZSBOYW1lDQpEaWFnbm9zdGljcywxMjozMDoxMCxSZWFkaW5nIE1vZHVsZXPigKYNCkRpYWdub3N0aWNzLDEyOjMw",
  "OjEwLE1vZHVsZXM6IDUgcm93cyDDlyAyIGNvbHVtbnM7IGNvbHVtbnM6IEFwcGxpZXMgVG8gfCBDZWxsIENvdW50DQpEaWFnbm9zdGljcywxMjozMDoxMCxSZWFkaW5nIEdlbmVyYWwgTGlzdHPigK",
  "YNCkRpYWdub3N0aWNzLDEyOjMwOjEwLEdlbmVyYWwgTGlzdHM6IDIgcm93cyDDlyAyIGNvbHVtbnM7IGNvbHVtbnM6IFRvcCBMZXZlbCBJdGVtIHwgUHJvZHVjdGlvbiBEYXRhDQpEaWFnbm9zdGlj",
  "cywxMjozMDoxMCxSZWFkaW5nIEFjdGlvbnPigKYNCkRpYWdub3N0aWNzLDEyOjMwOjEwLEFjdGlvbnM6IDEwIHJvd3Mgw5cgNiBjb2x1bW5zOyBjb2x1bW5zOiBBY3Rpb24gfCBTdGFydCBEYXRlIG",
  "FuZCBUaW1lIChVVEMpIHwgTW9zdCByZWNlbnQgZHVyYXRpb24gKG1zKSB8IE5vdGVzIHwgVXNlZCBpbiBQcm9jZXNzZXMgfCBVc2VkIGluIERhc2hib2FyZHMNCkRpYWdub3N0aWNzLDEyOjMwOjEw",
  "LCJBY3Rpb25zIHJvd3MgYnkgZW50aXR5IHR5cGU6IDMxOmhlYWRpbmfDlzQsIDExODpwcm9jZXNzw5cxLCAxMTI6aW1wb3J0w5czLCAxMTY6ZXhwb3J0w5cxLCAxMTc6b3RoZXLDlzEiDQpEaWFnbm",
  "9zdGljcywxMjozMDoxMCxSZWFkaW5nIEltcG9ydHPigKYNCkRpYWdub3N0aWNzLDEyOjMwOjEwLEltcG9ydHM6IDIgcm93cyDDlyA2IGNvbHVtbnM7IGNvbHVtbnM6IFNvdXJjZSBMYWJlbCB8IFNv",
  "dXJjZSBPYmplY3QgfCBTb3VyY2UgVHlwZSB8IFRhcmdldCBPYmplY3QgfCBUYXJnZXQgVHlwZSB8IFByb2R1Y3Rpb24gRGF0YQ0KRGlhZ25vc3RpY3MsMTI6MzA6MTAsUmVhZGluZyBJbXBvcnQgRG",
  "F0YSBTb3VyY2Vz4oCmDQpEaWFnbm9zdGljcywxMjozMDoxMCxJbXBvcnQgRGF0YSBTb3VyY2VzOiAxIHJvd3Mgw5cgMiBjb2x1bW5zOyBjb2x1bW5zOiBUeXBlIHwgVXNlZCBpbiBJbXBvcnRzDQpE",
  "aWFnbm9zdGljcywxMjozMDoxMCxSZWFkaW5nIFRpbWUgUmFuZ2Vz4oCmDQpEaWFnbm9zdGljcywxMjozMDoxMCxUaW1lIFJhbmdlczogMSByb3dzIMOXIDIgY29sdW1uczsgY29sdW1uczogU3Rhcn",
  "QgUGVyaW9kIHwgRW5kIFBlcmlvZA0KRGlhZ25vc3RpY3MsMTI6MzA6MTAsUmVhZGluZyBWZXJzaW9uc+KApg0KRGlhZ25vc3RpY3MsMTI6MzA6MTAsVmVyc2lvbnM6IDIgcm93cyDDlyAyIGNvbHVt",
  "bnM7IGNvbHVtbnM6IElzIEFjdHVhbCB8IFN3aXRjaG92ZXINCkRpYWdub3N0aWNzLDEyOjMwOjEwLFJlYWRpbmcgU291cmNlIE1vZGVsc+KApg0KRGlhZ25vc3RpY3MsMTI6MzA6MTAsU291cmNlIE",
  "1vZGVsczogVGhpcyBtb2RlbCBwYWdlIGhhcyBubyBSRU1PVEVfTU9ERUwgYXhpcy4NCkRpYWdub3N0aWNzLDEyOjMwOjEwLFJlYWRpbmcgTW9kZWwgQ2FsZW5kYXLigKYNCkRpYWdub3N0aWNzLDEy",
  "OjMwOjEwLE1vZGVsIENhbGVuZGFyOiAxMCByb3dzIMOXIDEgY29sdW1uczsgY29sdW1uczogDQpQSwMEFAAACAAAxWM8XaGRleXODQAAzg0AAA4AAABMaW5lIEl0ZW1zLmNzdu+7vyxGb3JtYXQsRm",
  "9ybXVsYSxTdW1tYXJ5LEFwcGxpZXMgVG8sVGltZSBTY2FsZSxUaW1lIFJhbmdlLFZlcnNpb25zLFN0eWxlLENlbGwgQ291bnQsQ2FsY3VsYXRpb24gRWZmb3J0LE5vdGVzLFJlYWQgQWNjZXNzIERy",
  "aXZlcixXcml0ZSBBY2Nlc3MgRHJpdmVyLFVzZXJzIExpc3QsUGFyZW50LElzIFN1bW1hcnksRm9ybXVsYSBTY29wZSxDb2RlLFVzZSBTd2l0Y2hvdmVyLEJyZWFrYmFjayxCcm91Z2h0LUZvcndhcm",
  "QsU3RhcnQgb2YgU2VjdGlvbixEYXRhIFRhZ3MsUmVmZXJlbmNlZCBCeSxNb2R1bGUgTmFtZSxSYXRpbyBOdW1lcmF0b3IsUmF0aW8gRGVub21pbmF0b3IsRm9ybWF0IExpc3QNCi0tIEFDQ0VTUyAt",
  "LSwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwNCiJBQ0MwMSBBY2Nlc3MsIGJ5IHJvbGUiLCwsLFJvbGVzLE5vdCBBcHBsaWNhYmxlLCxOb3QgQXBwbGljYWJsZSwsMzYsLCwsLCwsLCwsLCwsLC",
  "wsLCwsDQpDYW4gcmVhZCwieyIiZGF0YVR5cGUiIjoiIkJPT0xFQU4iIn0iLCwieyIic3VtbWFyeU1ldGhvZCIiOiIiTk9ORSIiLCIidGltZVN1bW1hcnlNZXRob2QiIjoiIk5PTkUiIn0iLC0sTm90",
  "IEFwcGxpY2FibGUsLE5vdCBBcHBsaWNhYmxlLCwxMiwsLCwsLCxmYWxzZSwsLCwsLGZhbHNlLCwiJ0VkaXRvcicncyBsb2NrJywgJ1JFVjAxIFJldmVudWUgdjEuMicuVW5pdHMsICdSRVYwMSBSZX",
  "ZlbnVlIHYxLjInLlByaWNlLCAnUkVWMDEgUmV2ZW51ZSB2MS4yJy5SZXZlbnVlLCAnQ09TVDAxIENvc3RzJy5TYWxhcmllcyIsIkFDQzAxIEFjY2VzcywgYnkgcm9sZSIsLCwNCkNhbiB3cml0ZSwi",
  "eyIiZGF0YVR5cGUiIjoiIkJPT0xFQU4iIn0iLCwieyIic3VtbWFyeU1ldGhvZCIiOiIiTk9ORSIiLCIidGltZVN1bW1hcnlNZXRob2QiIjoiIk5PTkUiIn0iLC0sTm90IEFwcGxpY2FibGUsLE5vdC",
  "BBcHBsaWNhYmxlLCwxMiwsLCwsLCxmYWxzZSwsLCwsLGZhbHNlLCwnUkVWMDEgUmV2ZW51ZSB2MS4yJy5Vbml0cywiQUNDMDEgQWNjZXNzLCBieSByb2xlIiwsLA0KRWRpdG9yJ3MgbG9jaywieyIi",
  "ZGF0YVR5cGUiIjoiIkJPT0xFQU4iIn0iLCwieyIic3VtbWFyeU1ldGhvZCIiOiIiTk9ORSIiLCIidGltZVN1bW1hcnlNZXRob2QiIjoiIk5PTkUiIn0iLC0sTm90IEFwcGxpY2FibGUsLE5vdCBBcH",
  "BsaWNhYmxlLCwxMiwsLENhbiByZWFkLCwsLGZhbHNlLCwsLCwsZmFsc2UsLCInUkVWMDEgUmV2ZW51ZSB2MS4yJy4nUmF0ZSwgbmV0ICg1MCUpJyIsIkFDQzAxIEFjY2VzcywgYnkgcm9sZSIsLCwN",
  "Ci0tIFBMQU5OSU5HIC0tLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLA0KUkVWMDEgUmV2ZW51ZSB2MS4yLCwsLCJQcm9kdWN0cywgUm9sZXMiLE1vbnRoLCxBbGwsLDI0MDAsLCwsLCwsLCwsLC",
  "wsLCwsLCwsDQpVbml0cywieyIibWluaW11bVNpZ25pZmljYW50RGlnaXRzIiI6NCwiImRlY2ltYWxQbGFjZXMiIjotMSwiImRhdGFUeXBlIiI6IiJOVU1CRVIiIn0iLCwieyIic3VtbWFyeU1ldGhv",
  "ZCIiOiIiU1VNIiIsIiJ0aW1lU3VtbWFyeU1ldGhvZCIiOiIiU1VNIiJ9IiwtLE1vbnRoLCxBbGwsLDQ4MCwsLCInQUNDMDEgQWNjZXNzLCBieSByb2xlJy5DYW4gcmVhZCIsIidBQ0MwMSBBY2Nlc3",
  "MsIGJ5IHJvbGUnLkNhbiB3cml0ZSIsLCxmYWxzZSwsLCwsLGZhbHNlLCxSZXZlbnVlLFJFVjAxIFJldmVudWUgdjEuMiwsLA0KUHJpY2UsInsiIm1pbmltdW1TaWduaWZpY2FudERpZ2l0cyIiOjQs",
  "IiJkZWNpbWFsUGxhY2VzIiI6LTEsIiJkYXRhVHlwZSIiOiIiTlVNQkVSIiJ9IiwsInsiInN1bW1hcnlNZXRob2QiIjoiIk5PTkUiIiwiInRpbWVTdW1tYXJ5TWV0aG9kIiI6IiJOT05FIiJ9IiwtLE",
  "1vbnRoLCxBbGwsLDQ4MCwsLCInQUNDMDEgQWNjZXNzLCBieSByb2xlJy5DYW4gcmVhZCIsT3BlbiBmb3IgaW5wdXQsLCxmYWxzZSwsLCwsLGZhbHNlLCxSZXZlbnVlLFJFVjAxIFJldmVudWUgdjEu",
  "MiwsLA0KT3BlbiBmb3IgaW5wdXQsInsiImRhdGFUeXBlIiI6IiJCT09MRUFOIiJ9IiwsInsiInN1bW1hcnlNZXRob2QiIjoiIk5PTkUiIiwiInRpbWVTdW1tYXJ5TWV0aG9kIiI6IiJOT05FIiJ9Ii",
  "wtLE1vbnRoLCxBbGwsLDQ4MCwsLCwsLCxmYWxzZSwsLCwsLGZhbHNlLCwiUHJpY2UsICdDT1NUMDEgQ29zdHMnLlJlbnQsICdDT1NUMDEgQ29zdHMnLlJhdGVzIixSRVYwMSBSZXZlbnVlIHYxLjIs",
  "LCwNClJldmVudWUsInsiIm1pbmltdW1TaWduaWZpY2FudERpZ2l0cyIiOjQsIiJkZWNpbWFsUGxhY2VzIiI6LTEsIiJkYXRhVHlwZSIiOiIiTlVNQkVSIiJ9IixVbml0cyAqIFByaWNlLCJ7IiJzdW",
  "1tYXJ5TWV0aG9kIiI6IiJTVU0iIiwiInRpbWVTdW1tYXJ5TWV0aG9kIiI6IiJTVU0iIn0iLC0sTW9udGgsLEFsbCwsNDgwLCwsIidBQ0MwMSBBY2Nlc3MsIGJ5IHJvbGUnLkNhbiByZWFkIiwsLCxm",
  "YWxzZSwsLCwsLGZhbHNlLCwsUkVWMDEgUmV2ZW51ZSB2MS4yLCwsDQoiUmF0ZSwgbmV0ICg1MCUpIiwieyIibWluaW11bVNpZ25pZmljYW50RGlnaXRzIiI6NCwiImRlY2ltYWxQbGFjZXMiIjotMS",
  "wiImRhdGFUeXBlIiI6IiJOVU1CRVIiIn0iLCwieyIic3VtbWFyeU1ldGhvZCIiOiIiTk9ORSIiLCIidGltZVN1bW1hcnlNZXRob2QiIjoiIk5PTkUiIn0iLC0sTW9udGgsLEFsbCwsNDgwLCwiU2F5",
  "cyAiIm5ldCIiLCBhZnRlciB0YXgiLCwiJ0FDQzAxIEFjY2VzcywgYnkgcm9sZScuJ0VkaXRvcicncyBsb2NrJyIsLCxmYWxzZSwsLCwsLGZhbHNlLCwsUkVWMDEgUmV2ZW51ZSB2MS4yLCwsDQpDT1",
  "NUMDEgQ29zdHMsLCwsQ29zdCBDZW50cmVzLE1vbnRoLCxBbGwsLDE0NDAsLCwsLCwsLCwsLCwsLCwsLCwsDQpSZW50LCJ7IiJtaW5pbXVtU2lnbmlmaWNhbnREaWdpdHMiIjo0LCIiZGVjaW1hbFBs",
  "YWNlcyIiOi0xLCIiZGF0YVR5cGUiIjoiIk5VTUJFUiIifSIsLCJ7IiJzdW1tYXJ5TWV0aG9kIiI6IiJTVU0iIiwiInRpbWVTdW1tYXJ5TWV0aG9kIiI6IiJTVU0iIn0iLC0sTW9udGgsLEFsbCwsND",
  "gwLCwsLCdSRVYwMSBSZXZlbnVlIHYxLjInLk9wZW4gZm9yIGlucHV0LCwsZmFsc2UsLCwsLCxmYWxzZSwsLENPU1QwMSBDb3N0cywsLA0KUmF0ZXMsInsiIm1pbmltdW1TaWduaWZpY2FudERpZ2l0",
  "cyIiOjQsIiJkZWNpbWFsUGxhY2VzIiI6LTEsIiJkYXRhVHlwZSIiOiIiTlVNQkVSIiJ9IiwsInsiInN1bW1hcnlNZXRob2QiIjoiIlNVTSIiLCIidGltZVN1bW1hcnlNZXRob2QiIjoiIlNVTSIifS",
  "IsLSxNb250aCwsQWxsLCw0ODAsLCxHb25lLkZsYWcsJ1JFVjAxIFJldmVudWUgdjEuMicuT3BlbiBmb3IgaW5wdXQsLCxmYWxzZSwsLCwsLGZhbHNlLCwsQ09TVDAxIENvc3RzLCwsDQpTYWxhcmll",
  "cywieyIibWluaW11bVNpZ25pZmljYW50RGlnaXRzIiI6NCwiImRlY2ltYWxQbGFjZXMiIjotMSwiImRhdGFUeXBlIiI6IiJOVU1CRVIiIn0iLCwieyIic3VtbWFyeU1ldGhvZCIiOiIiU1VNIiIsIi",
  "J0aW1lU3VtbWFyeU1ldGhvZCIiOiIiU1VNIiJ9IiwtLE1vbnRoLCxBbGwsLDQ4MCwsLCInQUNDMDEgQWNjZXNzLCBieSByb2xlJy5DYW4gcmVhZCIsJ09sZCBhY2Nlc3MnLkNhbiB3cml0ZSwsLGZh",
  "bHNlLCwsLCwsZmFsc2UsLCxDT1NUMDEgQ29zdHMsLCwNClBLAwQUAAAIAADFYzxdmjFddqwAAACsAAAACwAAAE1vZHVsZXMuY3N277u/LEFwcGxpZXMgVG8sQ2VsbCBDb3VudA0KLS0gQUNDRVNTIC",
  "0tLCwwDQoiQUNDMDEgQWNjZXNzLCBieSByb2xlIixSb2xlcywzNg0KLS0gUExBTk5JTkcgLS0sLDANClJFVjAxIFJldmVudWUgdjEuMiwiUHJvZHVjdHMsIFJvbGVzIiwyNDAwDQpDT1NUMDEgQ29z",
  "dHMsQ29zdCBDZW50cmVzLDE0NDANClBLAwQUAAAIAADFYzxdGaDcx1IAAABSAAAAEQAAAEdlbmVyYWwgTGlzdHMuY3N277u/LFRvcCBMZXZlbCBJdGVtLFByb2R1Y3Rpb24gRGF0YQ0KUHJvZHVjdH",
  "MsQWxsIFByb2R1Y3RzLHRydWUNCisgUmVnaW9ucywsZmFsc2UNClBLAwQUAAAIAADFYzxdyperT6UAAAClAAAADQAAAFByb2Nlc3Nlcy5jc3bvu78sQWN0aW9uLFN0YXJ0IERhdGUgYW5kIFRpbWUg",
  "KFVUQyksTW9zdCByZWNlbnQgZHVyYXRpb24gKG1zKSxOb3RlcyxVc2VkIGluIFByb2Nlc3NlcyxVc2VkIGluIERhc2hib2FyZHMNCk5pZ2h0bHkgbG9hZCwsMjAyNi0wMy0xMiAyMzoxOTo1Niw1OD",
  "IsUnVucyBhdCAyYW0sLEFkbWluDQpQSwMEFAAACAAAxWM8XYm4MPa5AQAAuQEAAAsAAABJbXBvcnRzLmNzdu+7vyxTb3VyY2UgTGFiZWwsU291cmNlIE9iamVjdCxTb3VyY2UgVHlwZSxUYXJnZXQg",
  "T2JqZWN0LFRhcmdldCBUeXBlLFByb2R1Y3Rpb24gRGF0YSxTdGFydCBEYXRlIGFuZCBUaW1lIChVVEMpLE1vc3QgcmVjZW50IGR1cmF0aW9uIChtcyksTm90ZXMsVXNlZCBpbiBQcm9jZXNzZXMsVX",
  "NlZCBpbiBEYXNoYm9hcmRzDQoxLjEgTG9hZCByZWdpb25zLEh1YiAvIFJlZ2lvbnMsSHViIC8gJ0xJU1QgLSBSZWdpb25zJy5FeHBvcnQsU0FWRUQgVklFVyxSZWdpb25zLExJU1QsZmFsc2UsLCxG",
  "cm9tIHRoZSBodWIsIk5pZ2h0bHkgbG9hZCwgV2Vla2x5IGxvYWQiLA0KUHJpY2VzIGZyb20gcHJpY2VzLmNzdixwcmljZXMuY3N2LC0sRklMRSxQcmljZXMsTU9EVUxFLGZhbHNlLDIwMjYtMDMtMT",
  "IgMjM6MTk6NTYsNTgyLCxOaWdodGx5IGxvYWQsDQpPbGQgaW1wb3J0LCwsLCwsLCwsLCwNClBLAwQUAAAIAADFYzxd3D42xkIAAABCAAAAFwAAAEltcG9ydCBEYXRhIFNvdXJjZXMuY3N277u/LFR5",
  "cGUsVXNlZCBpbiBJbXBvcnRzDQpwcmljZXMuY3N2LEZJTEUsUHJpY2VzIGZyb20gcHJpY2VzLmNzdg0KUEsDBBQAAAgAAMVjPF373mW9qgAAAKoAAAALAAAARXhwb3J0cy5jc3bvu78sQWN0aW9uLF",
  "N0YXJ0IERhdGUgYW5kIFRpbWUgKFVUQyksTW9zdCByZWNlbnQgZHVyYXRpb24gKG1zKSxOb3RlcyxVc2VkIGluIFByb2Nlc3NlcyxVc2VkIGluIERhc2hib2FyZHMNClNlbmQgcGxhbiwieyIiZXhw",
  "b3J0VHlwZSIiOiIiR1JJRF9DVVJSRU5UX1BBR0UiIn0iLCwsLCxSZXZpZXcNClBLAwQUAAAIAADFYzxdptKvzbkAAAC5AAAAEQAAAE90aGVyIEFjdGlvbnMuY3N277u/LEFjdGlvbixTdGFydCBEYX",
  "RlIGFuZCBUaW1lIChVVEMpLE1vc3QgcmVjZW50IGR1cmF0aW9uIChtcyksTm90ZXMsVXNlZCBpbiBQcm9jZXNzZXMsVXNlZCBpbiBEYXNoYm9hcmRzDQpEZWxldGUgb2xkIGl0ZW1zLCJ7IiJhY3Rp",
  "b25UeXBlIiI6IiJERUxFVEVfQllfU0VMRUNUSU9OIiJ9IiwsLCxOaWdodGx5IGxvYWQsDQpQSwMEFAAACAAAxWM8Xb//3MAyAAAAMgAAAA8AAABUaW1lIFJhbmdlcy5jc3bvu78sU3RhcnQgUGVyaW",
  "9kLEVuZCBQZXJpb2QNCkZZMjQtRlkyNSxGWTI0LEZZMjUNClBLAwQUAAAIAADFYzxdmh07XkgAAABIAAAADAAAAFZlcnNpb25zLmNzdu+7vyxJcyBBY3R1YWwsU3dpdGNob3Zlcg0KQWN0dWFsLHRy",
  "dWUsDQpGb3JlY2FzdCxmYWxzZSxAQ3VycmVudCBQZXJpb2QNClBLAwQUAAAIAADFYzxd25xwNikNAAApDQAAEgAAAE1vZGVsIENhbGVuZGFyLmNzdu+7v1NlY3Rpb24sU2V0dGluZyxWYWx1ZSxBbG",
  "xvd2VkIHZhbHVlcyxBcHBsaWVzIHRvLE5vdGVzDQpNb2RlbCxXb3Jrc3BhY2UsV29ya3NwYWNlIG9uZSxUZXh0LEFsbCxBcyBzaG93biBpbiB0aGUgbW9kZWwgaGVhZGVyLg0KTW9kZWwsTW9kZWws",
  "RGVtYW5kOiBwbGFuLFRleHQsQWxsLCJFeGFjdCBtb2RlbCBuYW1lLCBtYXRjaGluZyB0aGUgQmx1ZXByaW50IGV4cG9ydHMgaW4gdGhlIHNhbWUgZm9sZGVyLiINCk1vZGVsLE1vZGVsIHNpemUgKE",
  "dCKSwsTnVtYmVyLEFsbCxGcm9tIE1hbmFnZSBNb2RlbHMgYXQgdGhlIHRpbWUgb2YgZXhwb3J0LiBBbmNob3JzIGNlbGwgZmluZGluZ3MgdG8gbWVtb3J5Lg0KTW9kZWwsQ2FwdHVyZWQgb24sMjAy",
  "Ni0wOS0yOCxZWVlZLU1NLURELEFsbCxTYW1lIGRheSBhcyB0aGUgQmx1ZXByaW50IGV4cG9ydHMuDQpNb2RlbCxDYXB0dXJlZCBieSwsVGV4dCxBbGwsDQpNb2RlbCBDYWxlbmRhcixDYWxlbmRhci",
  "BUeXBlLCJXZWVrczogNC00LTUsIDQtNS00IG9yIDUtNC00IiwiQ2FsZW5kYXIgTW9udGhzL1F1YXJ0ZXJzL1llYXJzIHwgV2Vla3M6IDQtNC01LCA0LTUtNCBvciA1LTQtNCB8IFdlZWtzOiAxMyA0",
  "LXdlZWsgUGVyaW9kcyB8IFdlZWtzOiBHZW5lcmFsIixBbGwsRGVjaWRlcyB3aGljaCBvZiB0aGUgcm93cyBiZWxvdyBhcHBseTsgbGVhdmUgdGhlIG90aGVycyBibGFuay4NCk1vZGVsIENhbGVuZG",
  "FyLEZpc2NhbCBZZWFyIFN0YXJ0cywsSmFuIHwgRmViIHwgTWFyIHwgQXByIHwgTWF5IHwgSnVuIHwgSnVsIHwgQXVnIHwgU2VwIHwgT2N0IHwgTm92IHwgRGVjLE1vbnRocyxNb250aCBjYWxlbmRh",
  "cnMgb25seS4NCk1vZGVsIENhbGVuZGFyLFdlZWsgR3JvdXBpbmcgaW50byBNb250aHMgLyBRdHJzLCw0LTQtNSB8IDQtNS00IHwgNS00LTQsV2Vla3MgNC00LTUsDQpNb2RlbCBDYWxlbmRhcixFbm",
  "Qgb2YgRmlzY2FsIFllYXIgaXMsTGFzdCxMYXN0IHwgTmVhcmVzdCwiV2Vla3MgNC00LTUsIFdlZWtzIDEzeDQiLExhc3QgPSAnTGFzdCA8ZGF5PiBpbiA8bW9udGg+JzsgTmVhcmVzdCA9ICc8ZGF5",
  "PiBuZWFyZXN0IHRvIGVuZCBvZiA8bW9udGg+Jy4NCk1vZGVsIENhbGVuZGFyLEVuZCBvZiBGaXNjYWwgWWVhciAtIGRheSxTYXQsTW9uIHwgVHVlIHwgV2VkIHwgVGh1IHwgRnJpIHwgU2F0IHwgU3",
  "VuLCJXZWVrcyA0LTQtNSwgV2Vla3MgMTN4NCIsDQpNb2RlbCBDYWxlbmRhcixFbmQgb2YgRmlzY2FsIFllYXIgLSBtb250aCxEZWMsSmFuIHwgRmViIHwgTWFyIHwgQXByIHwgTWF5IHwgSnVuIHwg",
  "SnVsIHwgQXVnIHwgU2VwIHwgT2N0IHwgTm92IHwgRGVjLCJXZWVrcyA0LTQtNSwgV2Vla3MgMTN4NCIsDQpNb2RlbCBDYWxlbmRhcixUaW1lc2NhbGUsMi1kaWdpdCBmb3JtYXQsMi1kaWdpdCBmb3",
  "JtYXQgfCA0LWRpZ2l0IGZvcm1hdCxBbGwsWWVhciBkaWdpdHMgaW4gcGVyaW9kIG5hbWVzLg0KTW9kZWwgQ2FsZW5kYXIsRmlzY2FsIFllYXIgTGFiZWwsRlksVGV4dCwiTW9udGhzLCBXZWVrcyA0",
  "LTQtNSwgV2Vla3MgMTN4NCIsZS5nLiBGWQ0KTW9kZWwgQ2FsZW5kYXIsRmlzY2FsIFllYXIgTGFiZWwgaXMgYWxpZ25lZCB3aXRoLEVuZCBXZWVrIG9mIHRoZSBGaXNjYWwgWWVhcixFbmQgV2Vlay",
  "BvZiB0aGUgRmlzY2FsIFllYXIgfCBTdGFydCBXZWVrIG9mIHRoZSBGaXNjYWwgWWVhciwiTW9udGhzLCBXZWVrcyA0LTQtNSwgV2Vla3MgMTN4NCIsTGVhdmUgYmxhbmsgaWYgdGhlIG1vZGVsIGRv",
  "ZXMgbm90IHNob3cgaXQuDQpNb2RlbCBDYWxlbmRhcixDdXJyZW50IEZpc2NhbCBZZWFyLEZZMjQ6IDMxIERlYyAyMDIzIC0gMjggRGVjIDIwMjQsQXMgc2hvd24sIk1vbnRocywgV2Vla3MgNC00LT",
  "UsIFdlZWtzIDEzeDQiLCJDb3B5IHRoZSBmdWxsIHRleHQgaW5jbHVkaW5nIGRhdGVzLCBlLmcuIEZZMjQ6IDMxIERlYyAyMDIzIC0gMjggRGVjIDIwMjQuIg0KTW9kZWwgQ2FsZW5kYXIsTnVtYmVy",
  "IG9mIFBhc3QgWWVhcnMsMSxXaG9sZSBudW1iZXIsIk1vbnRocywgV2Vla3MgNC00LTUsIFdlZWtzIDEzeDQiLCJXaXRoIEZ1dHVyZSBZZWFycyBhbmQgdGhlIGN1cnJlbnQgeWVhciwgc2V0cyB0aG",
  "UgbW9kZWwgY2FsZW5kYXIgaG9yaXpvbi4iDQpNb2RlbCBDYWxlbmRhcixOdW1iZXIgb2YgRnV0dXJlIFllYXJzLCxXaG9sZSBudW1iZXIsIk1vbnRocywgV2Vla3MgNC00LTUsIFdlZWtzIDEzeDQi",
  "LA0KTW9kZWwgQ2FsZW5kYXIsRXh0cmEgV2VlayBmb3IgNTMtV2VlayBZZWFyIGZhbGxzIGluIFBlcmlvZCwsUGVyaW9kIG51bWJlciwiV2Vla3MgNC00LTUsIFdlZWtzIDEzeDQiLA0KTW9kZWwgQ2",
  "FsZW5kYXIsRXh0cmEgUGVyaW9kIGZhbGxzIGluIFF1YXJ0ZXIsLDEgfCAyIHwgMyB8IDQsV2Vla3MgMTN4NCwxMyA0LXdlZWsgcGVyaW9kcyBvbmx5Lg0KTW9kZWwgQ2FsZW5kYXIsV2VlayBGb3Jt",
  "YXQsLEFzIHNob3duIChlLmcuIE51bWJlcmVkKSxXZWVrcywNCk1vZGVsIENhbGVuZGFyLFN0YXJ0IERhdGUsLFlZWVktTU0tREQsV2Vla3MgR2VuZXJhbCxXZWVrczogR2VuZXJhbCBvbmx5Lg0KTW",
  "9kZWwgQ2FsZW5kYXIsTnVtYmVyIG9mIFdlZWtzLCxXaG9sZSBudW1iZXIsV2Vla3MgR2VuZXJhbCxXZWVrczogR2VuZXJhbCBvbmx5Lg0KTW9kZWwgQ2FsZW5kYXIsQ3VycmVudCBQZXJpb2QsLCJB",
  "cyBzaG93biwgb3IgYmxhbmsiLEFsbCxCbGFuayBtZWFucyBub3Qgc2V0Lg0KTW9kZWwgQ2FsZW5kYXIsSW5jbHVkZSBRdWFydGVyIFRvdGFscyxZZXMsWWVzIHwgTm8sIk1vbnRocywgV2Vla3MgNC",
  "00LTUsIFdlZWtzIDEzeDQiLA0KTW9kZWwgQ2FsZW5kYXIsSW5jbHVkZSBIYWxmLVllYXIgVG90YWxzLCxZZXMgfCBObywiTW9udGhzLCBXZWVrcyA0LTQtNSwgV2Vla3MgMTN4NCIsDQpNb2RlbCBD",
  "YWxlbmRhcixJbmNsdWRlIFllYXIgVG8gRGF0ZSwsWWVzIHwgTm8sV2hlcmUgc2hvd24sTGVhdmUgYmxhbmsgaWYgdGhlIG1vZGVsIGRvZXMgbm90IHNob3cgaXQuDQpNb2RlbCBDYWxlbmRhcixJbm",
  "NsdWRlIFllYXIgVG8gR28sLFllcyB8IE5vLFdoZXJlIHNob3duLExlYXZlIGJsYW5rIGlmIHRoZSBtb2RlbCBkb2VzIG5vdCBzaG93IGl0Lg0KTW9kZWwgQ2FsZW5kYXIsSW5jbHVkZSBUb3RhbCBv",
  "ZiBBbGwgUGVyaW9kcywsWWVzIHwgTm8sQWxsLA0KTW9kZWwgQ2FsZW5kYXIsUGVyaW9kIExhYmVsLCxUZXh0LFdoZXJlIHNob3duLExlYXZlIGJsYW5rIGlmIHRoZSBtb2RlbCBkb2VzIG5vdCBzaG",
  "93IGl0Lg0KTW9kZWwgQ2FsZW5kYXIsUXVhcnRlciBMYWJlbCwsVGV4dCxXaGVyZSBzaG93bixMZWF2ZSBibGFuayBpZiB0aGUgbW9kZWwgZG9lcyBub3Qgc2hvdyBpdC4NCk1vZGVsIENhbGVuZGFy",
  "LEhhbGYtWWVhciBMYWJlbCwsVGV4dCxXaGVyZSBzaG93bixMZWF2ZSBibGFuayBpZiB0aGUgbW9kZWwgZG9lcyBub3Qgc2hvdyBpdC4NClBLAQIUABQAAAgAAMVjPF14lOY+nREAAJ0RAAARAAAAAA",
  "AAAAAAAAAAAAAAAABNb2RlbCBEZXRhaWxzLmNzdlBLAQIUABQAAAgAAMVjPF2hkZXlzg0AAM4NAAAOAAAAAAAAAAAAAAAAAMwRAABMaW5lIEl0ZW1zLmNzdlBLAQIUABQAAAgAAMVjPF2aMV12rAAA",
  "AKwAAAALAAAAAAAAAAAAAAAAAMYfAABNb2R1bGVzLmNzdlBLAQIUABQAAAgAAMVjPF0ZoNzHUgAAAFIAAAARAAAAAAAAAAAAAAAAAJsgAABHZW5lcmFsIExpc3RzLmNzdlBLAQIUABQAAAgAAMVjPF",
  "3Kl6tPpQAAAKUAAAANAAAAAAAAAAAAAAAAABwhAABQcm9jZXNzZXMuY3N2UEsBAhQAFAAACAAAxWM8XYm4MPa5AQAAuQEAAAsAAAAAAAAAAAAAAAAA7CEAAEltcG9ydHMuY3N2UEsBAhQAFAAACAAA",
  "xWM8Xdw+NsZCAAAAQgAAABcAAAAAAAAAAAAAAAAAziMAAEltcG9ydCBEYXRhIFNvdXJjZXMuY3N2UEsBAhQAFAAACAAAxWM8XfveZb2qAAAAqgAAAAsAAAAAAAAAAAAAAAAARSQAAEV4cG9ydHMuY3",
  "N2UEsBAhQAFAAACAAAxWM8XabSr825AAAAuQAAABEAAAAAAAAAAAAAAAAAGCUAAE90aGVyIEFjdGlvbnMuY3N2UEsBAhQAFAAACAAAxWM8Xb//3MAyAAAAMgAAAA8AAAAAAAAAAAAAAAAAACYAAFRp",
  "bWUgUmFuZ2VzLmNzdlBLAQIUABQAAAgAAMVjPF2aHTteSAAAAEgAAAAMAAAAAAAAAAAAAAAAAF8mAABWZXJzaW9ucy5jc3ZQSwECFAAUAAAIAADFYzxd25xwNikNAAApDQAAEgAAAAAAAAAAAAAAAA",
  "DRJgAATW9kZWwgQ2FsZW5kYXIuY3N2UEsFBgAAAAAMAAwA2wIAACo0AAAAAA==",
].join(""));

/** What 0.8.1 read for that model, in order: each grid's row axis and the rows asked for. Nothing is read for the file. */
export const ACCESS_READS_0_8_1 = ["LINE ITEMS 0+1", "LINE ITEMS 0+16", "MODULES 0+1", "MODULES 0+5", "LISTS 0+1", "LISTS 0+2", "ACTIONS 0+1", "ACTIONS 0+10", "IMPORTS 0+1", "IMPORTS 0+2",
  "DATA SOURCES 0+1", "TIME RANGES 0+1", "VERSIONS 0+1", "VERSIONS 0+2", "CALENDAR 0+1", "CALENDAR 0+10"];

/** What the export reads and says that 0.8.1 did not, for a model with an import from a file, as this model has one (Prices
 * from prices.csv, in the grids it shares with 0.6.1's model, model/model.test.ts `GOLDEN_GRIDS`): the grid of the
 * imports' definitions, which hold each import's mapping (model/import-mappings.ts). It is read right after the Imports
 * tab, with the same row axis, a first row and then the rest (`reads`, after the read `after`). Its lines of the log come
 * right after the Imports tab's line (`said`, after the line `saidAfter`): what the tab holds, by Source Type, the step,
 * the grid's line, how the import's definition is made, and how many were read and found. Model Details.csv has them as
 * Diagnostics rows, each as the row's whole line of the file (`rows`). Nothing else is read or said for the mappings, and
 * no table is made of them: the result carries them beside its tables. */
export const MAPPINGS_ADDED = {
  after: "IMPORTS 0+2",
  reads: ["IMPORTS 0+1", "IMPORTS 0+2"],
  saidAfter: "Imports: 2 rows × 6 columns; columns: Source Label | Source Object | Source Type | Target Object | Target Type | Production Data",
  said: ["Import mappings: 2 imports; Source Types: SAVED VIEW ×1, FILE ×1; 1 mapping to read", "Reading Import mappings…", "Import mappings: 2 rows × 2 columns; columns: Notes | Import Definition",
    "Import mapping 112000000002: keys importType, target, mappings; 4 mappings: [targetType, target, sourceType, sourceColumnId, sourceColumnName] column ×4",
    "Import mappings: 1 of 1 read; 1 found in the grid of definitions"],
  rows: {
    after: "Diagnostics,12:30:10,Imports: 2 rows × 6 columns; columns: Source Label | Source Object | Source Type | Target Object | Target Type | Production Data\r\n",
    line: 'Diagnostics,12:30:10,"Import mappings: 2 imports; Source Types: SAVED VIEW ×1, FILE ×1; 1 mapping to read"\r\n'
      + "Diagnostics,12:30:10,Reading Import mappings…\r\nDiagnostics,12:30:10,Import mappings: 2 rows × 2 columns; columns: Notes | Import Definition\r\n"
      + 'Diagnostics,12:30:10,"Import mapping 112000000002: keys importType, target, mappings; 4 mappings: [targetType, target, sourceType, sourceColumnId, sourceColumnName] column ×4"\r\n'
      + "Diagnostics,12:30:10,Import mappings: 1 of 1 read; 1 found in the grid of definitions\r\n",
  },
} as const;

/** Reads as 0.8.1 made them, in order, with the reads of the grid of definitions where the export makes them now. */
export function withMappingsRead(reads: readonly string[]): string[] {
  const at = reads.indexOf(MAPPINGS_ADDED.after);
  if (at < 0) throw new Error(`The reads do not hold ${MAPPINGS_ADDED.after}.`);
  return [...reads.slice(0, at + 1), ...MAPPINGS_ADDED.reads, ...reads.slice(at + 1)];
}

/** What the export says that 0.8.1 did not, for any model: how many of the modules' IDs it found, which no table holds and
 * by which the results page opens a module in Model Building (model/export.ts `moduleIdsLine`), with the first row of the
 * grids that list modules, by its ID and the type the model's client says it is of. It is said right after the Modules
 * grid's line (`said`, after the line `saidAfter`), once both grids that list modules have been read, and Model
 * Details.csv has it as a Diagnostics row, as the row's whole line of the file (`rows`). Nothing is read for it. */
export const MODULE_IDS_ADDED = {
  saidAfter: "Modules: 5 rows × 2 columns; columns: Applies To | Cell Count",
  said: ["Module IDs: 5 found; the first row listed has ID 102000000001, of type 102 by the model's client"],
  rows: {
    after: "Diagnostics,12:30:10,Modules: 5 rows × 2 columns; columns: Applies To | Cell Count\r\n",
    line: `Diagnostics,12:30:10,"Module IDs: 5 found; the first row listed has ID 102000000001, of type 102 by the model's client"\r\n`,
  },
} as const;

/** Lines of the log as 0.8.1 said them, in order, with the lines of `added` right after its line `saidAfter`, which the log
 * must hold. A line stamped with its time gives the lines after it the same stamp. */
function withSaid(lines: readonly string[], added: { saidAfter: string; said: readonly string[] }): string[] {
  const at = lines.findIndex(line => line === added.saidAfter || line.endsWith(` ${added.saidAfter}`));
  if (at < 0) throw new Error(`The log does not hold the line ${added.saidAfter}.`);
  const stamp = lines[at].slice(0, lines[at].length - added.saidAfter.length);
  return [...lines.slice(0, at + 1), ...added.said.map(line => `${stamp}${line}`), ...lines.slice(at + 1)];
}

/** Lines of the log as 0.8.1 said them, in order, with the lines the export says now that 0.8.1 did not: on the modules'
 * IDs (`MODULE_IDS_ADDED`), and on the imports' definitions (`MAPPINGS_ADDED`), each where the export says them. */
export const withLinesSaid = (lines: readonly string[]): string[] => withSaid(withSaid(lines, MODULE_IDS_ADDED), MAPPINGS_ADDED);

/** What is deliberately not what 0.8.1 wrote for this model because the export has gained a file: the file itself, which
 * stands right after Line Items.csv in the zip, and the two rows of Model Details.csv about it, each as the row's whole
 * line of the file with the line it stands after. `written` gives the file's number of rows and how many of them have a
 * driver that could not be matched, right after the row for Line Items.csv; `howToRead` is the row every model's Model
 * Details.csv has gained. Besides these, the three rows named after them (`ACCESS_ROWS_FOR_THE_PAGE`), the column Other
 * Actions.csv has gained and the row that says what it holds, which differ from 0.8.1's zip as they differ from 0.6.1's
 * (`MODEL_ACTIONS_COLUMN_ADDED` and `MODEL_ACTIONS_ROW_REWORDED` in golden-0.6.1.test-support.ts), the row on Imports and
 * the row on Source Models, which every model's Model Details.csv has reworded and gained as well (`IMPORTS_ROW_REWORDED`
 * and `MODEL_ROW_ADDED` there), and the build's name (see `APP_ROW_REWORDED` there), nothing differs. */
export const ACCESS_FILE_ADDED = {
  file: MODEL_FILE_ADDED.file,
  after: "Line Items.csv",
  csv: ACCESS_CSV,
  details: MODEL_FILE_ADDED.details,
  written: { after: "Files,Line Items.csv,16 rows\r\n", line: "Files,Dynamic Cell Access.csv,12 rows (2 with a driver that could not be matched)\r\n" },
  howToRead: MODEL_FILE_ADDED.howToRead,
} as const;

/** The three rows of "How to read" in Model Details.csv that are deliberately not what 0.8.1 wrote since the results
 * page stopped offering a result for download, each as the row's whole line of the file. They are read on the page's
 * overview, and are to say what the page shows: why each is written as it is now is said where the same rows are named
 * for 0.6.1's zip (`MODEL_ROWS_FOR_THE_PAGE` and `MODEL_ROW_REWORDED` in golden-0.6.1.test-support.ts). The rows on the
 * layout and on the calendar are 0.6.1's own in this zip; the row on Line Items is as 0.8.1 wrote it, which already
 * named the three columns after Anaplan's own. The three are in the file's order. */
export const ACCESS_ROWS_FOR_THE_PAGE = [
  MODEL_ROWS_FOR_THE_PAGE.layout,
  { was: `How to read,Line Items,"Each module's row sits above its line items. Anaplan's own columns come first and are unchanged, and three columns follow them. Ratio Numerator and Ratio Denominator name the line items a Ratio summary divides: the Summary JSON gives only their IDs. Format List names the list of a line item formatted as a list, as General Lists.csv names it: the Format JSON gives only the list's ID. It is empty for any other format, for a list that is not in General Lists.csv, such as a list subset or a line item subset, and when General Lists.csv was not exported."\r\n`,
    now: MODEL_ROW_REWORDED.now },
  MODEL_ROWS_FOR_THE_PAGE.calendar,
] as const;

/** Every row of "How to read" in Model Details.csv that is deliberately not what 0.8.1 wrote, each as the row's whole
 * line of the file, in the file's order: the three above, and between the one on Line Items and the one on the calendar
 * the row on the Actions list's files, which says what the column Other Actions.csv has gained holds
 * (`MODEL_ACTIONS_ROW_REWORDED` in golden-0.6.1.test-support.ts), and the row on Imports, which says how the page shows
 * an import's Source Object (`IMPORTS_ROW_REWORDED` there). 0.8.1 wrote both as 0.6.1 did. */
export const ACCESS_ROWS_REWORDED = [ACCESS_ROWS_FOR_THE_PAGE[0], ACCESS_ROWS_FOR_THE_PAGE[1], MODEL_ACTIONS_ROW_REWORDED, IMPORTS_ROW_REWORDED, ACCESS_ROWS_FOR_THE_PAGE[2]] as const;

/** 0.8.1's text of this model's Model Details.csv as the file is written now: those five rows in their present words,
 * the two rows about the file added, the row on Source Models, and the Diagnostics rows on the modules' IDs
 * (`MODULE_IDS_ADDED`) and on the imports' definitions (`MAPPINGS_ADDED`). */
export const withAccessRows = (csv: string): string =>
  withRowsAdded(withRowsReworded(csv, ACCESS_ROWS_REWORDED), [ACCESS_FILE_ADDED.written, ACCESS_FILE_ADDED.howToRead, MODEL_ROW_ADDED, MODULE_IDS_ADDED.rows, MAPPINGS_ADDED.rows]);

/** The model's zip as 0.8.1 wrote it but for that: every file's bytes as they are in `ACCESS_ZIP_0_8_1`, with five lines
 * of Model Details.csv replaced and nine added (three rows of the file's own, a Diagnostics row on the modules' IDs and
 * five on the imports' definitions), the cell added to each line of Other Actions.csv
 * (`MODEL_ACTIONS_COLUMN_ADDED` in golden-0.6.1.test-support.ts: 0.8.1's file is 0.6.1's, byte for byte), and the file put
 * in after Line Items.csv, written by zipStore with the same time on every entry. Line Items.csv is 0.8.1's own: 0.8.1
 * wrote its Format List column already. model/model.test.ts pins that zipStore writes `ACCESS_ZIP_0_8_1` itself, byte
 * for byte, from the files as they are, so what differs from this zip differs from 0.8.1. */
export const ACCESS_ZIP_WITH_FILE = zipStore(zipEntries(ACCESS_ZIP_0_8_1).flatMap(entry => {
  const encoder = new TextEncoder();
  const text = (): string => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(entry.data);
  if (entry.name === ACCESS_FILE_ADDED.details) return [{ name: entry.name, data: encoder.encode(withAccessRows(text())) }];
  if (entry.name === MODEL_ACTIONS_COLUMN_ADDED.file) return [{ name: entry.name, data: encoder.encode(withColumnAdded(text(), MODEL_ACTIONS_COLUMN_ADDED)) }];
  return entry.name === ACCESS_FILE_ADDED.after ? [entry, { name: ACCESS_FILE_ADDED.file, data: encoder.encode(`\ufeff${ACCESS_FILE_ADDED.csv}`) }] : [entry];
}), ZIPPED_AT);
