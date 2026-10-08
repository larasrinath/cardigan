import { parseCsv, safeCell, toCsv, zipEntries, zipStore } from "./zip.test-support.js";

/** Two zips exactly as version 0.6.1 (commit 4eb457a) wrote them, kept here as base64: the app in analyse.test.ts (`analyseGoldenApp`) and the
 * model in model/model.test.ts (`exportGoldenModel`). 0.6.1 built its zip inside the analysis; the analysis now returns tables
 * and result-zip.test-support.ts builds the zip, and these pin that the bytes did not change. Tests only.
 *
 * Made once by running 0.6.1's own analyseApp and exportModel on those fixtures, with the clock at 2026-09-28 12:30:10 UTC and
 * the time zone UTC (a zip entry carries its time as local time). Never regenerate them from newer code: a difference means the
 * export changed. What is deliberately written otherwise since is named below: rows of the app's Details file and the dash
 * its other files hold for nothing to say, and of the model's files two columns, rows of its Details file, the two rows
 * about a file the export has gained, and a row of "How to read" on Source Models (`APP_ROW_REWORDED`,
 * `APP_ROWS_FOR_THE_PAGE`, `APP_ROW_ON_TWO_LINES`, `APP_DASH_PLAIN`, `MODEL_COLUMN_ADDED`, `MODEL_ACTIONS_COLUMN_ADDED`,
 * `MODEL_ROW_REWORDED`, `MODEL_ACTIONS_ROW_REWORDED`, `MODEL_ROWS_FOR_THE_PAGE`, `IMPORTS_ROW_REWORDED`, `MODEL_FILE_ADDED`,
 * `MODEL_ROW_ADDED`). A test then compares with 0.6.1's zip but for what is named, and the zips themselves stay as they are.
 *
 * Cardigan no longer writes a zip: a result is read on the results page, which makes no file of it. The zips here are
 * what the engine's tables are held against all the same, written as the files they were (result-zip.test-support.ts),
 * so that what the page shows does not change unnoticed. */

/** The time on every entry of both zips, as a local time, so the comparison holds in any time zone. */
export const ZIPPED_AT = new Date(2026, 8, 28, 12, 30, 10);

const bytes = (base64: string): Uint8Array => Uint8Array.from(atob(base64), character => character.charCodeAt(0));

