import { zipStore } from "./zip.js";
import { zipEntries } from "./zip.test-support.js";

/** Two zips exactly as version 0.6.1 (commit 4eb457a) wrote them, kept here as base64: the app in analyse.test.ts (`analyseGoldenApp`) and the
 * model in model/model.test.ts (`exportGoldenModel`). 0.6.1 built its zip inside the analysis; the analysis now returns tables
 * and result-zip.ts builds the zip, and these pin that the bytes did not change. Tests only.
 *
 * Made once by running 0.6.1's own analyseApp and exportModel on those fixtures, with the clock at 2026-09-28 12:30:10 UTC and
 * the time zone UTC (a zip entry carries its time as local time). Never regenerate them from newer code: a difference means the
 * export changed. What is deliberately written otherwise since is named below, a row of the app's files, and of the model's
 * a column, a row, and the two rows about a file the export has gained (`APP_ROW_REWORDED`, `MODEL_COLUMN_ADDED`,
 * `MODEL_ROW_REWORDED`, `MODEL_FILE_ADDED`): a test then compares with 0.6.1's zip but for what is named, and the zips
 * themselves stay as they are. */

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
 * case: the name where the model gives one, the ID otherwise.
 *
 * It is the third place where this app's files are known to differ from 0.6.1's. The other two name the build: the
 * "Exported with" row and the first Diagnostics line. Neither shows in a comparison here: the zip above was made by a build
 * that calls itself "dev", as a build under test does, and a test either gives the run the log that 0.6.1 was given or
 * leaves the Diagnostics rows, which are a run's own log, out of the comparison. */
export const APP_ROW_REWORDED = {
  was: "How to read,Filter context,Filter-context items show their IDs; their names are not looked up.\r\n",
  now: `How to read,Filter context and values,"An item in a filter rule, whether chosen as the filter context or compared with a line item formatted as a list, is shown by its name where the model gives one, and by its ID otherwise. If a context item has no name, the rule's line item and context are listed together in place of the line item's name."\r\n`,
} as const;

/** The app's zip as 0.6.1 wrote it but for that row: every file's bytes as they are in `APP_ZIP_0_6_1`, with that one line
 * of App Details.csv replaced, written by zipStore with the same time on every entry. analyse.test.ts pins that zipStore
 * writes `APP_ZIP_0_6_1` itself, byte for byte, from the files as they are, so what differs from this zip differs from 0.6.1. */
