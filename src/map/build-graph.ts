import type { ResultTable } from "../result-types.js";
import type { ModelGraph } from "./graph-types.js";

/** The graph of a model export's tables (`AnalysisResult.tables` of a model). A table that is missing, or lacks a column
 * the map reads, leaves out what it would have given and adds a sentence to `limitations`: it never throws for that. */
export function buildModelGraph(tables: readonly ResultTable[]): ModelGraph {
  void tables;
  throw new Error("The model map's graph is not built yet.");
}