/** `<app> - App Export - <date>.zip`: App Details.csv and the seven tables. */
export const APP_ZIP_0_6_1 = bytes([
  "UEsDBBQAAAgAAMVjPF3Jp2ditgYAALYGAAAPAAAAQXBwIERldGFpbHMuY3N277u/U2VjdGlvbixEZXRhaWwsVmFsdWUNCkFwcCxBcHAsUGxhbm5pbmc6IGFwcA0KQXBwLEFwcCBJRCwwMTIzNDU2Ny",
  "04OWFiLWNkZWYtMDEyMy00NTY3ODlhYmNkZWYNCkFwcCxDYXRlZ29yaWVzLERlbWFuZA0KQXBwLFBhZ2VzLDIgKDIgYm9hcmRzKQ0KQXBwLFBhZ2VzIGFuYWx5c2VkLCIxIG9mIDEgKHB1Ymxpc2hl",
  "ZCB2ZXJzaW9ucyk7IDEgdW5wdWJsaXNoZWQsIG5vdCBhbmFseXNlZCINCkFwcCxDYXJkcywzDQpBcHAsTW9kZWxzLE1vZGVsIG9uZSAoV29ya3NwYWNlIG9uZSkNCkV4cG9ydCxFeHBvcnRlZCBvbi",
  "wyMDI2LTA5LTI4IDEyOjMwIFVUQw0KRXhwb3J0LEV4cG9ydGVkIHdpdGgsQ2FyZGlnYW4gZGV2DQpFeHBvcnQsQW5hcGxhbiBob3N0LGZpcnN0LmFwcC5hbmFwbGFuLmNvbQ0KRmlsZXMsUGFnZXMu",
  "Y3N2LDIgcm93cw0KRmlsZXMsQ2FyZHMuY3N2LDMgcm93cw0KRmlsZXMsR3JpZCBTZWN0aW9ucy5jc3YsMSByb3dzDQpGaWxlcyxGaWx0ZXJzLmNzdiwxIHJvd3MNCkZpbGVzLENvbmRpdGlvbmFsIE",
  "Zvcm1hdHRpbmcuY3N2LDEgcm93cw0KRmlsZXMsQWN0aW9uIEJ1dHRvbnMuY3N2LDIgcm93cw0KRmlsZXMsV2hlcmUgVXNlZC5jc3YsMTAgcm93cw0KTm90ZXMsRHJhZnQgcGFnZSxOb3QgcHVibGlz",
  "aGVkDQpOb3RlcyxOYW1lcyxBbGwgbW9kZWxzIGFuc3dlcmVkLg0KSG93IHRvIHJlYWQsUGFnZSBhbmQgQ2FyZCAjLCJJZGVudGlmeSBhIGNhcmQgaW4gZXZlcnkgZmlsZS4gQ2FyZCAjIGNvdW50cy",
  "BjYXJkcyByb3cgYnkgcm93LCBsZWZ0IHRvIHJpZ2h0OyBDYXJkIElEIGlzIHRoZSBzdGFibGUga2V5LiINCkhvdyB0byByZWFkLFZpZXcgdHlwZSwiQ3VzdG9tIHZpZXc6IGEgbW9kdWxlIHNoYXBl",
  "ZCBvbiB0aGUgcGFnZS4gU2F2ZWQgdmlldzogYSBzYXZlZCB2aWV3IG9yIGEgbW9kdWxlJ3MgZGVmYXVsdCB2aWV3LCBidWlsdCBpbiB0aGUgbW9kZWwgYW5kIG9ubHkgc2VsZWN0ZWQgb24gdGhlIH",
  "BhZ2UuIENvbWJpbmVkIGdyaWQ6IHNldmVyYWwgbW9kdWxlIHNlY3Rpb25zIGluIG9uZSBjYXJkLiINCkhvdyB0byByZWFkLFNldCBpbiB0aGUgbW9kZWwgKHNhdmVkIHZpZXcpLCJBIHNhdmVkIHZp",
  "ZXcncyBvd24gZmlsdGVycywgc29ydHMgYW5kIHNob3cvaGlkZSBsaXZlIGluIHRoZSBtb2RlbCwgbm90IG9uIHRoZSBwYWdlLiINCkhvdyB0byByZWFkLChub3QgaW4gdGhlIG1vZGVsKSwiQSBtb2",
  "R1bGUgb3IgbGluZSBpdGVtIGEgY2FyZCBzdGlsbCBwb2ludHMgYXQgYnV0IHRoZSBtb2RlbCBubyBsb25nZXIgaGFzOiBkZWxldGVkLCBvciBub3QgdmlzaWJsZSB0byB5b3UuIFNlYXJjaCBXaGVy",
  "ZSBVc2VkLmNzdiBmb3IgaXQgdG8gZmluZCB0aGUgY2FyZHMuIg0KSG93IHRvIHJlYWQsRmlsdGVyIGNvbnRleHQsRmlsdGVyLWNvbnRleHQgaXRlbXMgc2hvdyB0aGVpciBJRHM7IHRoZWlyIG5hbW",
  "VzIGFyZSBub3QgbG9va2VkIHVwLg0KSG93IHRvIHJlYWQsTG9uZyBJRHMsIklEcyBvZiAxMiBvciBtb3JlIGRpZ2l0cyBhcmUgd3JpdHRlbiBhcyB0ZXh0IHNvIEV4Y2VsIHNob3dzIGV2ZXJ5IGRp",
  "Z2l0OyB0aGUgZm9ybXVsYSBiYXIgc2hvd3MgdGhlbSBhcyA9IiLigKYiIi4iDQpEaWFnbm9zdGljcywxMjozMDoxMCxwYWdlLWFuYWx5emVyIHZkZXY6IGFwcCBvbiBmaXJzdC5hcHAuYW5hcGxhbi",
  "5jb20NCkRpYWdub3N0aWNzLDEyOjMwOjEwLFJlYWRpbmcgdGhlIGFwcOKApg0KRGlhZ25vc3RpY3MsLHVuc3RhbXBlZCBsaW5lDQpQSwMEFAAACAAAxWM8XXZ2jaJoAgAAaAIAAAkAAABQYWdlcy5j",
  "c3bvu79BcHAsQ2F0ZWdvcnksUGFnZSxQYWdlIHR5cGUsUHVibGlzaCBzdGF0ZSxNb2RlbCxXb3Jrc3BhY2UsVG90YWwgY2FyZHMsR3JpZCBjYXJkcyxDaGFydCBjYXJkcyxHcmlkICYgY2hhcnQgdm",
  "lld3MsS1BJIGNhcmRzLEZpZWxkIGNhcmRzLEFjdGlvbiBjYXJkcyxUZXh0ICYgaW1hZ2UgY2FyZHMsTGFzdCBwdWJsaXNoZWQsUGFnZSBJRCxBcHAgSUQsTW9kZWwgSUQNClBsYW5uaW5nOiBhcHAs",
  "RGVtYW5kLERlbWFuZCBib2FyZCxCb2FyZCxQdWJsaXNoZWQgKG5vIHVucHVibGlzaGVkIGNoYW5nZXMpLE1vZGVsIG9uZSxXb3Jrc3BhY2Ugb25lLDMsMSwwLDEgY3VzdG9tIHZpZXcsMCwwLDEsMS",
  "wyMDI2LTA5LTIxLDAwMDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMTAwMCwwMTIzNDU2Ny04OWFiLWNkZWYtMDEyMy00NTY3ODlhYmNkZWYsRkVEQ0JBOTg3NjU0MzIxMEZFRENCQTk4NzY1",
  "NDMyMTANClBsYW5uaW5nOiBhcHAsRGVtYW5kLERyYWZ0IHBhZ2UsQm9hcmQsTm90IHB1Ymxpc2hlZCzigJQs4oCULDAsMCwwLOKAlCwwLDAsMCwwLOKAlCwwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC",
  "0wMDAwMDAwMDIwMDAsMDEyMzQ1NjctODlhYi1jZGVmLTAxMjMtNDU2Nzg5YWJjZGVmLOKAlA0KUEsDBBQAAAgAAMVjPF2rN0RbJgQAACYEAAAJAAAAQ2FyZHMuY3N277u/UGFnZSxDYXJkICMsQ2Fy",
  "ZCB0aXRsZSxDYXJkIHR5cGUsVmlldyB0eXBlLFNvdXJjZSBtb2R1bGUocyksU2F2ZWQgdmlldyxMaW5lIGl0ZW1zIHNob3duLFJvd3MsQ29sdW1ucyxDb250ZXh0IHNlbGVjdG9ycyxGaWx0ZXJzLF",
  "NvcnRzICYgaGlkZGVuIGl0ZW1zLENvbmRpdGlvbmFsIGZvcm1hdHRpbmcsQnV0dG9ucyAmIGxpbmtzLFRleHQgY29udGVudCxDYXJkIHNldHRpbmdzLENhcmQgSUQsU291cmNlIElEcw0KRGVtYW5k",
  "IGJvYXJkLDEs4oCULEFjdGlvbizigJQs4oCULOKAlCzigJQs4oCULOKAlCzigJQs4oCULOKAlCzigJQsSW1wb3J0OiBSZWxvYWQgcGxhbiB8IFByb2Nlc3M6IFJ1biBuaWdodGx5LOKAlCzigJQsMD",
  "AwMDAwMDAtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAxLOKAlA0KRGVtYW5kIGJvYXJkLDIsRGVtYW5kIGJ5IHByb2R1Y3QsR3JpZCxDdXN0b20gdmlldyxEZW1hbmQs4oCULENob3NlbiBieSB0",
  "aGUgTGluZSBJdGVtcyBzZWxlY3RvcixQcm9kdWN0LFRpbWUgKGxvd2VzdCBsZXZlbCBvbmx5KSxUZXJyaXRvcnk7IExpbmUgSXRlbXMsIlJvd3MsIG1hdGNoIGFsbDogSW5jbHVkZT8gW0ZpbHRlci",
  "BmbGFnc10gaXMgbm90IGVxdWFsIHRvIDAgKGNvbnRleHQ6IFRlcnJpdG9yeSA9IGN1cnJlbnQpIiwiUHJvZHVjdDogMiBpdGVtcyBoaWRkZW4gKE5vcnRoLCBTb3V0aCkiLCJCYWNrZ3JvdW5kIGNv",
  "bG91ciBvbiBWb2x1bWU6IC0xMCDihpIgI0Y1QTVCMTsgMTAwLDAwMCDihpIgIzYyNzc4NiIs4oCULOKAlCxSZWFkLW9ubHkgwrcgcGl2b3Qgb24gwrcgZmlsdGVyL3NvcnQgb24gwrcgQ1NWIGV4cG",
  "9ydCBvbiwwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDIsIj0iIjEwMjAwMDAwMDkwMSIiIg0KRGVtYW5kIGJvYXJkLDMsJysgTm90ZXMsVGV4dCzigJQs4oCULOKAlCzigJQs4oCU",
  "LOKAlCzigJQs4oCULOKAlCzigJQs4oCULCInPVNVTSgxKSBpcyB0ZXh0IGhlcmUsIG5vdCBhIGZvcm11bGEuIC8gU2Vjb25kIGxpbmUsIHdpdGggYSAiInF1b3RlIiIuIizigJQsMDAwMDAwMDAtMD",
  "AwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAzLOKAlA0KUEsDBBQAAAgAAMVjPF0155ri/gEAAP4BAAARAAAAR3JpZCBTZWN0aW9ucy5jc3bvu79QYWdlLENhcmQgIyxWaWV3IHR5cGUsU2VjdGlvbiAj",
  "LFNlY3Rpb24gbGF5b3V0LFNvdXJjZSBtb2R1bGUsU2F2ZWQgdmlldyxSb3dzLENvbHVtbnMsQ29udGV4dCBzZWxlY3RvcnMsTGluZSBpdGVtcyBzaG93bixSb3cgZmlsdGVyLENvbHVtbiBmaWx0ZX",
  "IsU29ydHMgJiBoaWRkZW4gaXRlbXMsQ29uZGl0aW9uYWwgZm9ybWF0dGluZyxDYXJkIElELFNlY3Rpb24gSUQsTW9kdWxlIElEDQpEZW1hbmQgYm9hcmQsMixDdXN0b20gdmlldywxLOKAlCxEZW1h",
  "bmQs4oCULFByb2R1Y3QsVGltZSAobG93ZXN0IGxldmVsIG9ubHkpLFRlcnJpdG9yeTsgTGluZSBJdGVtcyxDaG9zZW4gYnkgdGhlIExpbmUgSXRlbXMgc2VsZWN0b3IsIjEgY29uZGl0aW9uLCBtYX",
  "RjaCBhbGwiLOKAlCwiUHJvZHVjdDogMiBpdGVtcyBoaWRkZW4gKE5vcnRoLCBTb3V0aCkiLDEgcnVsZSAoQmFja2dyb3VuZCksMDAwMDAwMDAtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAyLFNJ",
  "TkdMRSwiPSIiMTAyMDAwMDAwOTAxIiIiDQpQSwMEFAAACAAAxWM8XcoiFch2AQAAdgEAAAsAAABGaWx0ZXJzLmNzdu+7v1BhZ2UsQ2FyZCAjLFNlY3Rpb24gIyxGaWx0ZXJlZCBtb2R1bGUsRmlsdG",
  "VyIG9uLEZpbHRlcmVkIGRpbWVuc2lvbixDb25kaXRpb24gZ3JvdXAsU2hvdyBpdGVtcyB0aGF0IG1hdGNoLENvbmRpdGlvbiBsaW5lIGl0ZW0sQ29uZGl0aW9uIGxpbmUgaXRlbSdzIG1vZHVsZSxP",
  "cGVyYXRvcixWYWx1ZSxDb25kaXRpb24gY29udGV4dCxDYXJkIElELExpbmUgaXRlbSBJRA0KRGVtYW5kIGJvYXJkLDIsMSxEZW1hbmQsUm93cyxQcm9kdWN0LDEsQWxsLEluY2x1ZGU/LEZpbHRlci",
  "BmbGFncyxpcyBub3QgZXF1YWwgdG8sMCxUZXJyaXRvcnkgPSBjdXJyZW50LDAwMDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwMiwiPSIiMTkwMzAwMDAwMDAwMSIiIg0KUEsDBBQAAAgA",
  "AMVjPF3z13ufEwEAABMBAAAaAAAAQ29uZGl0aW9uYWwgRm9ybWF0dGluZy5jc3bvu79QYWdlLENhcmQgIyxTZWN0aW9uICMsRm9ybWF0dGVkIG1vZHVsZSxGb3JtYXQgc3R5bGUsRm9ybWF0dGVkIG",
  "xpbmUgaXRlbSxDb2xvdXIgZHJpdmVuIGJ5LENvbG91ciBzdG9wcyxDYXJkIElELExpbmUgaXRlbSBJRA0KRGVtYW5kIGJvYXJkLDIsMSxEZW1hbmQsQmFja2dyb3VuZCxWb2x1bWUsVm9sdW1lLCIn",
  "LTEwIOKGkiAjRjVBNUIxOyAxMDAsMDAwIOKGkiAjNjI3Nzg2IiwwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDIsIj0iIjE5MDEwMDAwMDAwMDEiIiINClBLAwQUAAAIAADFYzxdcL",
  "fEo6EBAAChAQAAEgAAAEFjdGlvbiBCdXR0b25zLmNzdu+7v1BhZ2UsQ2FyZCAjLEJ1dHRvbiBsYWJlbCxBY3Rpb24gdHlwZSxNb2RlbCBhY3Rpb24gbmFtZSxOYW1lIHNvdXJjZSxSdW5zIGF1dG9t",
  "YXRpY2FsbHksQ2FuY2VsIGJ1dHRvbixDYXJkIElELEFjdGlvbiBJRA0KRGVtYW5kIGJvYXJkLDEsUmVsb2FkIHBsYW4sSW1wb3J0LEltcG9ydCBkZW1hbmQsTW9kZWwsWWVzIChkZWZhdWx0KSxuL2",
  "EsMDAwMDAwMDAtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAxLCI9IiIxMTIwMDAwMDA5MDEiIiINCkRlbWFuZCBib2FyZCwxLFJ1biBuaWdodGx5LFByb2Nlc3Ms4oCULENhcmQgbGFiZWwgKG5v",
  "dCBmb3VuZCBpbiB0aGUgbW9kZWwpLE5vIChhc2tzIGZpcnN0KSxDYW5jZWwgZGlzYWJsZWQsMDAwMDAwMDAtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAxLCI9IiIxMTgwMDAwMDA5MDEiIiINCl",
  "BLAwQUAAAIAADFYzxdTqu7FREDAAARAwAADgAAAFdoZXJlIFVzZWQuY3N277u/T2JqZWN0IHR5cGUsT2JqZWN0IG5hbWUsT2JqZWN0J3MgbW9kdWxlLFBhZ2UsQ2FyZCAjLFVzZWQgYXMsT2JqZWN0",
  "IElEDQpJbXBvcnQsSW1wb3J0IGRlbWFuZCzigJQsRGVtYW5kIGJvYXJkLDEsQWN0aW9uIGJ1dHRvbiwiPSIiMTEyMDAwMDAwOTAxIiIiDQpQcm9jZXNzLFJ1biBuaWdodGx5LOKAlCxEZW1hbmQgYm",
  "9hcmQsMSxBY3Rpb24gYnV0dG9uLCI9IiIxMTgwMDAwMDA5MDEiIiINCk1vZHVsZSxEZW1hbmQs4oCULERlbWFuZCBib2FyZCwyLERhdGEgc291cmNlIChjdXN0b20gdmlldyksIj0iIjEwMjAwMDAw",
  "MDkwMSIiIg0KRGltZW5zaW9uLFByb2R1Y3Qs4oCULERlbWFuZCBib2FyZCwyLFJvd3MsIj0iIjEwMTAwMDAwMDkwMSIiIg0KRGltZW5zaW9uLFRpbWUs4oCULERlbWFuZCBib2FyZCwyLENvbHVtbn",
  "MsMjAwMDAwMDAwMDMNCkRpbWVuc2lvbixUZXJyaXRvcnks4oCULERlbWFuZCBib2FyZCwyLFBhZ2Ugc2VsZWN0b3IsIj0iIjEwMTAwMDAwMDkwMiIiIg0KRGltZW5zaW9uLExpbmUgSXRlbXMs4oCU",
  "LERlbWFuZCBib2FyZCwyLFBhZ2Ugc2VsZWN0b3IsMjAwMDAwMDAwMTINCkxpbmUgaXRlbSxJbmNsdWRlPyxGaWx0ZXIgZmxhZ3MsRGVtYW5kIGJvYXJkLDIsRmlsdGVyLCI9IiIxOTAzMDAwMDAwMD",
  "AxIiIiDQpEaW1lbnNpb24sVGVycml0b3J5LOKAlCxEZW1hbmQgYm9hcmQsMixGaWx0ZXIgY29udGV4dCwiPSIiMTAxMDAwMDAwOTAyIiIiDQpMaW5lIGl0ZW0sVm9sdW1lLERlbWFuZCxEZW1hbmQg",
  "Ym9hcmQsMixGb3JtYXR0aW5nLCI9IiIxOTAxMDAwMDAwMDAxIiIiDQpQSwECFAAUAAAIAADFYzxdyadnYrYGAAC2BgAADwAAAAAAAAAAAAAAAAAAAAAAQXBwIERldGFpbHMuY3N2UEsBAhQAFAAACA",
  "AAxWM8XXZ2jaJoAgAAaAIAAAkAAAAAAAAAAAAAAAAA4wYAAFBhZ2VzLmNzdlBLAQIUABQAAAgAAMVjPF2rN0RbJgQAACYEAAAJAAAAAAAAAAAAAAAAAHIJAABDYXJkcy5jc3ZQSwECFAAUAAAIAADF",
  "YzxdNeea4v4BAAD+AQAAEQAAAAAAAAAAAAAAAAC/DQAAR3JpZCBTZWN0aW9ucy5jc3ZQSwECFAAUAAAIAADFYzxdyiIVyHYBAAB2AQAACwAAAAAAAAAAAAAAAADsDwAARmlsdGVycy5jc3ZQSwECFA",
  "AUAAAIAADFYzxd89d7nxMBAAATAQAAGgAAAAAAAAAAAAAAAACLEQAAQ29uZGl0aW9uYWwgRm9ybWF0dGluZy5jc3ZQSwECFAAUAAAIAADFYzxdcLfEo6EBAAChAQAAEgAAAAAAAAAAAAAAAADWEgAA",
  "QWN0aW9uIEJ1dHRvbnMuY3N2UEsBAhQAFAAACAAAxWM8XU6ruxURAwAAEQMAAA4AAAAAAAAAAAAAAAAApxQAAFdoZXJlIFVzZWQuY3N2UEsFBgAAAAAIAAgA5wEAAOQXAAAAAA==",
].join(""));

