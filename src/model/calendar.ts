/** The model calendar in the assessment template ("Model Calendar - template.csv", 27 Sep 2026): the template's rows and
 * guidance columns stay as they are, and only Value is filled. Calendar settings come from the Model settings calendar grid
 * (TIMESCALE_PROPERTY), matched by native property ID, never by label text, with list choices read by their labels. */

export const CALENDAR_HEADERS = ["Section", "Setting", "Value", "Allowed values", "Applies to", "Notes"];

type Row = [section: string, setting: string, allowed: string, appliesTo: string, notes: string];
const TEMPLATE: Row[] = [
  ["Model", "Workspace", "Text", "All", "As shown in the model header."],
  ["Model", "Model", "Text", "All", "Exact model name, matching the Blueprint exports in the same folder."],
  ["Model", "Model size (GB)", "Number", "All", "From Manage Models at the time of export. Anchors cell findings to memory."],
  ["Model", "Captured on", "YYYY-MM-DD", "All", "Same day as the Blueprint exports."],
  ["Model", "Captured by", "Text", "All", ""],
  ["Model Calendar", "Calendar Type", "Calendar Months/Quarters/Years | Weeks: 4-4-5, 4-5-4 or 5-4-4 | Weeks: 13 4-week Periods | Weeks: General", "All", "Decides which of the rows below apply; leave the others blank."],
  ["Model Calendar", "Fiscal Year Starts", "Jan | Feb | Mar | Apr | May | Jun | Jul | Aug | Sep | Oct | Nov | Dec", "Months", "Month calendars only."],
  ["Model Calendar", "Week Grouping into Months / Qtrs", "4-4-5 | 4-5-4 | 5-4-4", "Weeks 4-4-5", ""],
  ["Model Calendar", "End of Fiscal Year is", "Last | Nearest", "Weeks 4-4-5, Weeks 13x4", "Last = 'Last <day> in <month>'; Nearest = '<day> nearest to end of <month>'."],
  ["Model Calendar", "End of Fiscal Year - day", "Mon | Tue | Wed | Thu | Fri | Sat | Sun", "Weeks 4-4-5, Weeks 13x4", ""],
  ["Model Calendar", "End of Fiscal Year - month", "Jan | Feb | Mar | Apr | May | Jun | Jul | Aug | Sep | Oct | Nov | Dec", "Weeks 4-4-5, Weeks 13x4", ""],
  ["Model Calendar", "Timescale", "2-digit format | 4-digit format", "All", "Year digits in period names."],
  ["Model Calendar", "Fiscal Year Label", "Text", "Months, Weeks 4-4-5, Weeks 13x4", "e.g. FY"],
  ["Model Calendar", "Fiscal Year Label is aligned with", "End Week of the Fiscal Year | Start Week of the Fiscal Year", "Months, Weeks 4-4-5, Weeks 13x4", "Leave blank if the model does not show it."],
  ["Model Calendar", "Current Fiscal Year", "As shown", "Months, Weeks 4-4-5, Weeks 13x4", "Copy the full text including dates, e.g. FY24: 31 Dec 2023 - 28 Dec 2024."],
  ["Model Calendar", "Number of Past Years", "Whole number", "Months, Weeks 4-4-5, Weeks 13x4", "With Future Years and the current year, sets the model calendar horizon."],
  ["Model Calendar", "Number of Future Years", "Whole number", "Months, Weeks 4-4-5, Weeks 13x4", ""],
  ["Model Calendar", "Extra Week for 53-Week Year falls in Period", "Period number", "Weeks 4-4-5, Weeks 13x4", ""],
  ["Model Calendar", "Extra Period falls in Quarter", "1 | 2 | 3 | 4", "Weeks 13x4", "13 4-week periods only."],
  ["Model Calendar", "Week Format", "As shown (e.g. Numbered)", "Weeks", ""],
  ["Model Calendar", "Start Date", "YYYY-MM-DD", "Weeks General", "Weeks: General only."],
  ["Model Calendar", "Number of Weeks", "Whole number", "Weeks General", "Weeks: General only."],
  ["Model Calendar", "Current Period", "As shown, or blank", "All", "Blank means not set."],
  ["Model Calendar", "Include Quarter Totals", "Yes | No", "Months, Weeks 4-4-5, Weeks 13x4", ""],
  ["Model Calendar", "Include Half-Year Totals", "Yes | No", "Months, Weeks 4-4-5, Weeks 13x4", ""],
  ["Model Calendar", "Include Year To Date", "Yes | No", "Where shown", "Leave blank if the model does not show it."],
  ["Model Calendar", "Include Year To Go", "Yes | No", "Where shown", "Leave blank if the model does not show it."],
  ["Model Calendar", "Include Total of All Periods", "Yes | No", "All", ""],
  ["Model Calendar", "Period Label", "Text", "Where shown", "Leave blank if the model does not show it."],
  ["Model Calendar", "Quarter Label", "Text", "Where shown", "Leave blank if the model does not show it."],
  ["Model Calendar", "Half-Year Label", "Text", "Where shown", "Leave blank if the model does not show it."],
];

