import { reportFrame, serveCore } from "./bridge.js";
import { exportModel } from "./model/export.js";
import { modelOnPage } from "./model/native.js";
import { MODEL_EXPORT_PANEL, mountOnce } from "./panel.js";

/** The model export's reading side. It runs in the page's main world in every Anaplan frame, because the Model settings
 * grids are read through the page's own classic client, and stays inert anywhere without an open classic model.
 * - Every frame reports what it sees to the top window for a minute (types only), for the diagnostic log.
 * - Classic model page open on its own: show the button here.
 * - Core frame inside the Model Building page (the usual case): serve the page's button over window messages. */

if (window.top) reportFrame(window.top);

const started = Date.now();
const watch = setInterval(() => {
  if (modelOnPage()) {
    clearInterval(watch);
    if (window.top === window) {
      mountOnce({
        id: "model-export",
        ...MODEL_EXPORT_PANEL,
        subject: () => modelOnPage(),
        run: (_model, progress, diagnostics) => exportModel(progress, diagnostics),
      });
    } else if (window.top) {
      serveCore(window, window.top, modelOnPage, exportModel);
    }
  } else if (Date.now() - started > 10 * 60_000) {
    clearInterval(watch);
  }
}, 1000);