/** The one row of the app's App Details.csv that is deliberately not what 0.6.1 wrote, as the row's whole line of the file.
 * The "How to read" row on a filter's context said that the names of its items are not looked up. They are looked up now,
 * and so are the items that a rule compares a line item formatted as a list with, so the row says what is shown in either
 * case: the name where the model gives one, the ID otherwise. It also says how a rule is read: its line item apart from
 * its context, which gives each other dimension as current or as the item it is fixed to, Current User among them.
 *
 * Besides this row, the three named after it (`APP_ROWS_FOR_THE_PAGE`), the row on the pages analysed
 * (`APP_ROW_ON_TWO_LINES`) and the dash of the app's other files (`APP_DASH_PLAIN`), two places are known where this
 * app's files differ from 0.6.1's, and both name the build: the "Exported with" row and the first Diagnostics line.
 * Neither shows in a comparison here: the zip above was made by a build that calls itself "dev", as a build under test
 * does, and a test either gives the run the log that 0.6.1 was given or leaves the Diagnostics rows, which are a run's
 * own log, out of the comparison. */
export const APP_ROW_REWORDED = {
  was: "How to read,Filter context,Filter-context items show their IDs; their names are not looked up.\r\n",
  now: `How to read,Filter context and values,"An item in a filter rule, whether chosen as the filter context or compared with a line item formatted as a list, is shown by its name where the model gives one, and by its ID otherwise. A rule's line item has its own columns, and its context gives each other dimension as current, which follows the page, or as the item it is fixed to: Users = Current User is whoever views the page. Only where the rule's line item is not found are the line item and its context listed together in place of the line item's name."\r\n`,
} as const;

/** The three rows of the app's App Details.csv that are deliberately not what 0.6.1 wrote since the results page stopped
 * offering a result for download: each as the row's whole line of the file, as 0.6.1 wrote it and as it is written now.
 * A result is read on the page and nowhere else, and the "How to read" rows are on its overview: they are to say what
 * the page shows, and none may send its reader to a file.
 * - "Page and Card #" said that the two identify a card in every file. They identify it in every table.
 * - "(not in the model)" said to search Where Used.csv. It says to search the Model Objects table.
 * - "Long IDs" said how an ID of 12 digits or more is written so that Excel shows every digit. That is how a CSV is
 *   written, and the page shows an ID as it is: the row is gone, and it is written as nothing now. */
export const APP_ROWS_FOR_THE_PAGE = [
  { was: 'How to read,Page and Card #,"Identify a card in every file. Card # counts cards row by row, left to right; Card ID is the stable key."\r\n',
    now: 'How to read,Page and Card #,"Identify a card in every table. Card # counts cards row by row, left to right; Card ID is the stable key."\r\n' },
  { was: 'How to read,(not in the model),"A module or line item a card still points at but the model no longer has: deleted, or not visible to you. Search Where Used.csv for it to find the cards."\r\n',
    now: 'How to read,(not in the model),"A module or line item a card still points at but the model no longer has: deleted, or not visible to you. Search the Model Objects table for it to find the cards."\r\n' },
  { was: 'How to read,Long IDs,"IDs of 12 or more digits are written as text so Excel shows every digit; the formula bar shows them as =""…""."\r\n', now: "" },
] as const;

/** The row of the app's App Details.csv on the pages analysed, which is deliberately not what 0.6.1 wrote, as the row's
 * whole line of the file, as 0.6.1 wrote it and as it is written now. The overview lists the file's App rows under About
 * this export, where a value that lists several things has each of them on a line of its own, and so has a value that
 * says two (analyse.ts). This row said both of its numbers in one line, with a semicolon between them: how many
 * published pages were analysed, and how many pages were left unpublished. It says each on a line of its own now, and a
 * file writes a line break in a cell as " / " (zip.test-support.ts `safeCell`), as 0.6.1 wrote the one in this app's
 * text card. The rows on the categories and on the models list them one to a line as well, but this app has one
 * category and one model: those two rows are what 0.6.1 wrote. */
export const APP_ROW_ON_TWO_LINES = {
  was: 'App,Pages analysed,"1 of 1 (published versions); 1 unpublished, not analysed"\r\n',
  now: 'App,Pages analysed,"1 of 1 (published versions) / 1 unpublished, not analysed"\r\n',
} as const;

/** A Details file with rows written otherwise: each line of `rows` as it is written now, which the text must hold
 * exactly once as it was. `csv` is the file's text, with its byte order mark or without. */
export function withRowsReworded(csv: string, rows: readonly { was: string; now: string }[]): string {
  return rows.reduce((text, row) => {
    const parts = text.split(row.was);
    if (parts.length !== 2) throw new Error(`The Details file does not hold the row that is written otherwise exactly once: ${row.was}`);
    return parts.join(row.now);
  }, csv);
}

