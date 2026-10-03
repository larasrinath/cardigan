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
/** Anaplan stores the fiscal year's month as 1-12 and the day its year ends on as 1-7 counted from Sunday: the Model Calendar
 * tab's FiscalYearMonthSelect and FiscalYearDayInWeekSelect (Time2/Forms/Widgets) give each choice the ID index + 1 into
 * CLDR's month and day abbreviations, which start with January and Sunday. The settings grid returns those IDs. */
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The 1-12 month a setting holds: its stored ID, or a label such as "December". */
function monthNumber(text: string): number | undefined {
  if (/^\d+$/.test(text)) return Number(text) >= 1 && Number(text) <= 12 ? Number(text) : undefined;
  const index = MONTHS.findIndex(month => text.toLowerCase().startsWith(month.toLowerCase()));
  return index >= 0 ? index + 1 : undefined;
}

/** The 1-7 day (Sunday first) a setting holds: its stored ID, or a label such as "Saturday". */
function dayNumber(text: string): number | undefined {
  if (/^\d+$/.test(text)) return Number(text) >= 1 && Number(text) <= 7 ? Number(text) : undefined;
  const index = DAYS.findIndex(day => text.toLowerCase().startsWith(day.toLowerCase()));
  return index >= 0 ? index + 1 : undefined;
}

/** A value in the template's own words: months and days as their names, whether the grid gave the stored ID or a label;
 * true/false as the template's choices. */
function templateValue(setting: string, value: string): string {
  const text = value.trim();
  if (/^(true|false)$/i.test(text)) {
    const on = text.toLowerCase() === "true";
    if (setting === "Timescale") return on ? "4-digit format" : "2-digit format";
    if (setting === "Fiscal Year Label is aligned with") return on ? "Start Week of the Fiscal Year" : "End Week of the Fiscal Year";
    return on ? "Yes" : "No";
  }
  if (setting === "Fiscal Year Starts" || setting === "End of Fiscal Year - month") {
    const month = monthNumber(text);
    return month ? MONTHS[month - 1] : text;
  }
  if (setting === "End of Fiscal Year - day") {
    const day = dayNumber(text);
    return day ? DAYS[day - 1] : text;
  }
  if (setting === "End of Fiscal Year is") return /^last/i.test(text) ? "Last" : /^nearest/i.test(text) ? "Nearest" : text;
  return text;
}

// --------------------------------------------------------------------------- the current fiscal year, as the tab shows it
// The model stores the current fiscal year as its ID ("FY24"); the Model Calendar tab shows it with its dates ("FY24: 31 Dec
// 2023 - 28 Dec 2024"), which it works out from the calendar settings. These follow the tab's own helpers, line for line:
// anaplan/utils/FiscalYearHelper (month calendars) and anaplan/utils/FiscalYearForWeeksHelper (week calendars).

interface FiscalYear { value: string; label: string }

/** Days to step back from a date's weekday to the fiscal year's end day, by that day's 1-7 ID (FiscalYearForWeeksHelper). */
const DAYS_OFFSET: Record<number, number> = { 2: 6, 3: 5, 4: 4, 5: 3, 6: 2, 7: 1, 1: 0 };
const CUT_OFF_YEAR_FOR_2_DIGIT_FORMAT = 2079;

function lastDayIn(day: number, date: Date): number {
  return date.getDate() - (date.getDay() + DAYS_OFFSET[day]) % 7;
}

function firstDayInMonth(offset: number, month: number, year: number): Date {
  const flipped = 0 - (offset - 7);
  return new Date(year, month, 1 + (flipped - new Date(year, month, 1).getDay() + 7) % 7);
}

function weekEndDate(last: boolean, day: number, reference: Date): Date {
  let end = new Date(reference);
  const lastDay = lastDayIn(day, end);
  if (last) {
    end.setDate(lastDay);
  } else {
    const firstInNextMonth = firstDayInMonth(DAYS_OFFSET[day], end.getMonth() + 1, end.getFullYear());
    if (firstInNextMonth.getDate() < end.getDate() - lastDay) end = firstInNextMonth;
    else end.setDate(lastDay);
  }
  return end;
}

function weekStartDate(last: boolean, day: number, reference: Date): Date {
  let start = new Date(reference);
  let lastDay = start.getDate() - (start.getDay() + DAYS_OFFSET[day]) % 7;
  if (last) {
    lastDay += 1; // a year should not start on the day the last one ended
    start.setDate(lastDay);
  } else {
    const firstInMonth = firstDayInMonth(DAYS_OFFSET[day], start.getMonth() + 1, start.getFullYear());
    if (firstInMonth.getDate() < start.getDate() - lastDay) start = firstInMonth;
    else start.setDate(lastDay);
    start.setDate(start.getDate() + 1);
  }
  return start;
}

