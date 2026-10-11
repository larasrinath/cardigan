import type { ResultTable } from "../result-types.js";
import { columnIndex } from "./columns.js";
import { cellText } from "./table-engine.js";

/** What the Overview's tile for a model's Model Calendar says in place of a count: the current fiscal year, and
 * under it the kind of calendar. A count of the table's rows says nothing of a calendar: its rows are the settings of a
 * template (model/calendar.ts), and how many of them hold a value depends on the calendar's type.
 *
 * The type is read from the table's Calendar Type setting, as the Model Calendar tab's list labels it. Anaplan has four
 * (anaplan/settings/Time2/Form.js `_formConstructors`), each stored by an ID, which a value may stand as where its label
 * was not read:
 *
 * - Calendar Months/Quarters/Years (25000000000): Monthly.
 * - Weeks: 4-4-5, 4-5-4 or 5-4-4 (25000000001): Weekly, with the grouping the Week Grouping setting gives, such as 4-4-5.
 * - Weeks: General (25000000002): Weekly, with its Number of Weeks where the setting gives one.
 * - Weeks: 13 4-week Periods (25000000003): Weekly, with "13 periods".
 *
 * A type of another text is said by what it names: a weeks calendar is Weekly and a months one Monthly; anything else is
 * said as it is written, up to its first colon or slash. The current fiscal year is said by its label, the text before the
 * colon of "FY24: 31 Dec 2023 - 28 Dec 2024", as the calendar's export writes it (model/calendar.ts
 * `currentFiscalYearLabel`); a value without a colon is the label itself. */

type Kind = "months" | "weeks445" | "weeksGeneral" | "weeks13" | "weeks";

/** Anaplan's calendar types by their labels and their stored IDs. */
const KINDS: ReadonlyMap<string, Kind> = new Map([
  ["calendar months/quarters/years", "months"], ["25000000000", "months"],
  ["weeks: 4-4-5, 4-5-4 or 5-4-4", "weeks445"], ["25000000001", "weeks445"],
  ["weeks: general", "weeksGeneral"], ["25000000002", "weeksGeneral"],
  ["weeks: 13 4-week periods", "weeks13"], ["25000000003", "weeks13"],
]);

/** The kind of a calendar type: one of Anaplan's four as written or stored, or else by what the text names. */
function kindOf(type: string): Kind | undefined {
  const text = type.trim();
  const known = KINDS.get(text.toLowerCase());
  if (known) return known;
  if (/^weeks?\b/i.test(text)) return /general/i.test(text) ? "weeksGeneral" : /\b13\b/.test(text) ? "weeks13" : /4-4-5|4-5-4|5-4-4/.test(text) ? "weeks445" : "weeks";
  if (/month/i.test(text)) return "months";
  return undefined;
}

export interface CalendarTile {
  /** The current fiscal year's label, or the calendar's kind where no year was read. */
  value: string;
  /** A year uses the count's size; a type without a year keeps the smaller word size. */
  valueIsYear?: boolean;
  /** Under the year: the kind and how a weeks calendar is grouped, such as "Weekly · 4-4-5". Without a year, only the
   * grouping, since the kind is already the large value. */
  detail?: string;
  /** The tile in full, for its title and a screen reader: the table's name, the type as written, and the current fiscal
   * year with its dates. */
  title: string;
}

/** The tile of a Model Calendar table, named `label`, or nothing where the table says neither its type nor its current
 * fiscal year: the tile then counts the table's rows, as every other tile does. */
export function calendarTile(table: ResultTable, label: string): CalendarTile | undefined {
  const setting = columnIndex(table, "Setting");
  const value = columnIndex(table, "Value");
  if (setting === undefined || value === undefined) return undefined;
  const of = (name: string): string => {
    const row = table.rows.find(candidate => cellText(candidate[setting]).trim() === name);
    return row ? cellText(row[value]).trim() : "";
  };
  const type = of("Calendar Type");
  const kind = kindOf(type);
  const current = of("Current Fiscal Year");
  const colon = current.indexOf(":");
  const year = (colon < 0 ? current : current.slice(0, colon)).trim();
  const dates = colon < 0 ? "" : current.slice(colon + 1).trim();
  if (type === "" && year === "") return undefined;

  const grouping = kind === "weeks445" ? of("Week Grouping into Months / Qtrs") : "";
  const weeks = kind === "weeksGeneral" && /^\d+$/.test(of("Number of Weeks")) && Number(of("Number of Weeks")) > 0 ? `${Number(of("Number of Weeks"))} weeks` : "";
  const pattern = kind === "weeks13" ? "13 periods" : grouping || weeks;
  const word = kind === "months" ? "Monthly" : kind !== undefined ? "Weekly" : type.split(/[:/]/)[0].trim() || type;
  const shown = year || word;
  const detail = [year ? word : "", pattern].filter(part => part !== "").join(" · ");
  const full = [type, grouping && `grouped ${grouping}`, weeks, year && `current fiscal year ${year}${dates ? ` (${dates})` : ""}`].filter(part => part !== "");
  return { value: shown, ...(year ? { valueIsYear: true } : {}), ...(detail ? { detail } : {}), title: `${label}: ${full.join(", ")}` };
}