/** 0.6.1's text of App Details.csv as the file is written now: the five rows named, each as it is written now. */
export const withAppRowsSince = (csv: string): string => withRowsReworded(csv, [APP_ROW_ON_TWO_LINES, APP_ROW_REWORDED, ...APP_ROWS_FOR_THE_PAGE]);

/** The dash that the app's files hold where there is nothing to say, which is deliberately not what 0.6.1 wrote: 0.6.1
 * wrote an em dash, and the analysis writes a plain hyphen now (report.ts `NONE`). The dash stands alone in its cell. A
 * cell of an app's file is written guarded against formulas, and a cell that starts with a hyphen is written after an
 * apostrophe, so the cell is written as '- (zip.test-support.ts `safeCell`). Of this app's files, Pages, Cards, Grid
 * Sections, Action Buttons and Where Used hold the dash; App Details, Filters and Conditional Formatting hold none, and
 * neither does a model's zip, here or in golden-0.8.1.test-support.ts. */
export const APP_DASH_PLAIN = { was: "\u2014", now: "-" } as const;

/** 0.6.1's text of one of the app's files with the dash as it is written now (`APP_DASH_PLAIN`): each cell that held
 * 0.6.1's dash holds the hyphen, guarded as the file's cells are, and every other cell is as it was. A file without the
 * dash is given back as it is. 0.6.1 wrote the dash alone in its cell, and a cell that holds it with more beside it is
 * not one this knows how to write: it throws. `csv` is the file's text as toCsv wrote it, with its byte order mark or
 * without. */
export function withPlainDash(csv: string): string {
  if (!csv.includes(APP_DASH_PLAIN.was)) return csv;
  const [headers, ...rows] = parseCsv(csv).map(row => row.map(cell => {
    if (cell === APP_DASH_PLAIN.was) return safeCell(APP_DASH_PLAIN.now);
    if (cell.includes(APP_DASH_PLAIN.was)) throw new Error(`0.6.1's file holds the dash with more beside it in a cell: ${cell}`);
    return cell;
  }));
  // Every cell is written as it now stands, guarded already. toCsv starts the text with a byte order mark, which is kept
  // only where the text given had one.
  const text = toCsv(headers, rows, false);
  return csv.charCodeAt(0) === 0xfeff ? text : text.slice(1);
}

/** The app's zip as 0.6.1 wrote it but for those rows and the dash: every file's bytes as they are in `APP_ZIP_0_6_1`, with
 * those lines of App Details.csv replaced and each cell of the dash in the other files written as it is now, by zipStore
 * with the same time on every entry. A file that holds neither keeps its bytes. analyse.test.ts pins that zipStore
 * writes `APP_ZIP_0_6_1` itself, byte for byte, from the files as they are, so what differs from this zip differs from 0.6.1. */
export const APP_ZIP_REWORDED = zipStore(zipEntries(APP_ZIP_0_6_1).map(entry => {
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(entry.data);
  const now = withPlainDash(entry.name === "App Details.csv" ? withAppRowsSince(text) : text);
  return now === text ? entry : { name: entry.name, data: new TextEncoder().encode(now) };
}), ZIPPED_AT);

