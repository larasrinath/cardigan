import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPEN_TOPIC, OPENED_TYPES, openObject } from "./open-object.js";

const MODEL = "FEDCBA9876543210FEDCBA9876543210";
const WS = "0123456789abcdef0123456789abcdef";

/** The window of the frame that holds the model, as the classic client leaves it: the model, the workspace and the AMD
 * loader, which hands over `topic` for "dojo/topic". */
const frame = (require: unknown) => vi.stubGlobal("window", { modelId: MODEL, workspaceId: WS, require });

describe("Opening a module or a list in the Model Building page around the model's frame", () => {
  let published: unknown[][];
  let loaded: unknown[];
  beforeEach(() => {
    published = [];
    loaded = [];
    const topic = { publish: (...args: unknown[]) => { published.push(args); } };
    frame((modules: unknown, ready: (...modules: unknown[]) => void) => { loaded.push(modules); ready(topic); });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("publishes the classic client's topic for opening a module, with the module's ID as a number, as Model Building's Modules list does", async () => {
    expect(await openObject(MODEL, "102000000409")).toBe(true);
    expect([OPEN_TOPIC, loaded, published]).toEqual(["anaplan/views", [["dojo/topic"]], [["anaplan/views", 102000000409]]]);
    // The model's ID is the same whatever its case.
    expect(await openObject(MODEL.toLowerCase(), "102000000001")).toBe(true);
    expect(published.at(-1)).toEqual(["anaplan/views", 102000000001]);
  });

  it("publishes the same topic for a list, with the list's ID, as Model Building's General Lists does", async () => {
    expect(await openObject(MODEL, "101000000017")).toBe(true);
    expect(published).toEqual([["anaplan/views", 101000000017]]);
    expect([...OPENED_TYPES]).toEqual([[101, "list"], [102, "module"]]);
  });

  it("opens nothing for another model, nor for an ID that is neither a module's nor a list's: another type's, or one of another length", async () => {
    // A line item subset (114), a dashboard (115) and a line item (2xx) are not opened this way.
    for (const [model, object] of [["0123456789ABCDEF0123456789ABCDEF", "102000000001"], [MODEL, "114000000001"], [MODEL, "115000000001"], [MODEL, "203000000001"],
      [MODEL, "1020000004"], [MODEL, "1010000000171"], [MODEL, "x02000000409"], [MODEL, ""]]) {
      expect(await openObject(model, object), `${model} ${object}`).toBe(false);
    }
    expect([loaded, published]).toEqual([[], []]);
  });

  it("opens nothing in a frame without a model, and says no where the client's topics cannot be had", async () => {
    vi.stubGlobal("window", { require: () => undefined });
    expect(await openObject(MODEL, "102000000001")).toBe(false);
    // A loader that refuses the module, one that throws, one that never answers, and a topic that throws when published.
    frame((_modules: unknown, _ready: unknown, failed: (error: Error) => void) => failed(new Error("module not found")));
    expect(await openObject(MODEL, "101000000001")).toBe(false);
    frame(() => { throw new Error("no loader"); });
    expect(await openObject(MODEL, "102000000001")).toBe(false);
    frame(() => undefined);
    expect(await openObject(MODEL, "102000000001", 10)).toBe(false);
    frame((_modules: unknown, ready: (topic: unknown) => void) => ready({ publish: () => { throw new Error("no subscriber"); } }));
    expect(await openObject(MODEL, "101000000001")).toBe(false);
    expect(published).toEqual([]);
  });
});
