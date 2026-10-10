import { modelOnPage } from "./native.js";

/** Opens one of the model's modules or lists in the Model Building page around this frame, beside the tabs open there, the
 * way Model Building's own views open one: by publishing the classic client's "anaplan/views" topic with the object's ID.
 * The Modules list does so for a module (anaplan/settings/Modules/ModulesView.js), and General Lists for a list
 * (anaplan/settings/View.js `_doOpenHierarchy`); the model map and the toolbar's buttons do the same. Everything after that
 * is Anaplan's own code, as for a click there:
 * - in the core frame, anaplan/coreframe/ObjectLoader.js hands the topic to objectLoaderUtils.openObjectRequested, which
 *   tells the page around the frame "open-object-requested" (modern-src/api/parentApp: post-robot), with a list's ID as
 *   its own (`getEntityId` knows a hierarchy's);
 * - Model Building (modeling.js) adds the object's tab to those open (`addTabs`), selects it (`attemptOpenObject`), puts
 *   it in its address (`/tabs/{id}`), and asks the frame to load it (`openObject`, "anaplan/coreframe/load"). It opens a
 *   list only for a workspace administrator, as it shows lists only to one, and says to anyone else that it cannot find
 *   the object: the filter it puts the objects asked for through lets lists, line item subsets and the model's contents
 *   pass only for the workspace role ADMIN.
 * Nothing is sent to Anaplan by this, and nothing in the model changes: the page shows another module or list, as it would
 * for the user's click. Runs in the page's main world, in the frame that holds the model. */

// The classic client is an untyped AMD module graph.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** The topic the classic client opens an object's tab with, its ID as the one argument. */
export const OPEN_TOPIC = "anaplan/views";
/** The entity types this opens, by the first three of an ID's twelve digits: a list (a hierarchy, to the client) and a
 * module (model/export.ts `idsOfType`). */
export const OPENED_TYPES: ReadonlyMap<number, string> = new Map([[101, "list"], [102, "module"]]);
/** How long the client's loader may take to hand over its topics, which it has loaded long before. */
const LOADER_WAIT_MS = 500;

/** Opens the module or the list `object` of the model `model` in the page around this frame. True once the client was
 * asked; false where this frame holds another model or none, where `object` is no module's or list's ID, and where the
 * client's topics are not to be had. */
export function openObject(model: string, object: string, waitMs = LOADER_WAIT_MS): Promise<boolean> {
  const id = Number(object);
  const own = modelOnPage();
  if (!/^\d{12}$/.test(object) || !OPENED_TYPES.has(Math.floor(id / 1e9)) || !own || own.toUpperCase() !== model.toUpperCase()) return Promise.resolve(false);
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
