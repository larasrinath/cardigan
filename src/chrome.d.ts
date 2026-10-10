/** The few Chrome extension APIs Cardigan uses, declared here so the project needs no typings package. */
declare namespace chrome {
  namespace runtime {
    interface Port {
      name: string;
      /** Who opened the port: the extension's ID and, for a content script, its tab. */
      sender?: { id?: string; tab?: { id?: number } };
      postMessage(message: unknown): void;
      disconnect(): void;
      onMessage: { addListener(listener: (message: unknown) => void): void };
      onDisconnect: { addListener(listener: () => void): void };
    }
    const id: string;
    /** Set while a callback runs after a failed call, for example a port to a tab with no content script. */
    const lastError: { message?: string } | undefined;
    function getURL(path: string): string;
    function getManifest(): { name: string; version: string };
    const onConnect: { addListener(listener: (port: Port) => void): void };
  }
  namespace tabs {
    /** `openerTabId`: the tab that opened this one, where one did and the browser still says so. `status`: "loading" while
     * its page loads, "complete" once it has. */
    interface Tab { id?: number; index: number; windowId?: number; openerTabId?: number; status?: string }
    function connect(tabId: number, info?: { name?: string }): runtime.Port;
    /** The tab of the extension's page that asks: undefined for a page that is in no tab. */
    function getCurrent(): Promise<Tab | undefined>;
    /** Rejects when there is no tab with that ID. */
    function get(tabId: number): Promise<Tab>;
    function create(properties: { url: string; index?: number; windowId?: number; openerTabId?: number; active?: boolean }): Promise<Tab>;
    /** Takes a tab to an address, and to the front of its window. Rejects when there is no tab with that ID. */
    function update(tabId: number, properties: { url?: string; active?: boolean }): Promise<Tab | undefined>;
    /** Loads a tab's page afresh. Rejects when there is no tab with that ID. */
    function reload(tabId: number): Promise<void>;
  }
  namespace windows {
    /** Brings a window to the front. */
    function update(windowId: number, info: { focused?: boolean }): Promise<unknown>;
  }
  /** The "scripting" permission's, in a tab the toolbar icon was clicked on ("activeTab"), and there only in the frames on
   * that tab's own origin: `allFrames` leaves the others out without a word. `world` "MAIN" runs the files in the page's
   * own world, as the manifest's main-world content script runs. */
  namespace scripting {
    interface InjectionResult { result?: unknown; frameId?: number }
    function executeScript(injection: { target: { tabId: number; allFrames?: boolean }; files?: string[]; func?: () => unknown; world?: "ISOLATED" | "MAIN" }): Promise<InjectionResult[]>;
  }
  namespace action {
    const onClicked: { addListener(listener: (tab: tabs.Tab) => void): void };
  }
}
