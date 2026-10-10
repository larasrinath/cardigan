import { analyseApp } from "./analyse.js";
import { exportInCore, greetFrames, openInCore, watchCore, watchProbes, type CoreHandle, type FrameProbe } from "./bridge.js";
import { addModelPages } from "./model-pages.js";
import type { Subject } from "./protocol.js";
import { RestError } from "./rest.js";
import { serveTab, type Opened } from "./tab-port.js";
import { sleep } from "./util.js";
import { BUILD } from "./version.js";

/** The page the user sees: the top window of an Anaplan tab, in the isolated world. It puts nothing on the page and reads
 * nothing from Anaplan until the results page, opened by the toolbar icon, connects and asks it to run (tab-port.ts). Then,
 * on an app page, it analyses the app's pages; on a Model Building page, it exports the model's settings through the
 * model's core frame (bridge.ts), and then reads the pages built on the model (model-pages.ts). Everything is read-only,
 * using the signed-in browser session. Asked by the results page, it also opens one of the model's modules inside the
 * Model Building page, as Model Building's own Modules list does: Cardigan itself sends Anaplan nothing for that. */

const APP_PATH = /\/apps\/app\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i;
const MODEL_PATH = /\/a\/modeling(?:-ui)?\/.*\/models\/([0-9A-Za-z]{32})(?:[/?#]|$)/;
/** The customer a Model Building address names: the results page opens a module of the model with it, and the pages
 * built on the model are read for it. */
const CUSTOMER_PATH = /\/a\/modeling(?:-ui)?\/customers\/([0-9A-Fa-f]{32})(?:[/?#]|$)/;

/** This script can be put into a document more than once: by Chrome as the page loads, and by the results page when none
 * answers it, as in a tab that was open before Cardigan was installed, updated or reloaded (results/connection.ts). Only
 * the latest answers the results page. The mark is on this script's own view of the window (the isolated world), which
 * the page cannot see; a script left from before a reload may share it, and can no longer be reached anyway. */
const page = window as unknown as { cardiganServing?: symbol };
const me = Symbol("cardigan");

if (window.top === window) {
  page.cardiganServing = me;
  /** The model's holder as it announced itself: a core frame inside this page, or this window itself. */
  let frame: CoreHandle | undefined;
  let own: CoreHandle | undefined;
  const probes = new Map<string, FrameProbe>();
  watchCore(window, found => { if (found.source === (window as unknown)) own = found; else frame = found; });
  watchProbes(window, probe => { probes.set(`${probe.host}${probe.path}`, probe); });

  /** An app or a model, by the page's address. The classic model page opened on its own names no model in its address: it
   * is a model page once the main-world script in this same window has announced the model it holds. */
  const subject = (): Subject => {
    const app = APP_PATH.exec(location.pathname)?.[1];
    if (app) return { kind: "app", id: app };
    const building = MODEL_PATH.exec(location.pathname)?.[1];
    const model = building ?? own?.modelId;
    if (!model) return { kind: "none" };
    // A model in Model Building says where it is, so that its modules can be opened there from the results page.
    const customer = building ? CUSTOMER_PATH.exec(location.pathname)?.[1] : undefined;
    return { kind: "model", id: model, ...(customer ? { origin: location.origin, customer } : {}) };
  };
  /** A Model Building page's model is read in its core frame; the classic page's, in this window. */
  const core = () => (MODEL_PATH.test(location.pathname) ? frame : own);

  /** Opens a module or a list of the model inside this Model Building page, beside the tabs open there, through the
   * model's core frame (model/open-object.ts), so that the page does not load afresh. Only where the page shows that model in Model
   * Building, and only through a frame of this build, which knows how: otherwise the results page loads the module's
   * address. A frame that checked in with an earlier copy of this script is greeted, to check in again. */
  const open = async (model: string, object: string): Promise<Opened> => {
    const shown = MODEL_PATH.exec(location.pathname)?.[1];
    if (!shown) return { opened: false, detail: "the tab does not show Model Building" };
    if (shown.toUpperCase() !== model.toUpperCase()) return { opened: false, detail: "the tab shows another model" };
    if (!frame) {
      greetFrames(window);
      await sleep(300);
    }
    const found = frame;
    if (!found || found.modelId.toUpperCase() !== model.toUpperCase()) return { opened: false, detail: "the model's frame has not checked in" };
    if (found.build !== BUILD) return { opened: false, detail: "the model's frame holds a reader of another build" };
    return await openInCore(window, found, model, object)
      ? { opened: true, detail: "Model Building opened it beside the tabs open there" }
      : { opened: false, detail: "the model's frame did not open it" };
  };

  serveTab(chrome.runtime, {
    host: location.host,
    current: () => page.cardiganServing === me,
    subject,
    // A model read in Model Building carries where it is, which the results page opens its modules, apps and pages by.
    run: (seen, progress, diagnostics, signal) => (seen.kind === "app"
      ? analyseApp(seen.id, progress, diagnostics, signal)
      : exportInCore(window, core, () => probes.values(), seen.id, progress, signal)
        .then(result => addModelPages(result, seen.customer, progress, signal))
        .then(result => (seen.origin && seen.customer ? { ...result, site: { origin: seen.origin, customer: seen.customer } } : result))),
    signedOut: error => error instanceof RestError && error.code === "SIGNED_OUT",
    open,
  });
}
