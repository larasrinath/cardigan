import { analyseApp } from "./analyse.js";
import { exportInCore, watchCore, watchProbes, type CoreHandle, type FrameProbe } from "./bridge.js";
import { addModelPages } from "./model-pages.js";
import type { Subject } from "./protocol.js";
import { RestError } from "./rest.js";
import { serveTab } from "./tab-port.js";

/** The page the user sees: the top window of an Anaplan tab, in the isolated world. It puts nothing on the page and reads
 * nothing from Anaplan until the results page, opened by the toolbar icon, connects and asks it to run (tab-port.ts). Then,
 * on an app page, it analyses the app's pages; on a Model Building page, it exports the model's settings through the
 * model's core frame (bridge.ts), and then reads the pages built on the model (model-pages.ts). Everything is read-only,
 * using the signed-in browser session. */

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
  });
}
