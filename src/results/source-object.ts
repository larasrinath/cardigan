/** Where an import of a model takes its data from, as the Imports tab of Anaplan's Model settings writes it under Source
 * Object: the module or the saved view an import reads, behind the model it is in. The results page shows the three
 * apart (result-view.ts). This module reads one cell. It takes text and gives plain text back, which the caller escapes;
 * it reads no result and no page, and it never throws: a cell it cannot read gives undefined, and the caller shows the
 * cell as it is.
 *
 * The cell writes a model's object as a formula names one: a module, then a dot and a saved view where there is one, each
 * name in single quotes where it needs them ("'HRY01 ORG Hierarchy Builder'.'DATA & LIST: ORG3 Area'"), and without them
 * where it does not ("'LIST - Regions'.Export"). Inside the quotes, two single quotes are one of the name's own: that is
 * how the export writes a name with a quote in it ("'Editor''s lock'", and map/graph-names.ts `unquote`). An import from
 * another model has the model's name before them, as it is, with " / " between ("M0 Data Hub [DEV] / 'HRY01 …'.'…'"); an
 * import from this model's own module has no model's name.
 *
 * The cell is read from its end. A model's name is written without quotes, so it may hold anything: a quote, a dot, or
 * " / " itself. The module and the saved view cannot: a name that holds any of those is in quotes, and so is a module's
 * name that holds a space. A saved view's name may hold spaces without quotes ("'ADM003 - Keep Awake'.EXPORT Keep Awake"):
 * such a view is all that follows the cell's last dot. So the last name, the dot and the name before it are read first,
 * each where it ends, and the model's name is all that stands before them and the " / " in front of them. Text that is not written so, such as the dash Anaplan writes for a file's
 * import or the name of a file, gives nothing. A file named "prices.csv" is written as a module and a view would be: the
 * caller tells the two apart by the import's Source Type, which this module does not read. */

export interface SourceObject {
  /** The model the import reads from, as the cell writes it; undefined where the cell names no model, as for an import
   * from one of this model's own modules. */
  model?: string;
  module: string;
  /** The saved view the import reads; undefined for a module named without one. */
  view?: string;
}

/** What ends a name written without quotes, read from its end: a quote, a dot, white space or a slash. */
const ENDS_BARE = /['.\s/]/;

/** What stands between a model's name and its module. */
const AFTER_MODEL = " / ";

/** The name that ends right before `end`, with where it starts: a name in single quotes, given without them and with each
 * two quotes inside it as one, or a name written without quotes. Nothing where no name ends there, or one that says
 * nothing: a quoted name of spaces, or the dash Anaplan writes for none. Read from the end, two quotes are one of the
 * name's own wherever a quote has another before it: the quote that opens the name is the first one with none before it. */
function nameBefore(text: string, end: number): { name: string; start: number } | undefined {
  if (end <= 0) return undefined;
  if (text[end - 1] === "'") {
    for (let index = end - 2; index >= 0; index--) {
      if (text[index] !== "'") continue;
      if (index > 0 && text[index - 1] === "'") {
        index--;
        continue;
      }
      const name = text.slice(index + 1, end - 1).replaceAll("''", "'");
      return name.trim() === "" ? undefined : { name, start: index };
    }
    return undefined;
  }
  let start = end;
  while (start > 0 && !ENDS_BARE.test(text[start - 1])) start--;
  const name = text.slice(start, end);
  return name === "" || name === "-" ? undefined : { name, start };
}

/** A saved view's name written without quotes after its module's dot, which may hold spaces: all that follows the
 * cell's last dot, where that holds no quote and no slash, neither starts nor ends with a space, and is no dash. A name
 * with a dot in it is in quotes, so the last dot is the one after the module. */
function bareView(text: string): { name: string; start: number } | undefined {
  const dot = text.lastIndexOf(".");
  const name = dot < 0 ? "" : text.slice(dot + 1);
  return name === "" || name === "-" || name !== name.trim() || /['/]/.test(name) ? undefined : { name, start: dot + 1 };
}

/** A Source Object cell as the model's object it names: its model, if it names one, its module, and its saved view, if it
 * names one. Undefined for a cell that is not written as one. */
export function sourceObjectOf(cell: unknown): SourceObject | undefined {
  if (typeof cell !== "string") return undefined;
  const text = cell.trim();
  const last = (text.endsWith("'") ? undefined : bareView(text)) ?? nameBefore(text, text.length);
  if (!last) return undefined;
  const first = text[last.start - 1] === "." ? nameBefore(text, last.start - 1) : undefined;
  if (text[last.start - 1] === "." && !first) return undefined;
  const module = first ?? last;
  const view = first ? last.name : undefined;
  if (module.start === 0) return { module: module.name, ...(view === undefined ? {} : { view }) };
  if (module.start < AFTER_MODEL.length || text.slice(module.start - AFTER_MODEL.length, module.start) !== AFTER_MODEL) return undefined;
  const model = text.slice(0, module.start - AFTER_MODEL.length);
  return model.trim() === "" ? undefined : { model, module: module.name, ...(view === undefined ? {} : { view }) };
}
