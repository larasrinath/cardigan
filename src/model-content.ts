import { reportFrame, serveCore } from "./bridge.js";
import { stampLine } from "./details.js";
import { exportModel } from "./model/export.js";
import { modelOnPage } from "./model/native.js";
import { firstLine } from "./progress.js";

/** The model export's reading side. It runs in the page's main world in every Anaplan frame, because the Model settings
 * grids are read through the page's own classic client, and stays inert anywhere without an open classic model. It puts
 * nothing on the page and exports only when the top window's content script asks (bridge.ts).
 * - Every frame reports what it sees to the top window for a minute (types only), for the diagnostic log.
 * - Core frame inside the Model Building page (the usual case): the top window is the page around it.
 * - Classic model page opened on its own: the top window is this window, and its content script asks from the isolated
 *   world of the same window. The export's own log then begins as the results page's does, with the build, the model and
 *   the host, so that Model Details.csv has that row, as it had in 0.6.1. Inside Model Building the frame's log, and so
 *   the file, has never had it. */

/** The export with that first line, stamped as the export starts, before the log it is given. */
const exportOwnPage: typeof exportModel = (progress, diagnostics, stop) => {
  const model = modelOnPage();
  const first = model ? `${stampLine(firstLine("model", model, location.host))}\r\n` : "";
  return exportModel(progress, () => `${first}${diagnostics()}`, stop);
};

if (window.top) reportFrame(window.top);

const started = Date.now();
const watch = setInterval(() => {
  if (modelOnPage()) {
    clearInterval(watch);
    if (window.top) serveCore(window, window.top, modelOnPage, window.top === window ? exportOwnPage : exportModel);
  } else if (Date.now() - started > 10 * 60_000) {
    clearInterval(watch);
  }
}, 1000);
