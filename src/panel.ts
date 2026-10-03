import { stampLine } from "./details.js";
import type { Progress } from "./progress.js";
import { VERSION } from "./version.js";

/** The floating button and progress panel shared by the app page analysis and the model export. Nothing runs until the
 * user clicks the start button; the result is a local download. */

export interface TaskResult { zip: Uint8Array<ArrayBuffer>; fileName: string; summary: string[] }

export interface PanelOptions {
  /** Distinguishes the two tools on one page and in the page's DOM. */
  id: string;
  launchLabel: string;
  title: string;
  description: string;
  startLabel: string;
  /** The current subject (an app ID, a model ID), or undefined when the tool does not apply to this page. */
  subject(): string | undefined;
  run(subject: string, progress: Progress, diagnostics: () => string): Promise<TaskResult>;
  /** A friendlier message for known failures. */
  describeError?(error: unknown): string | undefined;
}

/** What the model export's panel says, on the Model Building page (content.ts) and on the classic model page opened on
 * its own (model-content.ts). Each mounts it under its own `id`. */
export const MODEL_EXPORT_PANEL: Pick<PanelOptions, "launchLabel" | "title" | "description" | "startLabel"> = {
  launchLabel: "Export model",
  title: "Model export",
  description: "Exports this model's Model settings (line items, modules, lists, actions, time ranges, versions and source models) and the model calendar as CSV files. It only reads.",
  startLabel: "Export model",
};

const MAX_LOG_LINES = 3000;
const STYLE = `
  :host { all: initial; }
  .wrap { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; font: 13px/1.4 system-ui, "Segoe UI", Arial, sans-serif; color: #1d2733; }
  button { font: inherit; cursor: pointer; border-radius: 6px; border: 1px solid #1f4e79; padding: 6px 12px; background: #fff; color: #1f4e79; }
  button.primary { background: #1f4e79; color: #fff; }
  button:disabled { opacity: .5; cursor: default; }
  .launch { box-shadow: 0 2px 8px rgba(0,0,0,.2); }
  .panel { width: 380px; max-width: calc(100vw - 32px); background: #fff; border: 1px solid #c9d1da; border-radius: 8px; box-shadow: 0 6px 24px rgba(0,0,0,.2); padding: 12px; }
  .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .title { font-weight: 600; font-size: 14px; }
  .close { border: none; padding: 2px 6px; font-size: 16px; line-height: 1; }
  .status { margin-bottom: 8px; }
  .summary { margin: 0 0 8px; padding-left: 18px; max-height: 140px; overflow: auto; }
  .log { background: #f4f6f8; border-radius: 4px; padding: 6px; height: 120px; overflow: auto; white-space: pre-wrap; word-break: break-word; font: 11px/1.35 ui-monospace, Consolas, monospace; margin: 0 0 8px; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  [hidden] { display: none !important; }
`;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, children: Node[] = []): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of children) node.append(child);
  return node;
}

export class ToolPanel {
  private readonly host = element("div");
  private readonly launch: HTMLButtonElement;
  private readonly status = element("div", { className: "status" });
  private readonly summary = element("ul", { className: "summary" });
  private readonly logView = element("pre", { className: "log" });
  private readonly start: HTMLButtonElement;
  private readonly download = element("button", { className: "primary", textContent: "Download CSVs (.zip)", hidden: true });
  private readonly copy = element("button", { textContent: "Copy diagnostic log" });
  private readonly closeButton = element("button", { className: "close", textContent: "×", title: "Close" });
  private readonly panel: HTMLDivElement;
  private lines: string[] = [];
  private result: TaskResult | undefined;
  private running = false;
  private current: string | undefined;

