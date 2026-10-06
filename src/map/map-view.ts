import type { ModelGraph, ModelMap, ModelMapOptions } from "./graph-types.js";

/** Puts the model map into `host`, an empty element the page gives it, and returns the handle the page drives it with.
 * The map makes its own elements inside the host and nowhere else, is sized by the host, and starts hidden: nothing is
 * drawn until `show`. Its styles are in map.css. */
export function mountModelMap(host: HTMLElement, graph: ModelGraph, options: ModelMapOptions): ModelMap {
  void host; void graph; void options;
  throw new Error("The model map's view is not built yet.");
}
