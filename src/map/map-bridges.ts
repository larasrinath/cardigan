import { edgeDrawn, type ViewGraph } from "./map-graphs.js";
import type { Trace } from "./map-trace.js";

/** Faint lines among a line item's source inputs (map-graphs.ts `sourcesGraph`). A link is drawn only while both its boxes
 * are shown: with the legend's Calculations hidden, an input that feeds the line item through them would seem to feed
 * nothing. So while one or more of the view's layers are hidden, a faint line bridges the boxes hidden:
 * - from each box shown, its links are followed forward through hidden boxes only, once to each box, so that a circle
 *   among them ends; each box shown that is reached so gets one faint line from it;
 * - none where a link drawn already joins the same two boxes the same way, and none from a box back to itself;
 * - only the links drawn are followed (map-graphs.ts `edgeDrawn`): where formulas' links are left undrawn, there are none.
 * Hiding the Inputs, or the Result, bridges nothing by the same rule, with no case of its own: the trace leads no link into
 * an input but where a Ratio summary's line items feed one, and none away from the Result (map-sources.ts). An input fed so
 * is bridged over as any hidden box is.
 * A faint line is no link: it is drawn under the links, solid and fainter than a link (map-canvas.ts, and map-palette.ts
 * `faint` for how much), the line at the map's foot does not count it, and the trace of a box selected counts the hidden
 * boxes' links already (map-trace.ts). */

/** A faint line: the places of its two boxes in the graph's `nodes`, from what feeds to what it feeds. */
export interface Bridge {
  readonly s: number;
  readonly t: number;
}

/** The faint lines last worked out for each graph, with the layers hidden and the links drawn they are for: a box selected,
 * or the view keeping to a trace, asks again for the same, and is given them as they are. */
const kept = new WeakMap<ViewGraph, { key: string; bridges: readonly Bridge[] }>();

/** The faint lines of a graph while the layers `hidden` are, by the rule above, in the order of their first box, then of
 * their second. None but among a line item's source inputs, and none while nothing is hidden. */
export function bridgesOver(graph: ViewGraph, hidden: ReadonlySet<string>, formulas = true): readonly Bridge[] {
  if (graph.kind !== "sources" || hidden.size === 0) return [];
  const key = `${formulas ? "formulas" : "none"}|${[...hidden].sort().join("|")}`;
  const known = kept.get(graph);
  if (known?.key === key) return known.bridges;
  const bridges = workOut(graph, hidden, formulas);
  kept.set(graph, { key, bridges });
  return bridges;
}

function workOut(graph: ViewGraph, hidden: ReadonlySet<string>, formulas: boolean): Bridge[] {
  const off = graph.nodes.map(node => hidden.has(node.layer));
  if (!off.some(Boolean)) return [];
  // What each box feeds, by the links drawn.
  const next: number[][] = graph.nodes.map(() => []);
  for (const edge of graph.edges) if (edgeDrawn(edge, formulas)) next[edge.s].push(edge.t);
  const bridges: Bridge[] = [];
  for (let from = 0; from < next.length; from++) {
    if (off[from]) continue;
    const ahead = next[from].filter(to => off[to]);
    if (!ahead.length) continue;
    // The boxes shown it is linked to already, and itself: none of them gets a faint line from it.
    const seen = new Set([from, ...next[from]]);
    const reached: number[] = [];
    for (let at = 0; at < ahead.length; at++) {
      for (const to of next[ahead[at]]) {
        if (seen.has(to)) continue;
        seen.add(to);
        if (off[to]) ahead.push(to); else reached.push(to);
      }
    }
    for (const to of reached.sort((a, b) => a - b)) bridges.push({ s: from, t: to });
  }
  return bridges;
}

/** Whether a graph can have a faint line at all, whichever of its layers are hidden: among a line item's source inputs, with
 * the links drawn, a box that is fed by another and feeds another, which is what a faint line bridges. The legend says what
 * a faint line is wherever there can be one, whether or not one is drawn now: it keeps one height as layers are hidden and
 * shown, and none of its lines moves. */
export function mayBridge(graph: ViewGraph, formulas = true): boolean {
  if (graph.kind !== "sources") return false;
  const fed = new Uint8Array(graph.nodes.length);
  const feeds = new Uint8Array(graph.nodes.length);
  for (const edge of graph.edges) {
    if (edge.s === edge.t || !edgeDrawn(edge, formulas)) continue;
    feeds[edge.s] = 1;
    fed[edge.t] = 1;
  }
  return graph.nodes.some(node => fed[node.index] === 1 && feeds[node.index] === 1);
}

/** Where a faint line stands to the trace of the box selected, as a link does (map-trace.ts `Trace.edges`): 1 where it
 * leads towards the box, from what feeds it, 2 where it leads away from it, to what it feeds, and 0 off the trace. */
export function bridgeWay(trace: Trace, bridge: Bridge): 0 | 1 | 2 {
  if ((bridge.t === trace.selected || trace.up.has(bridge.t)) && trace.up.has(bridge.s)) return 1;
  if ((bridge.s === trace.selected || trace.down.has(bridge.s)) && trace.down.has(bridge.t)) return 2;
  return 0;
}
