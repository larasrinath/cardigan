import type { TabMessage } from "./protocol.js";
import type { AnalysisResult } from "./result-types.js";

/** Puts a result back together from the messages that carried it, the way protocol.ts tells the results page to: the
 * "result" with empty tables, each "rows" appended to its table, and nothing counted until "done". Tests only. */
export function assemble(messages: readonly TabMessage[]): AnalysisResult {
  let result: AnalysisResult | undefined;
  let done = false;
  for (const message of messages) {
    if (done) throw new Error(`a ${message.type} message after done`);
    if (message.type === "result") {
      if (result) throw new Error("a second result");
      if (message.result.tables.some(table => table.rows.length)) throw new Error("a result that already has rows");
      result = structuredClone(message.result);
    } else if (message.type === "rows") {
      if (!result) throw new Error("rows before the result");
      result.tables[message.table].rows.push(...message.rows);
    } else if (message.type === "done") {
      done = true;
    }
  }
  if (!result || !done) throw new Error("no finished result");
  return result;
}