function fiscalYear(start: Date, end: Date, labelYear: number, yearLabel: string, fourDigit: boolean): FiscalYear {
  const full = String(labelYear);
  const value = `FY${fourDigit && labelYear >= CUT_OFF_YEAR_FOR_2_DIGIT_FORMAT ? full : full.substring(2)}`;
  const fy = `${yearLabel}${fourDigit ? full : full.substring(2)}`;
  const date = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  return { value, label: `${fy}: ${date(start)} - ${date(end)}` };
}

/** FiscalYearHelper.generateParams: a month calendar's year starting in `year`. */
function monthsYear(year: number, month: number, fromStart: boolean, yearLabel: string, fourDigit: boolean): FiscalYear {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year + 1, month - 1, 0);
  return fiscalYear(start, end, fromStart ? start.getFullYear() : end.getFullYear(), yearLabel, fourDigit);
}

/** FiscalYearForWeeksHelper._generateParams: a week calendar's year ending in `year` + 1. */
function weeksYear(year: number, month: number, last: boolean, day: number, fromStart: boolean, yearLabel: string, fourDigit: boolean): FiscalYear {
  const reference = new Date(year + 1, month, 0);
  const start = weekStartDate(last, day, new Date(year, month, 0));
  const end = weekEndDate(last, day, reference);
  let labelYear: number;
  if (fromStart) {
    const firstWeek = new Date(start);
    firstWeek.setDate(start.getDate() + 7);
    labelYear = firstWeek.getFullYear();
  } else {
    const lastWeek = new Date(reference);
    lastWeek.setDate(lastDayIn(day, lastWeek));
    labelYear = lastWeek.getFullYear();
  }
  return fiscalYear(start, end, labelYear, yearLabel, fourDigit);
}

/** The current fiscal year as the Model Calendar tab shows it, with its dates; the stored value as it is when the settings
 * it depends on are missing, or it already carries its dates. */
export function currentFiscalYearLabel(values: ReadonlyMap<number, string>): string {
  const get = (setting: string) => (values.get(CALENDAR_PROPERTIES[setting]) ?? "").trim();
  const stored = get("Current Fiscal Year");
  const id = /^FY(\d{2}|\d{4})$/i.exec(stored);
  const yearLabel = values.get(CALENDAR_PROPERTIES["Fiscal Year Label"]);
  const kind = calendarKind(get("Calendar Type"));
  if (!id || yearLabel === undefined || !kind || kind === "Weeks General") return stored;
  const base = id[1].length === 2 ? 2000 + Number(id[1]) : Number(id[1]);
  const fromStart = /^true$/i.test(get("Fiscal Year Label is aligned with")) || /^start/i.test(get("Fiscal Year Label is aligned with"));
  const fourDigit = /^true$/i.test(get("Timescale")) || /^4/.test(get("Timescale"));
  let make: ((year: number) => FiscalYear) | undefined;
  if (kind === "Months") {
    const month = monthNumber(get("Fiscal Year Starts"));
    if (month) make = year => monthsYear(year, month, fromStart, yearLabel.trim(), fourDigit);
  } else {
    const month = monthNumber(get("End of Fiscal Year - month"));
    const day = dayNumber(get("End of Fiscal Year - day"));
    const type = get("End of Fiscal Year is");
    if (month && day && /^(last|nearest)/i.test(type)) make = year => weeksYear(year, month, /^last/i.test(type), day, fromStart, yearLabel.trim(), fourDigit);
  }
  if (!make) return stored;
  for (let year = base - 2; year <= base + 1; year++) {
    const candidate = make(year);
    if (candidate.value.toUpperCase() === stored.toUpperCase()) return candidate.label;
  }
  return stored;
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
    let value = section === "Model" ? model[setting] ?? "" : setting === "Current Fiscal Year" ? currentFiscalYearLabel(input.values)
      : property !== undefined ? templateValue(setting, input.values.get(property) ?? "") : "";
    if (section !== "Model" && !applies(appliesTo, kind)) value = "";
    if (input.showsYearToDate === false && (setting === "Include Year To Date" || setting === "Include Year To Go")) value = "";
    return [section, setting, value, allowed, appliesTo, notes];
  });
}
