import { modelOnPage } from "./native.js";

/** Opens one of the model's modules in the Model Building page around this frame, beside the modules open there, the way
 * Model Building's own Modules list opens one: by publishing the classic client's "anaplan/views" topic with the module's
 * ID (anaplan/settings/Modules/ModulesView.js; the model map and the toolbar's buttons do the same). Everything after that
 * is Anaplan's own code, as for a click there:
 * - in the core frame, anaplan/coreframe/ObjectLoader.js hands the topic to objectLoaderUtils.openObjectRequested, which
 *   tells the page around the frame "open-object-requested" (modern-src/api/parentApp: post-robot);
 * - Model Building (modeling.js) adds the module's tab to those open (`addTabs`), selects it (`attemptOpenObject`), puts
 *   it in its address (`/tabs/{id}`), and asks the frame to load it (`openObject`, "anaplan/coreframe/load").
 * Nothing is sent to Anaplan by this, and nothing in the model changes: the page shows another module, as it would for the
 * user's click. Runs in the page's main world, in the frame that holds the model. */

// The classic client is an untyped AMD module graph.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** The topic the classic client opens a module's tab with, its module's ID as the one argument. */
export const OPEN_TOPIC = "anaplan/views";
/** A module's entity type: the first three of its ID's twelve digits (model/export.ts `moduleIdsOf`). */
const MODULE_TYPE = 102;
/** How long the client's loader may take to hand over its topics, which it has loaded long before. */
const LOADER_WAIT_MS = 500;

/** Opens the module `module` of the model `model` in the page around this frame. True once the client was asked; false
 * where this frame holds another model or none, where `module` is no module's ID, and where the client's topics are not
 * to be had. */
export function openModule(model: string, module: string, waitMs = LOADER_WAIT_MS): Promise<boolean> {
  const id = Number(module);
  const own = modelOnPage();
  if (!/^\d{12}$/.test(module) || Math.floor(id / 1e9) !== MODULE_TYPE || !own || own.toUpperCase() !== model.toUpperCase()) return Promise.resolve(false);
  const w = window as Any;
  return new Promise(resolve => {
    let settled = false;
    const finish = (opened: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(opened);
    };
    const timer = setTimeout(() => finish(false), waitMs);
    try {
      w.require(["dojo/topic"], (topic: Any) => {
        if (settled) return;
        try {
          topic.publish(OPEN_TOPIC, id);
          finish(true);
        } catch {
          finish(false);
        }
      }, () => finish(false));
    } catch {
      finish(false);
    }
  });
}