/** `<model> - Model Export - <date>.zip`: Model Details.csv and eleven Model settings files (Source Models was not exported). */
export const MODEL_ZIP_0_6_1 = bytes([
  "UEsDBBQAAAgAAMVjPF2cfIh+twgAALcIAAARAAAATW9kZWwgRGV0YWlscy5jc3bvu79TZWN0aW9uLERldGFpbCxWYWx1ZQ0KTW9kZWwsTW9kZWwsRGVtYW5kOiBwbGFuDQpNb2RlbCxXb3Jrc3BhY2",
  "UsV29ya3NwYWNlIG9uZQ0KTW9kZWwsTW9kZWwgSUQsRkVEQ0JBOTg3NjU0MzIxMEZFRENCQTk4NzY1NDMyMTANCk1vZGVsLFdvcmtzcGFjZSBJRCwwMTIzNDU2Nzg5YWJjZGVmMDEyMzQ1Njc4OWFi",
  "Y2RlZg0KRXhwb3J0LEV4cG9ydGVkIG9uLDIwMjYtMDktMjggMTI6MzAgVVRDDQpFeHBvcnQsRXhwb3J0ZWQgd2l0aCxDYXJkaWdhbiBkZXYNCkV4cG9ydCxBbmFwbGFuIGhvc3QsZXUyYS5hcHAuYW",
  "5hcGxhbi5jb20NCkZpbGVzLExpbmUgSXRlbXMuY3N2LDQgcm93cw0KRmlsZXMsTW9kdWxlcy5jc3YsMiByb3dzDQpGaWxlcyxHZW5lcmFsIExpc3RzLmNzdiwyIHJvd3MNCkZpbGVzLFByb2Nlc3Nl",
  "cy5jc3YsMSByb3dzDQpGaWxlcyxJbXBvcnRzLmNzdiwzIHJvd3MgKDIgbWF0Y2hlZCBpbiB0aGUgQWN0aW9ucyBsaXN0KQ0KRmlsZXMsSW1wb3J0IERhdGEgU291cmNlcy5jc3YsMSByb3dzDQpGaW",
  "xlcyxFeHBvcnRzLmNzdiwxIHJvd3MNCkZpbGVzLE90aGVyIEFjdGlvbnMuY3N2LDEgcm93cw0KRmlsZXMsVGltZSBSYW5nZXMuY3N2LDEgcm93cw0KRmlsZXMsVmVyc2lvbnMuY3N2LDIgcm93cw0K",
  "RmlsZXMsU291cmNlIE1vZGVscy5jc3YsTm90IGV4cG9ydGVkOiBUaGlzIG1vZGVsIHBhZ2UgaGFzIG5vIFJFTU9URV9NT0RFTCBheGlzLg0KRmlsZXMsTW9kZWwgQ2FsZW5kYXIuY3N2LDMxIHJvd3",
  "MNCkhvdyB0byByZWFkLExheW91dCwiRWFjaCBmaWxlIGlzIGxhaWQgb3V0IGFzIEFuYXBsYW4ncyBvd24gZXhwb3J0IG9mIHRoZSBzYW1lIE1vZGVsIHNldHRpbmdzIGdyaWQ6IGFuIHVubGFiZWxs",
  "ZWQgZmlyc3QgY29sdW1uLCB0aGVuIHRoZSBncmlkJ3MgY29sdW1ucywgd2l0aCBlYWNoIGNlbGwncyB1bmRlcmx5aW5nIHZhbHVlLiINCkhvdyB0byByZWFkLExpbmUgSXRlbXMsIkVhY2ggbW9kdW",
  "xlJ3Mgcm93IHNpdHMgYWJvdmUgaXRzIGxpbmUgaXRlbXMuIFJhdGlvIE51bWVyYXRvciBhbmQgUmF0aW8gRGVub21pbmF0b3IsIGFmdGVyIEFuYXBsYW4ncyBvd24gY29sdW1ucywgbmFtZSB0aGUg",
  "bGluZSBpdGVtcyBhIFJhdGlvIHN1bW1hcnkgZGl2aWRlczogdGhlIFN1bW1hcnkgSlNPTiBnaXZlcyBvbmx5IHRoZWlyIElEcy4iDQpIb3cgdG8gcmVhZCwiUHJvY2Vzc2VzLCBFeHBvcnRzIGFuZC",
  "BPdGhlciBBY3Rpb25zIiwiVGhlIEFjdGlvbnMgbGlzdCBzcGxpdCBhdCBpdHMgaGVhZGluZ3MsIGluIGl0cyBvd24gY29sdW1uczogZGVmaW5pdGlvbiwgbGFzdCBydW4gKHN0YXJ0IHRpbWUgYW5k",
  "IGR1cmF0aW9uKSwgbm90ZXMsIHRoZSBwcm9jZXNzZXMgdGhhdCB1c2UgZWFjaCBhY3Rpb24gYW5kIHRoZSBkYXNoYm9hcmRzIGl0IGFwcGVhcnMgb24uIg0KSG93IHRvIHJlYWQsSW1wb3J0cywiVG",
  "hlIEltcG9ydHMgdGFiIChzb3VyY2UgYW5kIHRhcmdldCksIHRoZW4gZWFjaCBpbXBvcnQncyBjb2x1bW5zIGZyb20gdGhlIEFjdGlvbnMgbGlzdCAobGFzdCBydW4sIGR1cmF0aW9uLCBub3Rlcywg",
  "VXNlZCBpbiBQcm9jZXNzZXMsIFVzZWQgaW4gRGFzaGJvYXJkcyksIG1hdGNoZWQgb24gdGhlIGltcG9ydCdzIElELiBUaGUgQWN0aW9ucyBsaXN0J3MgIiJJbXBvcnQgaW50byDigKYiIiB0ZXh0IG",
  "lzIGxlZnQgb3V0OiBUYXJnZXQgT2JqZWN0IGFuZCBUYXJnZXQgVHlwZSBzYXkgdGhlIHNhbWUuIg0KSG93IHRvIHJlYWQsSW1wb3J0IERhdGEgU291cmNlcywiRWFjaCBkYXRhIHNvdXJjZSwgd2l0",
  "aCB0aGUgaW1wb3J0cyB0aGF0IHVzZSBpdC4iDQpIb3cgdG8gcmVhZCxNb2RlbCBDYWxlbmRhciwiRm9sbG93cyB0aGUgYXNzZXNzbWVudCB0ZW1wbGF0ZS4gTW9udGhzIGFuZCBkYXlzIGFyZSB0aG",
  "VpciBuYW1lcywgYW5kIEN1cnJlbnQgRmlzY2FsIFllYXIgaXMgc2hvd24gd2l0aCBpdHMgZGF0ZXMsIGFzIHRoZSBNb2RlbCBDYWxlbmRhciB0YWIgc2hvd3MgaXQuIFNldHRpbmdzIHRoYXQgZG8g",
  "bm90IGFwcGx5IHRvIHRoaXMgY2FsZW5kYXIgdHlwZSBhcmUgYmxhbms7IE1vZGVsIHNpemUgKEdCKSBhbmQgQ2FwdHVyZWQgYnkgYXJlIGxlZnQgZm9yIHlvdSB0byBmaWxsIGluLiINCkRpYWdub3",
  "N0aWNzLDEyOjMwOjEwLExvYWRpbmcgdGhlIG1vZGVsIHBhZ2UncyBjbGllbnTigKYNCkRpYWdub3N0aWNzLDEyOjMwOjEwLExpbmUgSXRlbXM6IDQgcm93cyDDlyAzIGNvbHVtbnM7IGNvbHVtbnM6",
  "IEZvcm11bGEgfCBTdW1tYXJ5IHwgTm90ZXMNClBLAwQUAAAIAADFYzxdEou8MOIBAADiAQAADgAAAExpbmUgSXRlbXMuY3N277u/LEZvcm11bGEsU3VtbWFyeSxOb3RlcyxSYXRpbyBOdW1lcmF0b3",
  "IsUmF0aW8gRGVub21pbmF0b3INClByb2ZpdGFiaWxpdHksLCwsLA0KUHJvZml0LD1SZXZlbnVlIC0gQ29zdCwieyIic3VtbWFyeU1ldGhvZCIiOiIiU1VNIiJ9IiwiRmlyc3QgbGluZQpTZWNvbmQg",
  "bGluZSIsLA0KUmV2ZW51ZSxJRiBVbml0cyA+IDAgVEhFTiBVbml0cyAqIFByaWNlIEVMU0UgMCwieyIic3VtbWFyeU1ldGhvZCIiOiIiU1VNIiJ9IiwiU2F5cyAiImdyb3NzIiIsIGJlZm9yZSB0YX",
  "giLCwNCk1hcmdpbiAlLFByb2ZpdCAvIFJldmVudWUsInsiInN1bW1hcnlNZXRob2QiIjoiIlJBVElPIiIsIiJ0aW1lU3VtbWFyeU1ldGhvZCIiOiIiUkFUSU8iIiwiInJhdGlvTnVtZXJhdG9ySWRl",
  "bnRpZmllciIiOiIiXzE5MDEwMDAwMDAwMDFfIiIsIiJyYXRpb0Rlbm9taW5hdG9ySWRlbnRpZmllciIiOiIiXzE5MDEwMDAwMDAwMDJfIiJ9IiwtMSsxLFByb2ZpdCxSZXZlbnVlDQpQSwMEFAAACA",
  "AAxWM8XY7c4jFYAAAAWAAAAAsAAABNb2R1bGVzLmNzdu+7vyxBcHBsaWVzIFRvLENlbGwgQ291bnQNClByb2ZpdGFiaWxpdHksIlByb2R1Y3RzLCBUaW1lIiwyMjUyMDY4DQotLSBNT0RFTCBBRE1J",
  "TiwtLDEyDQpQSwMEFAAACAAAxWM8XRmg3MdSAAAAUgAAABEAAABHZW5lcmFsIExpc3RzLmNzdu+7vyxUb3AgTGV2ZWwgSXRlbSxQcm9kdWN0aW9uIERhdGENClByb2R1Y3RzLEFsbCBQcm9kdWN0cy",
  "x0cnVlDQorIFJlZ2lvbnMsLGZhbHNlDQpQSwMEFAAACAAAxWM8XcqXq0+lAAAApQAAAA0AAABQcm9jZXNzZXMuY3N277u/LEFjdGlvbixTdGFydCBEYXRlIGFuZCBUaW1lIChVVEMpLE1vc3QgcmVj",
  "ZW50IGR1cmF0aW9uIChtcyksTm90ZXMsVXNlZCBpbiBQcm9jZXNzZXMsVXNlZCBpbiBEYXNoYm9hcmRzDQpOaWdodGx5IGxvYWQsLDIwMjYtMDMtMTIgMjM6MTk6NTYsNTgyLFJ1bnMgYXQgMmFtLC",
  "xBZG1pbg0KUEsDBBQAAAgAAMVjPF2JuDD2uQEAALkBAAALAAAASW1wb3J0cy5jc3bvu78sU291cmNlIExhYmVsLFNvdXJjZSBPYmplY3QsU291cmNlIFR5cGUsVGFyZ2V0IE9iamVjdCxUYXJnZXQg",
  "VHlwZSxQcm9kdWN0aW9uIERhdGEsU3RhcnQgRGF0ZSBhbmQgVGltZSAoVVRDKSxNb3N0IHJlY2VudCBkdXJhdGlvbiAobXMpLE5vdGVzLFVzZWQgaW4gUHJvY2Vzc2VzLFVzZWQgaW4gRGFzaGJvYX",
  "Jkcw0KMS4xIExvYWQgcmVnaW9ucyxIdWIgLyBSZWdpb25zLEh1YiAvICdMSVNUIC0gUmVnaW9ucycuRXhwb3J0LFNBVkVEIFZJRVcsUmVnaW9ucyxMSVNULGZhbHNlLCwsRnJvbSB0aGUgaHViLCJO",
  "aWdodGx5IGxvYWQsIFdlZWtseSBsb2FkIiwNClByaWNlcyBmcm9tIHByaWNlcy5jc3YscHJpY2VzLmNzdiwtLEZJTEUsUHJpY2VzLE1PRFVMRSxmYWxzZSwyMDI2LTAzLTEyIDIzOjE5OjU2LDU4Mi",
  "wsTmlnaHRseSBsb2FkLA0KT2xkIGltcG9ydCwsLCwsLCwsLCwsDQpQSwMEFAAACAAAxWM8Xdw+NsZCAAAAQgAAABcAAABJbXBvcnQgRGF0YSBTb3VyY2VzLmNzdu+7vyxUeXBlLFVzZWQgaW4gSW1w",
  "b3J0cw0KcHJpY2VzLmNzdixGSUxFLFByaWNlcyBmcm9tIHByaWNlcy5jc3YNClBLAwQUAAAIAADFYzxd+95lvaoAAACqAAAACwAAAEV4cG9ydHMuY3N277u/LEFjdGlvbixTdGFydCBEYXRlIGFuZC",
  "BUaW1lIChVVEMpLE1vc3QgcmVjZW50IGR1cmF0aW9uIChtcyksTm90ZXMsVXNlZCBpbiBQcm9jZXNzZXMsVXNlZCBpbiBEYXNoYm9hcmRzDQpTZW5kIHBsYW4sInsiImV4cG9ydFR5cGUiIjoiIkdS",
  "SURfQ1VSUkVOVF9QQUdFIiJ9IiwsLCwsUmV2aWV3DQpQSwMEFAAACAAAxWM8XabSr825AAAAuQAAABEAAABPdGhlciBBY3Rpb25zLmNzdu+7vyxBY3Rpb24sU3RhcnQgRGF0ZSBhbmQgVGltZSAoVV",
  "RDKSxNb3N0IHJlY2VudCBkdXJhdGlvbiAobXMpLE5vdGVzLFVzZWQgaW4gUHJvY2Vzc2VzLFVzZWQgaW4gRGFzaGJvYXJkcw0KRGVsZXRlIG9sZCBpdGVtcywieyIiYWN0aW9uVHlwZSIiOiIiREVM",
  "RVRFX0JZX1NFTEVDVElPTiIifSIsLCwsTmlnaHRseSBsb2FkLA0KUEsDBBQAAAgAAMVjPF2//9zAMgAAADIAAAAPAAAAVGltZSBSYW5nZXMuY3N277u/LFN0YXJ0IFBlcmlvZCxFbmQgUGVyaW9kDQ",
  "pGWTI0LUZZMjUsRlkyNCxGWTI1DQpQSwMEFAAACAAAxWM8XZodO15IAAAASAAAAAwAAABWZXJzaW9ucy5jc3bvu78sSXMgQWN0dWFsLFN3aXRjaG92ZXINCkFjdHVhbCx0cnVlLA0KRm9yZWNhc3Qs",
  "ZmFsc2UsQEN1cnJlbnQgUGVyaW9kDQpQSwMEFAAACAAAxWM8XduccDYpDQAAKQ0AABIAAABNb2RlbCBDYWxlbmRhci5jc3bvu79TZWN0aW9uLFNldHRpbmcsVmFsdWUsQWxsb3dlZCB2YWx1ZXMsQX",
  "BwbGllcyB0byxOb3Rlcw0KTW9kZWwsV29ya3NwYWNlLFdvcmtzcGFjZSBvbmUsVGV4dCxBbGwsQXMgc2hvd24gaW4gdGhlIG1vZGVsIGhlYWRlci4NCk1vZGVsLE1vZGVsLERlbWFuZDogcGxhbixU",
  "ZXh0LEFsbCwiRXhhY3QgbW9kZWwgbmFtZSwgbWF0Y2hpbmcgdGhlIEJsdWVwcmludCBleHBvcnRzIGluIHRoZSBzYW1lIGZvbGRlci4iDQpNb2RlbCxNb2RlbCBzaXplIChHQiksLE51bWJlcixBbG",
  "wsRnJvbSBNYW5hZ2UgTW9kZWxzIGF0IHRoZSB0aW1lIG9mIGV4cG9ydC4gQW5jaG9ycyBjZWxsIGZpbmRpbmdzIHRvIG1lbW9yeS4NCk1vZGVsLENhcHR1cmVkIG9uLDIwMjYtMDktMjgsWVlZWS1N",
  "TS1ERCxBbGwsU2FtZSBkYXkgYXMgdGhlIEJsdWVwcmludCBleHBvcnRzLg0KTW9kZWwsQ2FwdHVyZWQgYnksLFRleHQsQWxsLA0KTW9kZWwgQ2FsZW5kYXIsQ2FsZW5kYXIgVHlwZSwiV2Vla3M6ID",
  "QtNC01LCA0LTUtNCBvciA1LTQtNCIsIkNhbGVuZGFyIE1vbnRocy9RdWFydGVycy9ZZWFycyB8IFdlZWtzOiA0LTQtNSwgNC01LTQgb3IgNS00LTQgfCBXZWVrczogMTMgNC13ZWVrIFBlcmlvZHMg",
  "fCBXZWVrczogR2VuZXJhbCIsQWxsLERlY2lkZXMgd2hpY2ggb2YgdGhlIHJvd3MgYmVsb3cgYXBwbHk7IGxlYXZlIHRoZSBvdGhlcnMgYmxhbmsuDQpNb2RlbCBDYWxlbmRhcixGaXNjYWwgWWVhci",
  "BTdGFydHMsLEphbiB8IEZlYiB8IE1hciB8IEFwciB8IE1heSB8IEp1biB8IEp1bCB8IEF1ZyB8IFNlcCB8IE9jdCB8IE5vdiB8IERlYyxNb250aHMsTW9udGggY2FsZW5kYXJzIG9ubHkuDQpNb2Rl",
  "bCBDYWxlbmRhcixXZWVrIEdyb3VwaW5nIGludG8gTW9udGhzIC8gUXRycywsNC00LTUgfCA0LTUtNCB8IDUtNC00LFdlZWtzIDQtNC01LA0KTW9kZWwgQ2FsZW5kYXIsRW5kIG9mIEZpc2NhbCBZZW",
  "FyIGlzLExhc3QsTGFzdCB8IE5lYXJlc3QsIldlZWtzIDQtNC01LCBXZWVrcyAxM3g0IixMYXN0ID0gJ0xhc3QgPGRheT4gaW4gPG1vbnRoPic7IE5lYXJlc3QgPSAnPGRheT4gbmVhcmVzdCB0byBl",
  "bmQgb2YgPG1vbnRoPicuDQpNb2RlbCBDYWxlbmRhcixFbmQgb2YgRmlzY2FsIFllYXIgLSBkYXksU2F0LE1vbiB8IFR1ZSB8IFdlZCB8IFRodSB8IEZyaSB8IFNhdCB8IFN1biwiV2Vla3MgNC00LT",
  "UsIFdlZWtzIDEzeDQiLA0KTW9kZWwgQ2FsZW5kYXIsRW5kIG9mIEZpc2NhbCBZZWFyIC0gbW9udGgsRGVjLEphbiB8IEZlYiB8IE1hciB8IEFwciB8IE1heSB8IEp1biB8IEp1bCB8IEF1ZyB8IFNl",
  "cCB8IE9jdCB8IE5vdiB8IERlYywiV2Vla3MgNC00LTUsIFdlZWtzIDEzeDQiLA0KTW9kZWwgQ2FsZW5kYXIsVGltZXNjYWxlLDItZGlnaXQgZm9ybWF0LDItZGlnaXQgZm9ybWF0IHwgNC1kaWdpdC",
  "Bmb3JtYXQsQWxsLFllYXIgZGlnaXRzIGluIHBlcmlvZCBuYW1lcy4NCk1vZGVsIENhbGVuZGFyLEZpc2NhbCBZZWFyIExhYmVsLEZZLFRleHQsIk1vbnRocywgV2Vla3MgNC00LTUsIFdlZWtzIDEz",
  "eDQiLGUuZy4gRlkNCk1vZGVsIENhbGVuZGFyLEZpc2NhbCBZZWFyIExhYmVsIGlzIGFsaWduZWQgd2l0aCxFbmQgV2VlayBvZiB0aGUgRmlzY2FsIFllYXIsRW5kIFdlZWsgb2YgdGhlIEZpc2NhbC",
  "BZZWFyIHwgU3RhcnQgV2VlayBvZiB0aGUgRmlzY2FsIFllYXIsIk1vbnRocywgV2Vla3MgNC00LTUsIFdlZWtzIDEzeDQiLExlYXZlIGJsYW5rIGlmIHRoZSBtb2RlbCBkb2VzIG5vdCBzaG93IGl0",
  "Lg0KTW9kZWwgQ2FsZW5kYXIsQ3VycmVudCBGaXNjYWwgWWVhcixGWTI0OiAzMSBEZWMgMjAyMyAtIDI4IERlYyAyMDI0LEFzIHNob3duLCJNb250aHMsIFdlZWtzIDQtNC01LCBXZWVrcyAxM3g0Ii",
  "wiQ29weSB0aGUgZnVsbCB0ZXh0IGluY2x1ZGluZyBkYXRlcywgZS5nLiBGWTI0OiAzMSBEZWMgMjAyMyAtIDI4IERlYyAyMDI0LiINCk1vZGVsIENhbGVuZGFyLE51bWJlciBvZiBQYXN0IFllYXJz",
  "LDEsV2hvbGUgbnVtYmVyLCJNb250aHMsIFdlZWtzIDQtNC01LCBXZWVrcyAxM3g0IiwiV2l0aCBGdXR1cmUgWWVhcnMgYW5kIHRoZSBjdXJyZW50IHllYXIsIHNldHMgdGhlIG1vZGVsIGNhbGVuZG",
  "FyIGhvcml6b24uIg0KTW9kZWwgQ2FsZW5kYXIsTnVtYmVyIG9mIEZ1dHVyZSBZZWFycywsV2hvbGUgbnVtYmVyLCJNb250aHMsIFdlZWtzIDQtNC01LCBXZWVrcyAxM3g0IiwNCk1vZGVsIENhbGVu",
  "ZGFyLEV4dHJhIFdlZWsgZm9yIDUzLVdlZWsgWWVhciBmYWxscyBpbiBQZXJpb2QsLFBlcmlvZCBudW1iZXIsIldlZWtzIDQtNC01LCBXZWVrcyAxM3g0IiwNCk1vZGVsIENhbGVuZGFyLEV4dHJhIF",
  "BlcmlvZCBmYWxscyBpbiBRdWFydGVyLCwxIHwgMiB8IDMgfCA0LFdlZWtzIDEzeDQsMTMgNC13ZWVrIHBlcmlvZHMgb25seS4NCk1vZGVsIENhbGVuZGFyLFdlZWsgRm9ybWF0LCxBcyBzaG93biAo",
  "ZS5nLiBOdW1iZXJlZCksV2Vla3MsDQpNb2RlbCBDYWxlbmRhcixTdGFydCBEYXRlLCxZWVlZLU1NLURELFdlZWtzIEdlbmVyYWwsV2Vla3M6IEdlbmVyYWwgb25seS4NCk1vZGVsIENhbGVuZGFyLE",
  "51bWJlciBvZiBXZWVrcywsV2hvbGUgbnVtYmVyLFdlZWtzIEdlbmVyYWwsV2Vla3M6IEdlbmVyYWwgb25seS4NCk1vZGVsIENhbGVuZGFyLEN1cnJlbnQgUGVyaW9kLCwiQXMgc2hvd24sIG9yIGJs",
  "YW5rIixBbGwsQmxhbmsgbWVhbnMgbm90IHNldC4NCk1vZGVsIENhbGVuZGFyLEluY2x1ZGUgUXVhcnRlciBUb3RhbHMsWWVzLFllcyB8IE5vLCJNb250aHMsIFdlZWtzIDQtNC01LCBXZWVrcyAxM3",
  "g0IiwNCk1vZGVsIENhbGVuZGFyLEluY2x1ZGUgSGFsZi1ZZWFyIFRvdGFscywsWWVzIHwgTm8sIk1vbnRocywgV2Vla3MgNC00LTUsIFdlZWtzIDEzeDQiLA0KTW9kZWwgQ2FsZW5kYXIsSW5jbHVk",
  "ZSBZZWFyIFRvIERhdGUsLFllcyB8IE5vLFdoZXJlIHNob3duLExlYXZlIGJsYW5rIGlmIHRoZSBtb2RlbCBkb2VzIG5vdCBzaG93IGl0Lg0KTW9kZWwgQ2FsZW5kYXIsSW5jbHVkZSBZZWFyIFRvIE",
  "dvLCxZZXMgfCBObyxXaGVyZSBzaG93bixMZWF2ZSBibGFuayBpZiB0aGUgbW9kZWwgZG9lcyBub3Qgc2hvdyBpdC4NCk1vZGVsIENhbGVuZGFyLEluY2x1ZGUgVG90YWwgb2YgQWxsIFBlcmlvZHMs",
  "LFllcyB8IE5vLEFsbCwNCk1vZGVsIENhbGVuZGFyLFBlcmlvZCBMYWJlbCwsVGV4dCxXaGVyZSBzaG93bixMZWF2ZSBibGFuayBpZiB0aGUgbW9kZWwgZG9lcyBub3Qgc2hvdyBpdC4NCk1vZGVsIE",
  "NhbGVuZGFyLFF1YXJ0ZXIgTGFiZWwsLFRleHQsV2hlcmUgc2hvd24sTGVhdmUgYmxhbmsgaWYgdGhlIG1vZGVsIGRvZXMgbm90IHNob3cgaXQuDQpNb2RlbCBDYWxlbmRhcixIYWxmLVllYXIgTGFi",
  "ZWwsLFRleHQsV2hlcmUgc2hvd24sTGVhdmUgYmxhbmsgaWYgdGhlIG1vZGVsIGRvZXMgbm90IHNob3cgaXQuDQpQSwECFAAUAAAIAADFYzxdnHyIfrcIAAC3CAAAEQAAAAAAAAAAAAAAAAAAAAAATW",
  "9kZWwgRGV0YWlscy5jc3ZQSwECFAAUAAAIAADFYzxdEou8MOIBAADiAQAADgAAAAAAAAAAAAAAAADmCAAATGluZSBJdGVtcy5jc3ZQSwECFAAUAAAIAADFYzxdjtziMVgAAABYAAAACwAAAAAAAAAA",
  "AAAAAAD0CgAATW9kdWxlcy5jc3ZQSwECFAAUAAAIAADFYzxdGaDcx1IAAABSAAAAEQAAAAAAAAAAAAAAAAB1CwAAR2VuZXJhbCBMaXN0cy5jc3ZQSwECFAAUAAAIAADFYzxdyperT6UAAAClAAAADQ",
  "AAAAAAAAAAAAAAAAD2CwAAUHJvY2Vzc2VzLmNzdlBLAQIUABQAAAgAAMVjPF2JuDD2uQEAALkBAAALAAAAAAAAAAAAAAAAAMYMAABJbXBvcnRzLmNzdlBLAQIUABQAAAgAAMVjPF3cPjbGQgAAAEIA",
  "AAAXAAAAAAAAAAAAAAAAAKgOAABJbXBvcnQgRGF0YSBTb3VyY2VzLmNzdlBLAQIUABQAAAgAAMVjPF373mW9qgAAAKoAAAALAAAAAAAAAAAAAAAAAB8PAABFeHBvcnRzLmNzdlBLAQIUABQAAAgAAM",
  "VjPF2m0q/NuQAAALkAAAARAAAAAAAAAAAAAAAAAPIPAABPdGhlciBBY3Rpb25zLmNzdlBLAQIUABQAAAgAAMVjPF2//9zAMgAAADIAAAAPAAAAAAAAAAAAAAAAANoQAABUaW1lIFJhbmdlcy5jc3ZQ",
  "SwECFAAUAAAIAADFYzxdmh07XkgAAABIAAAADAAAAAAAAAAAAAAAAAA5EQAAVmVyc2lvbnMuY3N2UEsBAhQAFAAACAAAxWM8XduccDYpDQAAKQ0AABIAAAAAAAAAAAAAAAAAqxEAAE1vZGVsIENhbG",
  "VuZGFyLmNzdlBLBQYAAAAADAAMANsCAAAEHwAAAAA=",
].join(""));

