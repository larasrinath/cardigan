/** Read-only Anaplan phrases. The engine phrases join Finishing only after the run reports its engine. */
export const WORD_POOLS = {
  opening: ["Opening the model…", "Model is busy…", "Knocking on the workspace…", "Consulting the Planual…",
    "Finding the workspace…", "Waking the model…", "Saying hello to the tenant…", "Checking the model's pulse…",
    "Warming up the grid…", "Tuning in to the model…", "Polishing the crystal ball…", "Unfolding the plan…"],
  time: ["Turning the fiscal year…", "Counting periods…", "Checking the switchover…", "Lining up versions…",
    "Counting weeks…", "Finding the current period…", "Measuring time ranges…", "Spotting the actuals…",
    "Lining up the quarters…", "Reading the calendar…", "Counting down to year end…", "Ticking off the months…"],
  lists: ["Climbing hierarchies…", "Counting list items…", "Rolling up parents…", "Subsetting…",
    "Walking the tree…", "Finding top levels…", "Counting children…", "Meeting the parents…",
    "Tracing family trees…", "Checking properties…", "Reading numbered lists…", "Sorting out subsets…"],
  modules: ["Reading the blueprint…", "Untangling formulas…", "Tracing LOOKUPs…", "SUMming up…", "Following Applies To…", "DISCO-ing…", "Checking PLANS…", "Counting cells…",
    "Chasing SELECTs…", "Finding FINDITEMs…", "Spotting IFs and THENs…", "Counting line items…",
    "Measuring sparsity…", "Peeking at summaries…", "Tracing references…", "Weighing calculation effort…"],
  actions: ["Peeking at processes…", "Following the data in…", "Tracing mappings…", "Finding the spokes…",
    "Reading the run order…", "Counting process steps…", "Checking data sources…", "Matching sources to targets…",
    "Peeking at saved views…", "Following the pipes…", "Tracing source models…", "Reading import definitions…"],
  pages: ["Flipping through pages…", "Browsing boards…", "Leafing through worksheets…", "Peeking at cards…",
    "Reading reports…", "Spotting filters…", "Counting buttons…", "Admiring the dashboards…",
    "Visiting each app…", "Checking context selectors…", "Scrolling through grids…", "Peeking at charts…"],
  finishing: ["Connecting the plans…", "Drawing the model map…",
    "Joining the dots…", "Tidying the tables…", "Counting it all up…", "Wrapping up…", "Almost there…", "Drawing the arrows…"],
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
  if (/^Reading (?:Modules|Line Items|Dynamic Cell Access|module dimensions|names in)\b/i.test(status)) return "modules";
  if (/^Reading (?:Processes|Imports|Import Data Sources|Exports|Other Actions|Actions|Import mappings|Process actions|Source Models)\b/i.test(status)) return "actions";
  return "opening";
}

export function wordsForPool(pool: WordPool, kind: "app" | "model", engine?: WordEngine): readonly string[] {
  if (pool !== "finishing") return WORD_POOLS[pool];
  const words = WORD_POOLS.finishing.filter(word => kind === "model" || (word !== "Drawing the model map…" && word !== "Drawing the arrows…"));
  return [...words, ...(engine ? ENGINE_WORDS[engine] : [])];
}
