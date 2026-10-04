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
    interface Tab { id?: number; index: number; windowId?: number }
    function connect(tabId: number, info?: { name?: string }): runtime.Port;
    function create(properties: { url: string; index?: number; windowId?: number; openerTabId?: number; active?: boolean }): Promise<Tab>;
  }
  namespace action {
    const onClicked: { addListener(listener: (tab: tabs.Tab) => void): void };
  }
}