  constructor(private readonly options: PanelOptions, offset = 0) {
    this.launch = element("button", { className: "launch primary", textContent: options.launchLabel, title: options.title });
    this.start = element("button", { className: "primary", textContent: options.startLabel });
    this.panel = element("div", { className: "panel", hidden: true }, [
      element("div", { className: "head" }, [element("span", { className: "title", textContent: `${options.title} · v${VERSION}` }), this.closeButton]),
      this.status, this.summary, this.logView,
      element("div", { className: "actions" }, [this.start, this.download, this.copy]),
    ]);
    const root = this.host.attachShadow({ mode: "closed" });
    const wrap = element("div", { className: "wrap" }, [this.launch, this.panel]);
    if (offset) wrap.style.bottom = `${16 + offset}px`;
    root.append(element("style", { textContent: STYLE }), wrap);
    // Opening the panel starts nothing: the task runs only when the user clicks the start button.
    this.launch.addEventListener("click", () => this.open());
    this.start.addEventListener("click", () => void this.run());
    this.closeButton.addEventListener("click", () => { this.panel.hidden = true; this.update(); });
    this.download.addEventListener("click", () => this.save());
    this.copy.addEventListener("click", () => void navigator.clipboard.writeText(this.lines.join("\n")).then(
      () => { this.copy.textContent = "Copied"; setTimeout(() => { this.copy.textContent = "Copy diagnostic log"; }, 1500); },
      () => { this.copy.textContent = "Copy failed"; }));
    document.documentElement.append(this.host);
    this.update();
    // Anaplan pages are single-page apps: follow changes without touching the page's own scripts.
    setInterval(() => this.update(), 1000);
  }

  private update(): void {
    const subject = this.options.subject();
    if (subject !== this.current && !this.running) { this.current = subject; this.result = undefined; this.ready(); }
    this.host.hidden = !subject && !this.running && this.panel.hidden;
    this.launch.hidden = !this.panel.hidden;
  }

  private open(): void {
    this.panel.hidden = false;
    this.update();
  }

  private ready(): void {
    this.status.textContent = this.options.description;
    this.summary.replaceChildren();
    this.start.textContent = this.options.startLabel;
    this.start.disabled = false;
    this.download.hidden = true;
  }

  private log = (line: string): void => {
    this.lines.push(stampLine(line));
    if (this.lines.length > MAX_LOG_LINES) this.lines.splice(0, this.lines.length - MAX_LOG_LINES);
    this.logView.textContent = this.lines.slice(-40).join("\n");
    this.logView.scrollTop = this.logView.scrollHeight;
  };

  private async run(): Promise<void> {
    const subject = this.current;
    if (!subject || this.running) return;
    this.running = true;
    this.result = undefined;
    this.download.hidden = true;
    this.start.disabled = true;
    this.summary.replaceChildren();
    this.lines = [];
    this.log(`${this.options.id} v${VERSION}: ${subject} on ${location.host}${window.top === window ? "" : " (in a frame)"}`);
    try {
      this.result = await this.options.run(subject, { status: text => { this.status.textContent = text; this.log(text); }, log: this.log }, () => this.lines.join("\r\n"));
      this.status.textContent = "Done. Download the CSVs below.";
      this.summary.replaceChildren(...this.result.summary.map(line => element("li", { textContent: line })));
      this.download.hidden = false;
    } catch (error) {
      const text = this.options.describeError?.(error) ?? `Stopped: ${error instanceof Error ? error.message : String(error)}`;
      this.status.textContent = text;
      this.log(`stopped: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
      this.start.disabled = false;
      this.start.textContent = `${this.options.startLabel} again`;
      this.update();
    }
  }

  private save(): void {
    if (!this.result) return;
    const url = URL.createObjectURL(new Blob([this.result.zip], { type: "application/zip" }));
    const link = element("a", { href: url, download: this.result.fileName });
    link.style.display = "none";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

/** Mounts a tool once per document (content scripts can be injected more than once). */
export function mountOnce(options: PanelOptions, offset = 0): void {
  const marker = `data-sam-${options.id}`;
  if (document.documentElement.hasAttribute(marker)) return;
  document.documentElement.setAttribute(marker, "");
  new ToolPanel(options, offset);
}