/** A column of the model's files that is deliberately not what 0.6.1 wrote. Line Items.csv has a column more, its last:
 * "Format List", which names the list of a line item formatted as a list (model/lineitems.ts). The model this zip was
 * made from has no Format column in its Line Items grid, so no line item of it is formatted as a list and the column is
 * empty in every row: the file's first line gains the column's name as a last cell, and every other line an empty one.
 *
 * Besides the build's name, this column, the column of Other Actions.csv (`MODEL_ACTIONS_COLUMN_ADDED`), the rows that
 * describe the two (`MODEL_ROW_REWORDED`, `MODEL_ACTIONS_ROW_REWORDED`), three more rows of "How to read"
 * (`MODEL_ROWS_FOR_THE_PAGE` and `IMPORTS_ROW_REWORDED`), the two rows about a file this model does not get
 * (`MODEL_FILE_ADDED`) and the row on Source Models (`MODEL_ROW_ADDED`) are the only places where this model's files are
 * known to differ from 0.6.1's. The name is in the "Exported with" row and, for a model page opened on its own, in the
 * first Diagnostics line, and does not show in a comparison here, for the reasons given at `APP_ROW_REWORDED`. */
export const MODEL_COLUMN_ADDED = { file: "Line Items.csv", header: "Format List" } as const;

