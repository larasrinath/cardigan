import { VERSION } from "./version.js";

/** The one table of each result about the export itself (App Details.csv, Model Details.csv): what was exported, notes,
 * how to read the other tables and the diagnostic log, one row each under its section. The results page has no view of
 * it as a table: its overview says what the rows hold. */

export const DETAILS_HEADERS = ["Section", "Detail", "Value"];
export type DetailRow = [section: string, detail: string, value: string | number];

export function exportRows(host: string, now = new Date()): DetailRow[] {
  return [
    ["Export", "Exported on", `${now.toISOString().slice(0, 16).replace("T", " ")} UTC`],
    ["Export", "Exported with", `Cardigan ${VERSION}`],
    ["Export", "Anaplan host", host],
  ];
}

/** A diagnostic log line with the time (UTC) it was written, as `diagnosticRows` reads it back. The content script stamps
 * each line of a run (tab-port.ts), and so does the model's core frame (bridge.ts). */
export const stampLine = (line: string): string => `${new Date().toISOString().slice(11, 19)} ${line}`;

/** The diagnostic log, one row per line with the time (UTC) stamped on it. */
export function diagnosticRows(log: string): DetailRow[] {
  return log.split(/\r?\n/).filter(line => line.trim()).map(line => {
    const stamped = /^(\d{2}:\d{2}:\d{2}) (.*)$/.exec(line);
    return ["Diagnostics", stamped?.[1] ?? "", stamped?.[2] ?? line];
  });
}
