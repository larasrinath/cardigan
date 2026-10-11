/** Read-only Anaplan phrases. The engine phrases join Finishing only after the run reports its engine. */
export const WORD_POOLS = {
  opening: ["Opening the model…", "Model is busy…", "Knocking on the workspace…", "Consulting the Planual…"],
  time: ["Turning the fiscal year…", "Counting periods…", "Checking the switchover…", "Lining up versions…"],
  lists: ["Climbing hierarchies…", "Counting list items…", "Rolling up parents…", "Subsetting…"],
  modules: ["Reading the blueprint…", "Untangling formulas…", "Tracing LOOKUPs…", "SUMming up…", "Following Applies To…", "DISCO-ing…", "Checking PLANS…", "Counting cells…"],
  actions: ["Peeking at processes…", "Following the data in…", "Tracing mappings…", "Finding the spokes…"],
  pages: ["Flipping through pages…", "Browsing boards…", "Leafing through worksheets…", "Peeking at cards…"],
  finishing: ["Connecting the plans…", "Drawing the model map…"],
} as const;
export type WordPool = keyof typeof WORD_POOLS;
export const ENGINE_WORDS = { Classic: "Hyperblocking…", Polaris: "Polarising…" } as const;
export type WordEngine = keyof typeof ENGINE_WORDS;
/** All phrases take part in sizing, even before the engine or the kind of run is known. */
export const ALL_WORDS = [...Object.values(WORD_POOLS).flat(), ...Object.values(ENGINE_WORDS)];

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
  return [WORD_POOLS.finishing[0], ...(kind === "model" ? [WORD_POOLS.finishing[1]] : []), ...(engine ? [ENGINE_WORDS[engine]] : [])];
}