/** The other column of the model's files that is deliberately not what 0.6.1 wrote. Other Actions.csv has a column more,
 * its last: "Action List", which names the list an action deletes from or orders (model/actions.ts). The model this zip
 * was made from has one other action, a Delete from List using Selection whose definition names no list, so the column
 * is empty in its row: the file's first line gains the column's name as a last cell, and its other line an empty one. */
export const MODEL_ACTIONS_COLUMN_ADDED = { file: "Other Actions.csv", header: "Action List" } as const;

/** A column the export adds after the others of one of a model's files: the file, and the column's name. */
export interface ColumnAdded { readonly file: string; readonly header: string }

/** The text of one of those files as an earlier version wrote it, with the column added: each line as it is, with the
 * one cell added at its end. `csv` is the file's text as toCsv wrote it, with its byte order mark or without. */
export function withColumnAdded(csv: string, column: ColumnAdded): string {
  const lines = csv.split("\r\n");
  // A row is a line: the text ends in a line end, and no cell holds one. (A line that ends inside a quoted cell has an odd
  // number of quotes. Line Items.csv has a cell with a line break in it, which is a line feed alone.)
  if (lines.pop() !== "" || lines.some(line => line.split("\"").length % 2 === 0)) throw new Error(`${column.file} does not hold one row a line.`);
  return lines.map((line, index) => `${line},${index === 0 ? column.header : ""}\r\n`).join("");
}

/** The row of the model's Model Details.csv on Line Items, which is deliberately not what 0.6.1 wrote, as the row's
 * whole line of the file. It has been written otherwise twice.
 * - It named the two columns that the export added after Anaplan's own, which were all it added. The file has a third
 *   since (`MODEL_COLUMN_ADDED`), and the row says what each of the three holds. (0.8.1 wrote it so: its words then are
 *   in golden-0.8.1.test-support.ts.)
 * - It described the file: each module's row above its line items, and Anaplan's own columns first and unchanged. Since
 *   the results page stopped offering a result for download, the row is read on the page's overview and is to say what
 *   the page's Line Items table shows: line items only, each with its module after its name, and with the dimensions
 *   it has under Applies To, where Applies To from says whose they are (results/line-items-view.ts). A Summary's and a
 *   Format's JSON is the definition, which the table says in words. And General Lists is a table, not a file. */
export const MODEL_ROW_REWORDED = {
  file: "Model Details.csv",
  was: `How to read,Line Items,"Each module's row sits above its line items. Ratio Numerator and Ratio Denominator, after Anaplan's own columns, name the line items a Ratio summary divides: the Summary JSON gives only their IDs."\r\n`,
  now: `How to read,Line Items,"The table lists line items: each names its module under Module Name, after its own name, and a module's own row is not listed. Applies To holds the dimensions a line item has, its module's where it has none of its own, and Applies To from says which. Three columns follow Anaplan's own. Ratio Numerator and Ratio Denominator name the line items a Ratio summary divides: the Summary's definition gives only their IDs. Format List names the list of a line item formatted as a list, as the General Lists table names it: the Format's definition gives only the list's ID. It is empty for any other format, for a list that is not in General Lists, such as a list subset or a line item subset, and when General Lists was not exported."\r\n`,
} as const;

/** The row of the model's Model Details.csv on the Actions list's three files, which is deliberately not what 0.6.1
 * wrote, as the row's whole line of the file. It named what the files hold, which was the Actions list's own columns
 * alone. Other Actions.csv has a column more since (`MODEL_ACTIONS_COLUMN_ADDED`), and the row says what it holds, as the
 * row on Line Items says what Format List holds. 0.8.1 wrote the row as 0.6.1 did. */
export const MODEL_ACTIONS_ROW_REWORDED = {
  file: "Model Details.csv",
  was: `How to read,"Processes, Exports and Other Actions","The Actions list split at its headings, in its own columns: definition, last run (start time and duration), notes, the processes that use each action and the dashboards it appears on."\r\n`,
  now: `How to read,"Processes, Exports and Other Actions","The Actions list split at its headings, in its own columns: definition, last run (start time and duration), notes, the processes that use each action and the dashboards it appears on. One column follows Anaplan's own in Other Actions. Action List names the list an action deletes from or orders, as the General Lists table names it: the Action's definition gives only the list's ID. It is empty for any other action, for a list that is not in General Lists, and when General Lists was not exported."\r\n`,
} as const;

