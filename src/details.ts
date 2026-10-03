import { VERSION } from "./version.js";

/** The one file in each zip about the export itself (App Details.csv, Model Details.csv): what was exported, notes, how to
 * read the other files and the diagnostic log, one row each under its section, so the zip holds only CSV files. */

export const DETAILS_HEADERS = ["Section", "Detail", "Value"];
export type DetailRow = [section: string, detail: string, value: string | number];

export function exportRows(host: string, now = new Date()): DetailRow[] {
  return [
    ["Export", "Exported on", `${now.toISOString().slice(0, 16).replace("T", " ")} UTC`],
    ["Export", "Exported with", `Cardigan ${VERSION}`],
    ["Export", "Anaplan host", host],
  ];
}

/** A diagnostic log line with the time (UTC) it was written, as `diagnosticRows` reads it back. */
export const stampLine = (line: string): string => `${new Date().toISOString().slice(11, 19)} ${line}`;

/** The diagnostic log, as Copy diagnostic log gives it, one row per line with the time (UTC) the panel stamped on it. */
export function diagnosticRows(log: string): DetailRow[] {
  return log.split(/\r?\n/).filter(line => line.trim()).map(line => {
    const stamped = /^(\d{2}:\d{2}:\d{2}) (.*)$/.exec(line);
    return ["Diagnostics", stamped?.[1] ?? "", stamped?.[2] ?? line];
  });
}