export const APP_ZIP_REWORDED = zipStore(zipEntries(APP_ZIP_0_6_1).map(entry => {
  if (entry.name !== "App Details.csv") return entry;
  const lines = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(entry.data).split(APP_ROW_REWORDED.was);
  if (lines.length !== 2) throw new Error("0.6.1's App Details.csv does not hold the reworded row exactly once.");
  return { name: entry.name, data: new TextEncoder().encode(lines.join(APP_ROW_REWORDED.now)) };
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

/** The one column of the model's files that is deliberately not what 0.6.1 wrote. Line Items.csv has a column more, its
 * last: "Format List", which names the list of a line item formatted as a list (model/lineitems.ts). The model this zip was
 * made from has no Format column in its Line Items grid, so no line item of it is formatted as a list and the column is
 * empty in every row: the file's first line gains the column's name as a last cell, and every other line an empty one.
 *
 * Besides the build's name, this column, the row that describes it (`MODEL_ROW_REWORDED`) and the two rows about a file
 * this model does not get (`MODEL_FILE_ADDED`) are the only places where this model's files are known to differ from
 * 0.6.1's. The name is in the "Exported with" row and, for a model page opened on its own, in the first Diagnostics line,
 * and does not show in a comparison here, for the reasons given at `APP_ROW_REWORDED`. */
export const MODEL_COLUMN_ADDED = { file: "Line Items.csv", header: "Format List" } as const;

/** 0.6.1's text of that file with the column: each line as it is, with the one cell added at its end. `csv` is the file's
 * text as toCsv wrote it, with its byte order mark or without. */
export function withColumnAdded(csv: string): string {
  const lines = csv.split("\r\n");
  // A row is a line: the text ends in a line end, and no cell holds one. (A line that ends inside a quoted cell has an odd
  // number of quotes. The line break in one of this file's cells is a line feed alone.)
  if (lines.pop() !== "" || lines.some(line => line.split("\"").length % 2 === 0)) throw new Error("0.6.1's Line Items.csv does not hold one row a line.");
  return lines.map((line, index) => `${line},${index === 0 ? MODEL_COLUMN_ADDED.header : ""}\r\n`).join("");
}

/** The one row of the model's Model Details.csv that is deliberately not what 0.6.1 wrote, as the row's whole line of the
 * file. The "How to read" row on Line Items named the two columns that the export added after Anaplan's own, which were
 * all it added. The file has a third now (`MODEL_COLUMN_ADDED`), and Model Details.csv is to describe the files as they
 * are: the row says that Anaplan's own columns come first, unchanged, and what each of the three after them holds. */
export const MODEL_ROW_REWORDED = {
  file: "Model Details.csv",
  was: `How to read,Line Items,"Each module's row sits above its line items. Ratio Numerator and Ratio Denominator, after Anaplan's own columns, name the line items a Ratio summary divides: the Summary JSON gives only their IDs."\r\n`,
  now: `How to read,Line Items,"Each module's row sits above its line items. Anaplan's own columns come first and are unchanged, and three columns follow them. Ratio Numerator and Ratio Denominator name the line items a Ratio summary divides: the Summary JSON gives only their IDs. Format List names the list of a line item formatted as a list, as General Lists.csv names it: the Format JSON gives only the list's ID. It is empty for any other format, for a list that is not in General Lists.csv, such as a list subset or a line item subset, and when General Lists.csv was not exported."\r\n`,
} as const;

/** 0.6.1's text of that file with the row as it is written now: every other line as it is. `csv` is the file's text, with
 * its byte order mark or without. */
export function withRowReworded(csv: string): string {
  const lines = csv.split(MODEL_ROW_REWORDED.was);
  if (lines.length !== 2) throw new Error("0.6.1's Model Details.csv does not hold the reworded row exactly once.");
  return lines.join(MODEL_ROW_REWORDED.now);
}

/** The one file the export has gained since 0.6.1: Dynamic Cell Access.csv, which lists a model's access drivers with
 * what each controls (model/access.ts). The export makes it from the Read Access Driver and Write Access Driver columns
 * of Line Items.csv, by the module its Module Name column gives each line item, and reads nothing for it. The model this
 * zip was made from has none of the three columns in its Line Items grid, so the file is not written for it, and its
 * zip holds the twelve files it held. What differs is Model Details.csv, which says of every file the export knows
 * whether it was written and how to read it: it has two rows more, each given here as the row's whole line of the file,
 * with the line it stands after. `notWritten` says that the file was not exported and why, right after the row for Line
 * Items.csv, which is the file's place among the files. `howToRead` says how to read the file, right after the row on
 * Line Items.
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
    line: `How to read,Dynamic Cell Access,"Not a Model settings grid: the Read Access Driver and Write Access Driver columns of Line Items.csv, listed from the driver's side. One row for each use of a driver: the driver, Read or Write, and what it controls, each by its module and its name as Line Items.csv writes them. A line item that one driver controls for reading and for writing has two rows. The rows are in the order of the drivers in Line Items.csv, for one driver Read before Write, then in the order of what it controls. Where a module's own row names a driver, that row is listed with no Controlled Line Item, and each line item of the module that shows a dash in the column is listed with the same driver. A driver that could not be matched to a line item comes last, once for the cell that names it: Driver Module is empty, and Driver Line Item holds the cell as it is written. A driver is matched as the model map matches it, and only to a line item the map has: the map leaves some rows of Line Items.csv out, and About this map says how many. A driver named in such a row is listed here all the same, with the row's Module Name and its name as the file writes them. The file is not written when Line Items.csv was not exported, or lacks its Module Name column or one of the two driver columns."\r\n`,
  },
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

/** 0.6.1's text of Model Details.csv as the file is written now: the row on Line Items reworded, and the two rows about
 * Dynamic Cell Access.csv added. */
export const withDetailsSince = (csv: string): string => withRowsAdded(withRowReworded(csv), [MODEL_FILE_ADDED.notWritten, MODEL_FILE_ADDED.howToRead]);

/** The model's zip as 0.6.1 wrote it but for what is named above: every file's bytes as they are in `MODEL_ZIP_0_6_1`,
 * with the cell added to each line of Line Items.csv, and with one line of Model Details.csv replaced and two added,
 * written by zipStore with the same time on every entry. model/model.test.ts pins that zipStore writes `MODEL_ZIP_0_6_1`
 * itself, byte for byte, from the files as they are, so what differs from this zip differs from 0.6.1. */
export const MODEL_ZIP_AS_NAMED = zipStore(zipEntries(MODEL_ZIP_0_6_1).map(entry => {
  const written = entry.name === MODEL_COLUMN_ADDED.file ? withColumnAdded : entry.name === MODEL_ROW_REWORDED.file ? withDetailsSince : undefined;
  if (!written) return entry;
  return { name: entry.name, data: new TextEncoder().encode(written(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(entry.data))) };
}), ZIPPED_AT);