/** Two more rows of the model's Model Details.csv that are deliberately not what 0.6.1 wrote since the results page
 * stopped offering a result for download, each as the row's whole line of the file. Like the row on Line Items they are
 * read on the page's overview, and are to say what the page shows.
 * - `layout` said that each file has an unlabelled first column and each cell's underlying value. The page names that
 *   column, as Name, and says a Format, a Summary and an Action in words where it has words for the definition: the row
 *   says so, and that a row's details add the definition as it was read.
 * - `calendar` ended by saying that Model size (GB) and Captured by are left for the reader to fill in. That was for a
 *   file to write into. On the page those two rows have no value and are shown nowhere. Nor are the settings with no
 *   value, which do not apply to the calendar type: the row says the table lists the settings that hold a value. */
export const MODEL_ROWS_FOR_THE_PAGE = {
  layout: {
    was: `How to read,Layout,"Each file is laid out as Anaplan's own export of the same Model settings grid: an unlabelled first column, then the grid's columns, with each cell's underlying value."\r\n`,
    now: `How to read,Layout,"Each table is laid out as Anaplan's own export of the same Model settings grid: each row's name first, then the grid's columns, with each cell's underlying value. Where a Format, a Summary or an Action holds a definition that can be said in words, the table says the words, and a row's details add the definition as it was read."\r\n`,
  },
  calendar: {
    was: `How to read,Model Calendar,"Follows the assessment template. Months and days are their names, and Current Fiscal Year is shown with its dates, as the Model Calendar tab shows it. Settings that do not apply to this calendar type are blank; Model size (GB) and Captured by are left for you to fill in."\r\n`,
    now: `How to read,Model Calendar,"Lists the calendar's settings that hold a value: those that do not apply to this calendar type, or that the model does not show, are left out. Months and days are their names, and Current Fiscal Year is shown with its dates, as the Model Calendar tab shows it."\r\n`,
  },
} as const;

/** The row of "How to read" on Imports, which is deliberately not what 0.6.1 wrote, and not what 0.8.1 wrote either (the
 * two wrote it alike), as the row's whole line of the file. Since the results page shows an import's Source Object as
 * three columns, Source Model, Source Module and Saved View (results/result-view.ts), the row says so after what it said,
 * as the rows of "How to read" say what the page shows. */
export const IMPORTS_ROW_REWORDED = {
  was: `How to read,Imports,"The Imports tab (source and target), then each import's columns from the Actions list (last run, duration, notes, Used in Processes, Used in Dashboards), matched on the import's ID. The Actions list's ""Import into …"" text is left out: Target Object and Target Type say the same."\r\n`,
  now: `How to read,Imports,"The Imports tab (source and target), then each import's columns from the Actions list (last run, duration, notes, Used in Processes, Used in Dashboards), matched on the import's ID. The Actions list's ""Import into …"" text is left out: Target Object and Target Type say the same. Source Object is shown as three columns, Source Model, Source Module and Saved View, for an import from a module or a saved view: Source Model names this model where the import reads from this model itself. A row's details add Source Object as it was read. Any other Source Object stands as it is under Source Model."\r\n`,
} as const;

/** 0.6.1's text of that file with the five rows as they are written now, the one on Line Items, the one on the Actions
 * list's files, the one on Imports and the two above, in the file's order: every other line as it is. `csv` is the
 * file's text, with its byte order mark or without. */
export const withRowsSince = (csv: string): string =>
  withRowsReworded(csv, [MODEL_ROWS_FOR_THE_PAGE.layout, MODEL_ROW_REWORDED, MODEL_ACTIONS_ROW_REWORDED, IMPORTS_ROW_REWORDED, MODEL_ROWS_FOR_THE_PAGE.calendar]);

/** The one file the export has gained since 0.6.1: Dynamic Cell Access.csv, which lists a model's access drivers with
 * what each controls (model/access.ts). The export makes it from the Read Access Driver and Write Access Driver columns
 * of Line Items.csv, by the module its Module Name column gives each line item, and reads nothing for it. The model this
 * zip was made from has none of the three columns in its Line Items grid, so the file is not written for it, and its
 * zip holds the twelve files it held. What differs is Model Details.csv, which says of every file the export knows
 * whether it was written and how to read it: it has two rows more, each given here as the row's whole line of the file,
 * with the line it stands after. `notWritten` says that the file was not exported and why, right after the row for Line
 * Items.csv, which is the file's place among the files. `howToRead` says how to read the file, right after the row on
 * Line Items. Like the other rows of "How to read" it is read on the page's overview: it speaks of the Line Items table
 * and of this one, where it spoke of two files, and says of a row for a module's own driver that the Line Items table
 * does not list the row it is set on.
 *
 * A model that has the three columns gets the file. The zip that the last version without it wrote for such a model,
 * and what differs from that zip, are in golden-0.8.1.test-support.ts. */
export const MODEL_FILE_ADDED = {
  file: "Dynamic Cell Access.csv",
  details: "Model Details.csv",
  notWritten: {
    after: "Files,Line Items.csv,4 rows\r\n",
    line: `Files,Dynamic Cell Access.csv,"Not exported: Line Items has no Module Name, Read Access Driver and Write Access Driver columns."\r\n`,
  },
  howToRead: {
    after: MODEL_ROW_REWORDED.now,
    line: `How to read,Dynamic Cell Access,"Not a Model settings grid: the Read Access Driver and Write Access Driver columns of Line Items, listed from the driver's side. One row for each use of a driver: the driver, Read or Write, and what it controls, each by module and name as Line Items has them. Rows follow the drivers' order in Line Items, Read before Write. A row with no Controlled Line Item is a module's own: its driver is set on the module's own row, which the Line Items table does not list. A line item that shows a dash is listed with its module's driver. A driver that could not be matched comes last, once for its cell, with no Driver Module and the cell as it is written. That includes a driver that sits in a row the model map leaves out, which About this map counts. The table is not made when Line Items was not exported or lacks its Module Name column or a driver column."\r\n`,
  },
} as const;

/** The row of "How to read" that every model's Model Details.csv has gained since the results page shows a source
 * model's Mapped To as two columns, Mapped Workspace and Mapped Model, by the names the cell holds (results/result-view.ts),
 * as the row's whole line of the file, with the line it stands after. Like the other rows of "How to read" it is read on
 * the page's overview, and says what the page shows. It is the last of them, after the row on the calendar. The model
 * of this zip has no Source Models grid, and the model of 0.8.1's zip (golden-0.8.1.test-support.ts) neither: the row is
 * all that differs of it for either, since every model's Model Details.csv has it, whether that grid was read or not. */
export const MODEL_ROW_ADDED = {
  after: MODEL_ROWS_FOR_THE_PAGE.calendar.now,
  line: `How to read,Source Models,"Mapped To is shown as two columns, Mapped Workspace and Mapped Model: the workspace and the model each source model is mapped to, by name, or by ID where Mapped To gives no name. A row's details add Mapped To as it was read. A Mapped To that cannot be read stands as it is under Mapped Workspace."\r\n`,
} as const;

/** A Model Details.csv with rows added: each line of `rows` right after the line it stands after, which the text must
 * hold exactly once. `csv` is the file's text, with its byte order mark or without. */
export function withRowsAdded(csv: string, rows: readonly { after: string; line: string }[]): string {
  return rows.reduce((text, row) => {
    const parts = text.split(row.after);
    if (parts.length !== 2) throw new Error(`Model Details.csv does not hold the line a row is added after exactly once: ${row.after}`);
    return parts.join(`${row.after}${row.line}`);
  }, csv);
}

/** 0.6.1's text of Model Details.csv as the file is written now: the four rows of "How to read" in their present words,
 * the two rows about Dynamic Cell Access.csv added, and the row on Source Models. */
export const withDetailsSince = (csv: string): string => withRowsAdded(withRowsSince(csv), [MODEL_FILE_ADDED.notWritten, MODEL_FILE_ADDED.howToRead, MODEL_ROW_ADDED]);

/** The two columns named above, in the order of their files in the zip. */
export const MODEL_COLUMNS_ADDED: readonly ColumnAdded[] = [MODEL_COLUMN_ADDED, MODEL_ACTIONS_COLUMN_ADDED];

/** The model's zip as 0.6.1 wrote it but for what is named above: every file's bytes as they are in `MODEL_ZIP_0_6_1`,
 * with the cell added to each line of Line Items.csv and of Other Actions.csv, and with five lines of Model Details.csv
 * replaced and three added, written by zipStore with the same time on every entry. model/model.test.ts pins that
 * zipStore writes `MODEL_ZIP_0_6_1` itself, byte for byte, from the files as they are, so what differs from this zip
 * differs from 0.6.1. */
export const MODEL_ZIP_AS_NAMED = zipStore(zipEntries(MODEL_ZIP_0_6_1).map(entry => {
  const text = (): string => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(entry.data);
  const column = MODEL_COLUMNS_ADDED.find(added => added.file === entry.name);
  const written = column ? withColumnAdded(text(), column) : entry.name === MODEL_ROW_REWORDED.file ? withDetailsSince(text()) : undefined;
  return written === undefined ? entry : { name: entry.name, data: new TextEncoder().encode(written) };
}), ZIPPED_AT);
