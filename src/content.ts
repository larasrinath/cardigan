import { analyseApp } from "./analyse.js";
import { exportInCore, watchCore, watchProbes, type CoreHandle, type FrameProbe } from "./bridge.js";
import { asDownload, MODEL_EXPORT_PANEL, mountOnce } from "./panel.js";
import { RestError } from "./rest.js";

/** The page the user sees. On an app page, "Analyse app" exports its pages. On a Model Building page, "Export model"
 * exports the model's settings through the model's core frame (see bridge.ts). Everything is read-only, using the
 * signed-in browser session; the result is a local download. */

const APP_PATH = /\/apps\/app\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i;
const MODEL_PATH = /\/a\/modeling(?:-ui)?\/.*\/models\/([0-9A-Za-z]{32})(?:[/?#]|$)/;

if (window.top === window) {
  mountOnce({
    id: "page-analyzer",
    launchLabel: "Analyse app",
    title: "Page analyzer",
    description: "Exports every page in this app (cards, modules, line items, filters, conditional formatting and actions) as CSV files. It only reads.",
    startLabel: "Export pages",
    subject: () => APP_PATH.exec(location.pathname)?.[1],
    run: (appGuid, progress, diagnostics) => analyseApp(appGuid, progress, diagnostics).then(asDownload),
    describeError: error => (error instanceof RestError && error.code === "SIGNED_OUT" ? "You're signed out of Anaplan. Sign in and try again." : undefined),
  });

  let core: CoreHandle | undefined;
  const probes = new Map<string, FrameProbe>();
  watchCore(window, found => { core = found; });
  watchProbes(window, probe => { probes.set(`${probe.host}${probe.path}`, probe); });
  mountOnce({
    id: "model-export-shell",
    ...MODEL_EXPORT_PANEL,
    subject: () => MODEL_PATH.exec(location.pathname)?.[1],
    // The model's own frame (the classic client inside this page) does the reading (bridge.ts).
    run: (model, progress) => exportInCore(window, () => core, () => probes.values(), model, progress).then(asDownload),
  });
}
