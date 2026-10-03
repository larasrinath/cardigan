import { analyseApp } from "./analyse.js";
import { describeProbe, greetFrames, runInCore, watchCore, watchProbes, type CoreHandle, type FrameProbe } from "./bridge.js";
import { asDownload, MODEL_EXPORT_PANEL, mountOnce } from "./panel.js";
import { RestError } from "./rest.js";
import { sleep } from "./util.js";

/** The page the user sees. On an app page, "Analyse app" exports its pages. On a Model Building page, "Export model"
 * exports the model's settings through the model's core frame (see bridge.ts). Everything is read-only, using the
 * signed-in browser session; the result is a local download. */

const APP_PATH = /\/apps\/app\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i;
const MODEL_PATH = /\/a\/modeling(?:-ui)?\/.*\/models\/([0-9A-Za-z]{32})(?:[/?#]|$)/;
const WAIT_FOR_CORE_MS = 20_000;

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
    run: async (model, progress) => {
      // The model's own frame (the classic client inside this page) does the reading; wait for it to check in.
      const deadline = Date.now() + WAIT_FOR_CORE_MS;
      while (!core && Date.now() < deadline) {
        progress.status("Waiting for the model's frame…");
        greetFrames(window);
        await sleep(1000);
      }
      for (const probe of probes.values()) progress.log(describeProbe(probe));
      if (!core) {
        throw new Error(probes.size
          ? `The model's frame did not answer. ${probes.size} frame(s) reported; copy the diagnostic log and send it.`
          : "No frame reported in. Reload the extension in chrome://extensions, refresh this tab and try again.");
      }
      if (core.modelId.toUpperCase() !== model.toUpperCase()) progress.log("the model frame reports a different model than this page's address");
      return runInCore(window, core, progress);
    },
  });
}
