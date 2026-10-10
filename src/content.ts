import { analyseApp } from "./analyse.js";
import { exportInCore, greetFrames, openInCore, watchCore, watchProbes, type CoreHandle, type FrameProbe } from "./bridge.js";
import { startModelPages } from "./model-pages.js";
import type { Progress } from "./progress.js";
import type { Subject } from "./protocol.js";
import { RestError } from "./rest.js";
import { serveTab, type Opened, type Seen } from "./tab-port.js";
import { sleep } from "./util.js";
import { withVersion } from "./version-label.js";
import { BUILD } from "./version.js";

/** The page the user sees: the top window of an Anaplan tab, in the isolated world. It puts nothing on the page and reads
 * nothing from Anaplan until the results page, opened by the toolbar icon, connects and asks it to run (tab-port.ts). Then,
 * on an app page, it analyses the app's pages; on a Model Building page, it exports the model's settings through the
 * model's core frame (bridge.ts), and reads the pages built on the model beside it (model-pages.ts). Everything is read-only,
 * using the signed-in browser session. Asked by the results page, it also opens one of the model's modules inside the
 * Model Building page, as Model Building's own Modules list does: Cardigan itself sends Anaplan nothing for that. */

const APP_PATH = /\/apps\/app\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i;
const MODEL_PATH = /\/a\/modeling(?:-ui)?\/.*\/models\/([0-9A-Za-z]{32})(?:[/?#]|$)/;
/** The customer a Model Building address names: the results page opens a module of the model with it, and the pages
 * built on the model are read for it. */
const CUSTOMER_PATH = /\/a\/modeling(?:-ui)?\/customers\/([0-9A-Fa-f]{32})(?:[/?#]|$)/;
/** The workspace a Model Building address names after its customer: with the customer and the model, the pages built on
 * the model are read beside its export (model-pages.ts `startModelPages`). */
const WORKSPACE_PATH = /\/a\/modeling(?:-ui)?\/customers\/[0-9A-Fa-f]{32}\/workspaces\/([0-9A-Za-z]{32})(?:[/?#]|$)/;

/** This script can be put into a document more than once: by Chrome as the page loads, and by the results page when none
 * answers it, as in a tab that was open before Cardigan was installed, updated or reloaded (results/connection.ts). Only
 * the latest answers the results page. The mark is on this script's own view of the window (the isolated world), which
 * the page cannot see; a script left from before a reload may share it, and can no longer be reached anyway. */
const page = window as unknown as { cardiganServing?: symbol };
const me = Symbol("cardigan");

/** How long a run waits for the model's frame when the results page has just refreshed the tab for it (protocol.ts "run"
 * `afterRefresh`): a model takes a while to open again. Otherwise the export waits as long as it always has. */
const AFTER_REFRESH_WAIT_MS = 180_000;

/** Whether a reader that checks in takes the place of the one held: a reader of this build is never replaced by one of
 * another. A frame can hold both, after the results page put this build's beside the one Chrome put there
 * (results/connection.ts `renewReader`), and each says so when greeted: this build's is the one asked. One of another
 * build is held until one of this build checks in, so that a run can say why it reads nothing. */
const takes = (found: CoreHandle, held: CoreHandle | undefined): boolean => found.build === BUILD || held?.build !== BUILD;

if (window.top === window) {
  page.cardiganServing = me;
  /** The model's holder as it announced itself: a core frame inside this page, or this window itself. */
  let frame: CoreHandle | undefined;
  let own: CoreHandle | undefined;
  const probes = new Map<string, FrameProbe>();
  watchCore(window, found => {
    if (found.source === (window as unknown)) { if (takes(found, own)) own = found; } else if (takes(found, frame)) frame = found;
  });
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

  /** The host of the frame the model is read in, where its reader has checked in: the model's own data centre, where the
   * model's names are asked for (analyse.ts `withSocket`). */
  const frameHost = (): string | undefined => {
    const origin = core()?.origin;
    try {
      return origin ? new URL(origin).host : undefined;
    } catch {
      return undefined;
    }
  };

  /** A model's run: its export through its frame, and beside it the pages built on the model with the model's names,
   * which need nothing of the export to be read (model-pages.ts `startModelPages`). A failed or stopped export gives up
   * what was started beside it. The IDs of its line items come with the export for reading the pages built on it, and go
   * no further: they are taken off the result here, so that the results page never holds them. The export says it was
   * made with this version, whichever version the model's reader is of (version-label.ts). A model read in Model
   * Building carries where it is, which the results page opens its modules, apps and pages by. */
  const readModel = async (seen: Seen, progress: Progress, signal: AbortSignal, afterRefresh: boolean) => {
    const pages = startModelPages({ customerId: seen.customer, workspaceId: WORKSPACE_PATH.exec(location.pathname)?.[1], modelId: seen.id, frameHost }, progress, signal);
    let exported: Awaited<ReturnType<typeof exportInCore>>;
    try {
      exported = await exportInCore(window, core, () => probes.values(), seen.id, progress, signal, afterRefresh ? AFTER_REFRESH_WAIT_MS : undefined);
    } catch (error) {
      pages.abandon(error);
      throw error;
    }
    const { lineItemIds, ...result } = exported;
    const read = await pages.finish(withVersion(result), lineItemIds);
    return seen.origin && seen.customer ? { ...read, site: { origin: seen.origin, customer: seen.customer } } : read;
  };

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
    if (found.build !== BUILD) return { opened: false, detail: "the model's frame holds a reader of another build", oldReader: true };
    return await openInCore(window, found, model, object)
      ? { opened: true, detail: "Model Building opened it beside the tabs open there" }
      : { opened: false, detail: "the model's frame did not open it" };
  };

  serveTab(chrome.runtime, {
    host: location.host,
    current: () => page.cardiganServing === me,
    subject,
    run: (seen, progress, diagnostics, signal, asked) => (seen.kind === "app"
      ? analyseApp(seen.id, progress, diagnostics, signal)
      : readModel(seen, progress, signal, asked?.afterRefresh === true)),
    signedOut: error => error instanceof RestError && error.code === "SIGNED_OUT",
    open,
  });
}