/** Native calendar property IDs (Time2/TimeDataTransform, as SAM's Model Builder reads them) for each template setting. */
export const CALENDAR_PROPERTIES: Record<string, number> = {
  "Calendar Type": 4000000806, "Fiscal Year Starts": 4000000800, "Week Grouping into Months / Qtrs": 4000000812,
  "End of Fiscal Year is": 4000000809, "End of Fiscal Year - day": 4000000811, "End of Fiscal Year - month": 4000000810,
  Timescale: 4000000827, "Fiscal Year Label": 4000000823, "Fiscal Year Label is aligned with": 4000000822,
  "Current Fiscal Year": 4000000803, "Number of Past Years": 4000000804, "Number of Future Years": 4000000805,
  "Extra Week for 53-Week Year falls in Period": 4000000813, "Extra Period falls in Quarter": 4000000814, "Week Format": 4000000815,
  "Start Date": 4000000807, "Number of Weeks": 4000000808, "Current Period": 4000000816,
  "Include Quarter Totals": 4000000819, "Include Half-Year Totals": 4000000820, "Include Year To Date": 4000000817,
  "Include Year To Go": 4000000818, "Include Total of All Periods": 4000000821,
  "Period Label": 4000000826, "Quarter Label": 4000000825, "Half-Year Label": 4000000824,
};

type Kind = "Months" | "Weeks 4-4-5" | "Weeks 13x4" | "Weeks General";

/** The template's calendar kinds, from the Calendar Type text. */
export function calendarKind(calendarType: string): Kind | undefined {
  if (/general/i.test(calendarType)) return "Weeks General";
  if (/13/.test(calendarType)) return "Weeks 13x4";
  if (/4-4-5|4-5-4|5-4-4/.test(calendarType)) return "Weeks 4-4-5";
  if (/month/i.test(calendarType)) return "Months";
  return undefined;
}

/** The template's "Applies to" column: "All", "Where shown", or kinds such as "Weeks 4-4-5, Weeks 13x4" ("Weeks" is any weeks kind). */
function applies(appliesTo: string, kind: Kind | undefined): boolean {
  if (!kind || appliesTo === "All" || appliesTo === "Where shown") return true;
  const kinds = appliesTo.split(/,\s*/);
  return kinds.includes(kind) || (kinds.includes("Weeks") && kind.startsWith("Weeks"));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** A value in the template's own words. Month and day names are shortened from Anaplan's labels, never guessed from an
 * index; true/false become the template's choices. */
function templateValue(setting: string, value: string): string {
  const text = value.trim();
  if (/^(true|false)$/i.test(text)) {
    const on = text.toLowerCase() === "true";
    if (setting === "Timescale") return on ? "4-digit format" : "2-digit format";
    if (setting === "Fiscal Year Label is aligned with") return on ? "Start Week of the Fiscal Year" : "End Week of the Fiscal Year";
    return on ? "Yes" : "No";
  }
  if (setting === "Fiscal Year Starts" || setting === "End of Fiscal Year - month") return MONTHS.find(month => text.toLowerCase().startsWith(month.toLowerCase())) ?? text;
  if (setting === "End of Fiscal Year - day") return DAYS.find(day => text.toLowerCase().startsWith(day.toLowerCase())) ?? text;
  if (setting === "End of Fiscal Year is") return /^last/i.test(text) ? "Last" : /^nearest/i.test(text) ? "Nearest" : text;
  return text;
}

export interface CalendarInput {
  workspace: string;
  model: string;
  capturedOn: string;
  /** Text by native calendar property ID (list choices by their labels). */
  values: ReadonlyMap<number, string>;
  /** False when the model does not show year-to-date and year-to-go (the time summary setting is off). */
  showsYearToDate?: boolean;
}

export function calendarRows(input: CalendarInput): string[][] {
  const model: Record<string, string> = { Workspace: input.workspace, Model: input.model, "Model size (GB)": "", "Captured on": input.capturedOn, "Captured by": "" };
  const kind = calendarKind(input.values.get(CALENDAR_PROPERTIES["Calendar Type"]) ?? "");
  return TEMPLATE.map(([section, setting, allowed, appliesTo, notes]) => {
    const property = CALENDAR_PROPERTIES[setting];
    let value = section === "Model" ? model[setting] ?? "" : property !== undefined ? templateValue(setting, input.values.get(property) ?? "") : "";
    if (section !== "Model" && !applies(appliesTo, kind)) value = "";
    if (input.showsYearToDate === false && (setting === "Include Year To Date" || setting === "Include Year To Go")) value = "";
    return [section, setting, value, allowed, appliesTo, notes];
  });
}
