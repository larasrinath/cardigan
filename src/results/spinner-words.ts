/** Finishing's two phrases of the model map, which only a model's run shows: an app's run draws no map. */
export const MODEL_ONLY_WORDS = ["Drawing the model map…", "Sketching the arrows…"] as const;

/** Read-only Anaplan phrases. No two start with the same word, the engine phrases included. The engine phrases join
 * Finishing only after the run reports its engine. */
export const WORD_POOLS = {
  opening: ["Opening the model…", "Shaking hands with Anaplan…", "Knocking on the workspace…", "Consulting the Planual…",
    "Finding the workspace…", "Waking the model…", "Saying hello to the tenant…", "Checking the model's pulse…",
    "Warming up the grid…", "Tuning in to the model…", "Polishing the crystal ball…", "Unfolding the plan…"],
  time: ["Turning the fiscal year…", "Tallying periods…", "Locating the switchover…", "Stacking up versions…",
    "Numbering the weeks…", "Pinning the current period…", "Pacing out time ranges…", "Spotting the actuals…",
    "Lining up the quarters…", "Scanning the calendar…", "Racing to year end…", "Ticking off the months…"],
  lists: ["Climbing hierarchies…", "Counting list items…", "Rolling up parents…", "Subsetting…",
    "Walking the tree…", "Reaching top levels…", "Herding the children…", "Meeting the parents…",
    "Charting family trees…", "Inspecting properties…", "Decoding numbered lists…", "Sorting out subsets…"],
  modules: ["Reading the blueprint…", "Untangling formulas…", "Tracing LOOKUPs…", "SUMming up…",
    "Unpacking Applies To…", "DISCO-ing…", "Auditing against PLANS…", "Sizing up cells…",
    "Chasing SELECTs…", "Hunting FINDITEMs…", "Sifting IFs and THENs…", "Viewing saved views…",
    "Measuring sparsity…", "Glancing at summaries…", "Resolving references…", "Weighing calculation effort…"],
  actions: ["Stepping through processes…", "Tracking the data in…", "Unravelling mappings…", "Spinning the spokes…",
    "Sequencing the run order…", "Totting up process steps…", "Vetting data sources…", "Matching sources to targets…",
    "Hopping between models…", "Plumbing the pipes…", "Linking source models…", "Parsing import definitions…"],
  pages: ["Flipping through pages…", "Browsing boards…", "Leafing through worksheets…", "Peeking at cards…",
    "Skimming reports…", "Collecting filters…", "Cataloguing buttons…", "Admiring the dashboards…",
    "Visiting each app…", "Noting context selectors…", "Scrolling through grids…", "Eyeing the charts…"],
  finishing: ["Connecting the plans…", MODEL_ONLY_WORDS[0],
    "Joining the dots…", "Tidying the tables…", "Adding it all up…", "Wrapping up…", "Almost there…", MODEL_ONLY_WORDS[1]],
} as const;
export type WordPool = keyof typeof WORD_POOLS;
/** Short reads rotate quickly; opening and the longer grids and page reads leave more time for each phrase. */
export const WORD_PACE_MS: Record<WordPool, number> = {
  opening: 1500, time: 500, lists: 500, modules: 1500, actions: 1500, pages: 1500, finishing: 500,
};
export const ENGINE_WORDS = {
  Classic: ["Hyperblocking…", "Riding the Hyperblock…"],
  Polaris: ["Polarising…", "Following the North Star…"],
} as const;
export type WordEngine = keyof typeof ENGINE_WORDS;
/** All phrases take part in sizing, even before the engine or the kind of run is known. */
export const ALL_WORDS = [...Object.values(WORD_POOLS).flat(), ...Object.values(ENGINE_WORDS).flat()];

/** Match the reader's status prefixes, never a model or page name inside the status. */
export function poolForStatus(status: string): WordPool {
  if (/^Building (?:the report|the tables of the pages built on this model)(?:…|$)/i.test(status)) return "finishing";
  if (/^(?:Reading (?:the app|the pages built on this model|the apps of the pages built on this model|page \d+ of \d+|saved view layouts|(?:filter )?item names|dimension names)|Finding filter line items)\b/i.test(status)) return "pages";
  if (/^Reading (?:Model Calendar|Time Ranges|Versions)\b/i.test(status)) return "time";
  if (/^Reading (?:General Lists|Line Item Subsets|list names)\b/i.test(status)) return "lists";
  if (/^Reading (?:Modules|Line Items|Dynamic Cell Access|module dimensions|names in|saved views' filters)\b/i.test(status)) return "modules";
  if (/^Reading (?:Processes|Imports|Import Data Sources|Exports|Other Actions|Actions|Import mappings|Process actions|Source Models)\b/i.test(status)) return "actions";
  return "opening";
}

export function wordsForPool(pool: WordPool, kind: "app" | "model", engine?: WordEngine): readonly string[] {
  if (pool !== "finishing") return WORD_POOLS[pool];
  const words = WORD_POOLS.finishing.filter(word => kind === "model" || !MODEL_ONLY_WORDS.some(only => only === word));
  return [...words, ...(engine ? ENGINE_WORDS[engine] : [])];
}
