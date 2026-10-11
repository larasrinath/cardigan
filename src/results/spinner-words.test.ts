import { describe, expect, it } from "vitest";
import { ALL_WORDS, ENGINE_WORDS, poolForStatus, WORD_POOLS, wordsForPool, type WordPool } from "./spinner-words.js";

const samples: Record<WordPool, string[]> = {
  opening: ["Connecting to the Anaplan tab…", "Waiting for the model to open…", "Loading the model page's client…", "Starting the analysis…", "Receiving the result…", "Reading Polaris settings", "Something new…", ""],
  time: ["Reading Model Calendar…", "Reading Time Ranges…", "Reading Versions…"],
  lists: ["Reading General Lists…", "Reading Line Item Subsets…", "Reading list names in Demo model…"],
  modules: ["Reading Modules…", "Reading Line Items…", "Reading Dynamic Cell Access…", "Reading module dimensions in Demo model…", "Reading line items in Demo model…", "Reading names in Demo model…", "Reading names in Demo model: 5 s, model status OPENING. A model that is not open can take a few minutes to load…"],
  actions: ["Processes", "Imports", "Import Data Sources", "Exports", "Other Actions", "Actions", "Import mappings", "Process actions", "Source Models"].map(name => `Reading ${name}…`),
  pages: ["Reading the app…", "Reading the pages built on this model…", "Reading the pages built on this model: 2 of 5", "Reading page 2 of 40: Demand board", "Reading the apps of the pages built on this model: 3", "Reading saved view layouts in Demo model…", "Finding filter line items in Demo model…", "Finding filter line items in Demo model: 2 of 5 modules…", "Reading filter item names in Demo model…", "Reading item names in Demo model…", "Reading dimension names in Demo model…"],
  finishing: ["Building the report…", "Building the tables of the pages built on this model…"],
};

describe("Anaplan spinner words", () => {
  for (const [pool, statuses] of Object.entries(samples)) {
    it.each(statuses)(`maps %s to ${pool}`, status => expect(poolForStatus(status)).toBe(pool));
  }

  it("does not mistake an invented model or page name for the read's step", () => {
    expect(poolForStatus("Reading page 1 of 2: Modules and Versions")).toBe("pages");
    expect(poolForStatus("Reading module dimensions in General Lists…")).toBe("modules");
    expect(poolForStatus("Unknown step: Reading Line Items…")).toBe("opening");
  });

  it("keeps the expanded count of each pool and two phrases per engine", () => {
    expect(Object.fromEntries(Object.entries(WORD_POOLS).map(([pool, words]) => [pool, words.length])))
      .toEqual({ opening: 12, time: 12, lists: 12, modules: 16, actions: 12, pages: 12, finishing: 8 });
    expect(ENGINE_WORDS).toEqual({
      Classic: ["Hyperblocking…", "Riding the Hyperblock…"],
      Polaris: ["Polarising…", "Following the North Star…"],
    });
  });

  it("gates engine words and leaves both map phrases out of every app pool", () => {
    for (const pool of Object.keys(WORD_POOLS) as WordPool[]) {
      for (const kind of ["app", "model"] as const) {
        for (const engine of [undefined, "Classic", "Polaris"] as const) {
          const words = wordsForPool(pool, kind, engine);
          for (const [name, phrases] of Object.entries(ENGINE_WORDS)) {
            for (const word of phrases) expect(words.includes(word)).toBe(pool === "finishing" && name === engine);
          }
          for (const word of ["Drawing the model map…", "Drawing the arrows…"]) {
            expect(words.includes(word)).toBe(pool === "finishing" && kind === "model");
          }
          const base = WORD_POOLS[pool].filter(word => kind === "model" || !["Drawing the model map…", "Drawing the arrows…"].includes(word));
          expect(words).toEqual([...base, ...(pool === "finishing" && engine ? ENGINE_WORDS[engine] : [])]);
        }
      }
    }
  });

  it("uses only the approved read-only words, with ellipses and no text arrows, in every pool", () => {
    expect(ALL_WORDS).toHaveLength(88);
    expect(new Set(ALL_WORDS).size).toBe(ALL_WORDS.length);
    const forbidden = /\b(?:Importing|Exporting|Restoring|Rolling back|Archiving|Syncing|Deploying|Publishing|Saving|Deleting|Breaking back|Recalculating)\b/i;
    for (const word of ALL_WORDS) {
      expect(word).not.toMatch(forbidden);
      expect(word.endsWith("…")).toBe(true);
      expect(word).not.toMatch(/[\u2190-\u21ff\u25b2\u25b6\u25bc\u203a\u00bb]/u);
    }
  });
});
