import { reportFrame, serveCore } from "./bridge.js";
import { exportModel } from "./model/export.js";
import { modelOnPage } from "./model/native.js";

/** The model export's reading side. It runs in the page's main world in every Anaplan frame, because the Model settings
 * grids are read through the page's own classic client, and stays inert anywhere without an open classic model. It puts
 * nothing on the page and exports only when the top window's content script asks (bridge.ts).
 * - Every frame reports what it sees to the top window for a minute (types only), for the diagnostic log.
 * - Core frame inside the Model Building page (the usual case): the top window is the page around it.
 * - Classic model page opened on its own: the top window is this window, and its content script asks from the isolated
 *   world of the same window. */

if (window.top) reportFrame(window.top);

const started = Date.now();
const watch = setInterval(() => {
  if (modelOnPage()) {
    clearInterval(watch);
    if (window.top) serveCore(window, window.top, modelOnPage, exportModel);
  } else if (Date.now() - started > 10 * 60_000) {
    clearInterval(watch);
  }
}, 1000);
