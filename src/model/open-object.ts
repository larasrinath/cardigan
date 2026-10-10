import { modelOnPage } from "./native.js";

/** Opens one of the model's modules, lists or settings pages in the Model Building page around this frame, beside the tabs
 * open there, the way Model Building itself has one opened. Everything after the one topic this publishes is Anaplan's own
 * code, as for a click there. Runs in the page's main world, in the frame that holds the model.
 *
 * A module or a list: by publishing the classic client's "anaplan/views" topic with the object's ID. The Modules list does
 * so for a module (anaplan/settings/Modules/ModulesView.js), and General Lists for a list (anaplan/settings/View.js
 * `_doOpenHierarchy`); the model map and the toolbar's buttons do the same. Then:
 * - in the core frame, anaplan/coreframe/ObjectLoader.js hands the topic to objectLoaderUtils.openObjectRequested, which
 *   tells the page around the frame "open-object-requested" (modern-src/api/parentApp: post-robot), with a list's ID as
 *   its own (`getEntityId` knows a hierarchy's);
 * - Model Building (modeling.js) adds the object's tab to those open (`addTabs`), selects it (`attemptOpenObject`), puts
 *   it in its address (`/tabs/{id}`), and asks the frame to load it (`openObject`, "anaplan/coreframe/load"). It opens a
 *   list only for a workspace administrator, as it shows lists only to one, and says to anyone else that it cannot find
 *   the object: the filter it puts the objects asked for through lets lists, line item subsets and the model's contents
 *   pass only for the workspace role ADMIN.
 *
 * A settings page (Time, Versions, Line Item Subsets, Actions, Source Models): by publishing the topic the core frame loads
 * an object by, "anaplan/coreframe/load", with the page's ID, no context and no options. That is the topic Model Building
 * has published when its sidebar opens the page: a click there sets the object to open (modeling.js, the sidebar's items
 * and `attemptOpenObject`), Model Building sends the frame "openObject" with that ID and its context, none here
 * (`context: baseContext || []`), and the frame's bridge publishes this topic with them (modern-src/api/parentApp
 * `openObjectListener`). The settings tab is Model Building's own, one for every settings page: "open-object-requested"
 * would add the page as a tab of its own with no name, so it is not asked for that way. Then:
 * - in the core frame, ObjectLoader.js hands the topic to objectLoaderUtils.loadObject, which loads the page as it loads
 *   it for the sidebar (settingsLoaderUtils `loadSettings`, which knows these pages by these IDs), adds it beside the open
 *   tabs and selects it; the selection publishes "anaplan/parentApp/objectActivated" (objectLoaderUtils `onSelectChild`),
 *   which tells Model Building "objectActivated" with the page's ID (modern-src/api/parentApp/messageCreators);
 * - Model Building's listener for it runs `tabs/processPendingObjectId` (modeling.js), which puts the page in its address
 *   (`/tabs/{id}`) and makes it its settings tab, by the page's name, selected. The tabs open beside it stay open: the
 *   tab list the frame sends with it (`publishSuccess`) holds the modules and lists it holds, and no settings page.
 *
 * Nothing is sent to Anaplan by this, and nothing in the model changes: the page shows another module, list or settings
 * page, as it would for the user's click. */

// The classic client is an untyped AMD module graph.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** The topic the classic client opens an object's tab with, its ID as the one argument. */
export const OPEN_TOPIC = "anaplan/views";
/** The topic the core frame loads an object by, with its ID, a context and options (anaplan/coreframe/ObjectLoader.js). */
export const LOAD_TOPIC = "anaplan/coreframe/load";
/** The entity types this opens, by the first three of an ID's twelve digits: a list (a hierarchy, to the client) and a
 * module (model/export.ts `idsOfType`). */
export const OPENED_TYPES: ReadonlyMap<number, string> = new Map([[101, "list"], [102, "module"]]);
/** The settings pages this opens, by the ID Model Building's sidebar opens each by (modeling.js `Ce`:
 * MODEL_CONTENT_TIMESCALE_ENTITY_LONG_ID, _VERSION_, _LINE_ITEM_SUBSET_, _ACTION_ and _REMOTE_MODEL_), each one of the
 * pages the core frame's settings loader knows (settingsLoaderUtils `settingsPages`). The Time page holds Model Calendar
 * and Time Ranges, and Actions the processes, imports, exports, other actions and import data sources. */
export const SETTINGS_PAGES: ReadonlyMap<number, string> = new Map([
  [9000000001, "Time"], [9000000002, "Versions"], [-5, "Line Item Subsets"], [-19, "Actions"], [-13, "Source Models"],
]);
/** How long the client's loader may take to hand over its topics, which it has loaded long before. */
const LOADER_WAIT_MS = 500;

/** What opens `object`, as the topic and its arguments to publish: a module or a list by "anaplan/views", a settings page
 * by "anaplan/coreframe/load". None for any other ID, and for one written otherwise than as its number is ("-019"). */
function askFor(object: string): unknown[] | undefined {
  const id = Number(object);
  if (/^\d{12}$/.test(object) && OPENED_TYPES.has(Math.floor(id / 1e9))) return [OPEN_TOPIC, id];
  if (SETTINGS_PAGES.has(id) && String(id) === object) return [LOAD_TOPIC, id, [], {}];
  return undefined;
}

/** Opens the module, the list or the settings page `object` of the model `model` in the page around this frame. True once
 * the client was asked; false where this frame holds another model or none, where `object` is none of those, and where
 * the client's topics are not to be had. */
export function openObject(model: string, object: string, waitMs = LOADER_WAIT_MS): Promise<boolean> {
  const ask = askFor(object);
  const own = modelOnPage();
  if (!ask || !own || own.toUpperCase() !== model.toUpperCase()) return Promise.resolve(false);
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
          topic.publish(...ask);
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
