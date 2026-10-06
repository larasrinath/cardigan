import { decode, readMarkup } from "./markup.test-support.js";

/** A stand-in for the browser's page, for the page script's tests: results.html and what the script writes into it, as
 * elements a test can look up, read, click and type into. Tests only.
 *
 * It reads markup with the strict reader (markup.test-support.ts) and adds one rule of its own: every element is closed by
 * its own end tag. Markup a browser would have to guess at is therefore an error here, which fails the test that wrote it.
 * It knows only what the page's script uses: lookups by a small set of selectors, text, attributes, focus, and events that
 * go from an element up to the document. Nothing is laid out: every size and position is 0. */

/** Elements that hold nothing and have no end tag. */
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
/** Elements the keyboard reaches without a tabindex. */
const FOCUSABLE = new Set(["a", "button", "input", "select", "textarea"]);

export interface FakeEvent {
  type: string;
  target: FakeElement;
  key?: string;
  defaultPrevented: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}
type Listener = (event: FakeEvent) => void;

/* ---------- selectors ---------- */

/** One element's part of a selector: a name, an ID, classes and attributes, all of which must match. */
interface Simple { name?: string; id?: string; classes: string[]; attributes: [name: string, value: string | undefined][] }

const SIMPLE_PART = /([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]\s"']+)))?\]/y;

/** A selector as a list of alternatives, each a chain of parts from an ancestor down to the element. Only the selectors the
 * page's script uses are known: names, IDs, classes, attributes, "a b" and "a, b". Anything else is an error. */
function readSelector(selector: string): Simple[][] {
  const alternatives: Simple[][] = [[]];
  let current: Simple | undefined;
  let at = 0;
  while (at < selector.length) {
    const char = selector[at];
    if (char === "," || /\s/.test(char)) {
      if (char === ",") alternatives.push([]);
      current = undefined;
      at++;
      continue;
    }
    SIMPLE_PART.lastIndex = at;
    const match = SIMPLE_PART.exec(selector);
    if (!match) throw new Error(`The stand-in page does not know the selector ${JSON.stringify(selector)}`);
    if (!current) {
      current = { classes: [], attributes: [] };
      alternatives[alternatives.length - 1].push(current);
    }
    const [, name, id, className, attribute, double, single, bare] = match;
    if (name !== undefined) current.name = name.toLowerCase();
    else if (id !== undefined) current.id = id;
    else if (className !== undefined) current.classes.push(className);
    else current.attributes.push([attribute, double ?? single ?? bare]);
    at += match[0].length;
  }
  return alternatives;
}

function matchesSimple(element: FakeElement, simple: Simple): boolean {
  return (simple.name === undefined || element.localName === simple.name)
    && (simple.id === undefined || element.id === simple.id)
    && simple.classes.every(name => element.classList.contains(name))
    && simple.attributes.every(([name, value]) => element.attributes.has(name) && (value === undefined || element.attributes.get(name) === value));
}

function matchesChain(element: FakeElement, chain: readonly Simple[]): boolean {
  if (!chain.length || !matchesSimple(element, chain[chain.length - 1])) return false;
  let ancestor = element.parentElement;
  for (let index = chain.length - 2; index >= 0; index--) {
    while (ancestor && !matchesSimple(ancestor, chain[index])) ancestor = ancestor.parentElement;
    if (!ancestor) return false;
    ancestor = ancestor.parentElement;
  }
  return true;
}

/* ---------- markup ---------- */

const escapeText = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeValue = (text: string): string => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

function written(node: FakeElement | FakeText): string {
  if (node instanceof FakeText) return escapeText(node.textContent);
  const attributes = [...node.attributes].map(([name, value]) => (value === "" ? ` ${name}` : ` ${name}="${escapeValue(value)}"`)).join("");
  return VOID.has(node.localName) ? `<${node.localName}${attributes}>` : `<${node.localName}${attributes}>${node.innerHTML}</${node.localName}>`;
}

/** Puts the elements and texts of `html` under `parent`. `whole` allows what only a whole page has (a doctype, comments). */
function build(page: FakePage, parent: FakeElement, html: string, whole = false): void {
  const open = [parent];
  for (const part of readMarkup(html, whole).parts) {
    const top = open[open.length - 1];
    if (typeof part === "string") {
      top.append(decode(part));
    } else if (part.closing) {
      if (open.length === 1 || top.localName !== part.name) throw new Error(`</${part.name}> ends no <${part.name}>: <${top.localName}> is open`);
      open.pop();
    } else {
      const element = page.create(part.name);
      for (const [name, value] of part.attributes) element.attributes.set(name, decode(value ?? ""));
      top.append(element);
      if (!part.selfClosing && !VOID.has(part.name)) open.push(element);
    }
  }
  if (open.length !== 1) throw new Error(`<${open[open.length - 1].localName}> is not ended`);
}

/* ---------- nodes ---------- */

export class FakeText {
  readonly nodeType = 3;
  parentElement: FakeElement | null = null;
  constructor(public textContent: string) {}
}

const dataName = (key: string): string => `data-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`;

export class FakeElement {
  readonly nodeType = 1;
  parentElement: FakeElement | null = null;
  childNodes: (FakeElement | FakeText)[] = [];
  /** Each attribute with its value as the browser reads it; "" for an attribute without a value. */
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, string> = {};
  scrollTop = 0;
  scrollHeight = 0;
  clientHeight = 0;
  offsetHeight = 0;
  selectionStart = 0;
  selectionEnd = 0;
  /** How often the script itself clicked the element, as it does to start a download. */
  clicks = 0;
  /** How often the script asked for the element to be brought into sight. */
  broughtIntoSight = 0;
  private readonly listeners = new Map<string, Listener[]>();
  /** What was typed or chosen, and whether the box was ticked, once that differs from the markup. */
  private entered: string | undefined;
  private ticked: boolean | undefined;

  readonly dataset: Record<string, string | undefined> = new Proxy({}, {
    get: (_, key) => (typeof key === "string" ? this.attributes.get(dataName(key)) : undefined),
    set: (_, key, value) => { this.attributes.set(dataName(String(key)), String(value)); return true; },
  });
  readonly classList = {
    contains: (name: string): boolean => this.classNames().includes(name),
    add: (name: string): void => { if (!this.classList.contains(name)) this.attributes.set("class", [...this.classNames(), name].join(" ")); },
    remove: (name: string): void => { this.attributes.set("class", this.classNames().filter(other => other !== name).join(" ")); },
    toggle: (name: string, force?: boolean): boolean => {
      const on = force ?? !this.classList.contains(name);
      if (on) this.classList.add(name); else this.classList.remove(name);
      return on;
    },
  };

  constructor(readonly page: FakePage, readonly localName: string) {}

  private classNames(): string[] { return (this.attributes.get("class") ?? "").split(/\s+/).filter(name => name !== ""); }
  private flag(name: string, on?: boolean): boolean {
    if (on === true) this.attributes.set(name, "");
    else if (on === false) this.attributes.delete(name);
    return this.attributes.has(name);
  }

  get tagName(): string { return this.localName.toUpperCase(); }
  get id(): string { return this.attributes.get("id") ?? ""; }
  get children(): FakeElement[] { return this.childNodes.filter((node): node is FakeElement => node instanceof FakeElement); }
  get firstChild(): FakeElement | FakeText | null { return this.childNodes[0] ?? null; }
  get lastChild(): FakeElement | FakeText | null { return this.childNodes[this.childNodes.length - 1] ?? null; }
  get isConnected(): boolean {
    for (let node: FakeElement | null = this; node; node = node.parentElement) if (node === this.page.root) return true;
    return false;
  }

  get hidden(): boolean { return this.flag("hidden"); }
  set hidden(on: boolean) { this.flag("hidden", on); }
  get disabled(): boolean { return this.flag("disabled"); }
  set disabled(on: boolean) { this.flag("disabled", on); }
  get inert(): boolean { return this.flag("inert"); }
  set inert(on: boolean) { this.flag("inert", on); }
  get title(): string { return this.attributes.get("title") ?? ""; }
  set title(value: string) { this.attributes.set("title", value); }
  get href(): string { return this.attributes.get("href") ?? ""; }
  set href(value: string) { this.attributes.set("href", value); }
  get download(): string { return this.attributes.get("download") ?? ""; }
  set download(value: string) { this.attributes.set("download", value); }
  get checked(): boolean { return this.ticked ?? this.attributes.has("checked"); }
  set checked(on: boolean) { this.ticked = on; }
  /** A text box holds what was typed; a list holds the value of the option chosen, or of the one the markup selects. */
  get value(): string {
    if (this.entered !== undefined) return this.entered;
    if (this.localName !== "select") return this.attributes.get("value") ?? "";
    const options = this.querySelectorAll("option");
    return (options.find(option => option.attributes.has("selected")) ?? options[0])?.attributes.get("value") ?? "";
  }
  set value(value: string) { this.entered = value; }

  get textContent(): string { return this.childNodes.map(node => node.textContent).join(""); }
  set textContent(text: string) { this.replaceChildren(text === "" ? [] : [new FakeText(text)]); }
  get innerHTML(): string { return this.childNodes.map(written).join(""); }
  set innerHTML(html: string) {
    this.replaceChildren([]);
    build(this.page, this, html);
  }
  get outerHTML(): string { return written(this); }

  private replaceChildren(nodes: (FakeElement | FakeText)[]): void {
    for (const node of this.childNodes) node.parentElement = null;
    this.childNodes = [];
    this.page.taken();
    this.append(...nodes);
  }
  append(...nodes: (FakeElement | FakeText | string)[]): void {
    for (const given of nodes) {
      const node = typeof given === "string" ? new FakeText(given) : given;
      if (node instanceof FakeElement) node.remove();
      node.parentElement = this;
      this.childNodes.push(node);
    }
  }
  appendChild<T extends FakeElement | FakeText>(node: T): T {
    this.append(node);
    return node;
  }
  remove(): void {
    const parent = this.parentElement;
    if (parent) parent.childNodes = parent.childNodes.filter(node => node !== this);
    this.parentElement = null;
    this.page.taken();
  }

  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  hasAttribute(name: string): boolean { return this.attributes.has(name); }
  setAttribute(name: string, value: string): void { this.attributes.set(name, String(value)); }
  removeAttribute(name: string): void { this.attributes.delete(name); }

  contains(other: unknown): boolean {
    for (let node = other instanceof FakeElement || other instanceof FakeText ? other : null; node; node = node.parentElement) if (node === this) return true;
    return false;
  }
  matches(selector: string): boolean { return readSelector(selector).some(chain => matchesChain(this, chain)); }
  closest(selector: string): FakeElement | null {
    const chains = readSelector(selector);
    for (let node: FakeElement | null = this; node; node = node.parentElement) {
      const candidate = node;
      if (chains.some(chain => matchesChain(candidate, chain))) return candidate;
    }
    return null;
  }
  /** The elements under this one that match, in the order they are written. */
  querySelectorAll(selector: string): FakeElement[] {
    const chains = readSelector(selector);
    const found: FakeElement[] = [];
    const visit = (element: FakeElement) => {
      for (const child of element.children) {
        if (chains.some(chain => matchesChain(child, chain))) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
  querySelector(selector: string): FakeElement | null { return this.querySelectorAll(selector)[0] ?? null; }

  getBoundingClientRect(): Record<"left" | "top" | "right" | "bottom" | "width" | "height", number> {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
  select(): void { /* nothing is laid out, so nothing is selected */ }
  scrollIntoView(): void { this.broughtIntoSight++; }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  /** Sends an event from this element up to the document, as the browser does for a click, a key or typing. The way up
   * is settled before the first listener hears the event, as in a browser: a listener that takes the element off the
   * page does not keep the event from those above it. */
  dispatch(type: string, init: { key?: string } = {}): FakeEvent {
    let stopped = false;
    const event: FakeEvent = {
      type, target: this, ...init, defaultPrevented: false,
      preventDefault() { event.defaultPrevented = true; },
      stopPropagation() { stopped = true; },
    };
    const way: FakeElement[] = [];
    for (let node: FakeElement | null = this; node; node = node.parentElement) way.push(node);
    for (const node of way) {
      if (stopped) break;
      for (const listener of node.listeners.get(type) ?? []) listener(event);
    }
    return event;
  }

  /** Whether the element can take focus now: on the page, shown, enabled, outside anything inert, and a control or an
   * element with a tabindex. */
  get focusable(): boolean {
    if (!FOCUSABLE.has(this.localName) && !this.attributes.has("tabindex") && !this.opensDetails) return false;
    if (this.disabled || !this.isConnected) return false;
    for (let node: FakeElement | null = this; node; node = node.parentElement) if (node.hidden || node.inert) return false;
    return !this.inClosedDetails;
  }
  /** Whether this is the summary of a details element: the one thing of it that is shown while it is closed, which takes
   * the focus and opens and closes it. */
  private get opensDetails(): boolean {
    return this.localName === "summary" && this.parentElement?.localName === "details" && this.parentElement.children.find(child => child.localName === "summary") === this;
  }
  /** Whether the element is inside a details element that is closed, outside its summary: the browser does not show it. */
  get inClosedDetails(): boolean {
    for (let node: FakeElement = this; node.parentElement; node = node.parentElement) {
      if (node.parentElement.localName === "details" && !node.parentElement.attributes.has("open") && !node.opensDetails) return true;
    }
    return false;
  }
  focus(): void { if (this.focusable) this.page.focused = this; }
  /** The script's own click: on a link with a download name it saves the link's address under that name. */
  click(): void {
    this.clicks++;
    if (this.localName === "a" && this.attributes.has("download") && this.isConnected) this.page.downloads.push({ name: this.download, href: this.href });
    this.dispatch("click");
  }

  /* What a user does. A disabled control ignores it; an element the user cannot get at is the test's mistake. A user
   * acts on the page as the browser last drew it. */

  private reach(): void {
    this.page.frame();
    for (let node: FakeElement | null = this; node; node = node.parentElement) {
      if (node.hidden || node.inert) throw new Error(`A user cannot get at <${this.localName}>: <${node.localName}> is ${node.hidden ? "hidden" : "inert"}`);
    }
    if (this.inClosedDetails) throw new Error(`A user cannot get at <${this.localName}>: it is in a closed <details>`);
    if (!this.isConnected) throw new Error(`A user cannot get at <${this.localName}>: it is not on the page`);
  }
  /** A click, or Enter on a focused control: focus goes to the element or to the nearest thing around it that takes focus. */
  press(): void {
    this.reach();
    if (this.disabled) return;
    let taker: FakeElement | null = this;
    while (taker && !taker.focusable) taker = taker.parentElement;
    this.page.focused = taker;
    const event = this.dispatch("click");
    // A click on a summary, or Enter or Space on it, opens or closes its details element, unless the script took the click.
    let summary: FakeElement | null = this;
    while (summary && !summary.opensDetails) summary = summary.parentElement;
    const details = summary?.parentElement;
    if (details && !event.defaultPrevented) {
      if (details.attributes.has("open")) details.attributes.delete("open"); else details.attributes.set("open", "");
    }
  }
  /** Ticks or unticks a checkbox. */
  tick(): void {
    this.reach();
    if (this.disabled) return;
    this.focus();
    this.checked = !this.checked;
    this.dispatch("click");
    this.dispatch("change");
  }
  /** Types into a text box: its whole text becomes `text`. */
  type(text: string): void {
    this.reach();
    this.focus();
    this.value = text;
    this.dispatch("input");
  }
  /** Chooses an option of a list. */
  choose(value: string): void {
    this.reach();
    this.focus();
    this.value = value;
    this.dispatch("change");
  }
}

/** Kinds of element the page's script tells apart with instanceof. */
export class FakeInput extends FakeElement {}
export class FakeSelect extends FakeElement {}

/* ---------- the page ---------- */

export class FakePage {
  /** Above <html>: where the document's own listeners are. */
  readonly root: FakeElement;
  /** The element that has the focus, as Chrome has it (154, measured). One that is taken out of its place has lost it
   * at once (`taken`). One that can no longer hold it, being hidden, disabled, inert or in a closed details element,
   * has it until the browser next draws the page (`frame`). */
  focused: FakeElement | null = null;
  /** What the script saved through a link: the file's name and the address of its content. */
  readonly downloads: { name: string; href: string }[] = [];
  /** The elements the script made itself. */
  readonly created: FakeElement[] = [];
  /** What document.execCommand was asked, and what it answers. */
  readonly commands: string[] = [];
  commandWorks = false;
  readonly document: {
    title: string;
    readonly activeElement: FakeElement;
    readonly documentElement: FakeElement;
    readonly body: FakeElement;
    getElementById(id: string): FakeElement | null;
    querySelector(selector: string): FakeElement | null;
    querySelectorAll(selector: string): FakeElement[];
    createElement(name: string): FakeElement;
    addEventListener(type: string, listener: Listener): void;
    contains(node: unknown): boolean;
    execCommand(command: string): boolean;
  };

  constructor(html: string) {
    const page = this;
    this.root = new FakeElement(this, "#document");
    build(this, this.root, html, true);
    const documentElement = this.find("html");
    const body = this.find("body");
    this.document = {
      title: this.root.querySelector("title")?.textContent ?? "",
      get activeElement() { return page.focused ?? body; },
      documentElement,
      body,
      getElementById: id => this.root.querySelectorAll("[id]").find(element => element.id === id) ?? null,
      querySelector: selector => this.root.querySelector(selector),
      querySelectorAll: selector => this.root.querySelectorAll(selector),
      createElement: name => {
        const element = this.create(name.toLowerCase());
        this.created.push(element);
        return element;
      },
      addEventListener: (type, listener) => this.root.addEventListener(type, listener),
      contains: node => this.root.contains(node) && node !== this.root,
      execCommand: command => {
        this.commands.push(command);
        return this.commandWorks;
      },
    };
  }

  create(name: string): FakeElement {
    return name === "input" ? new FakeInput(this, name) : name === "select" ? new FakeSelect(this, name) : new FakeElement(this, name);
  }

  /** The one element a selector must find. */
  find(selector: string): FakeElement {
    const found = this.root.querySelector(selector);
    if (!found) throw new Error(`Nothing on the page matches ${JSON.stringify(selector)}`);
    return found;
  }
  all(selector: string): FakeElement[] { return this.root.querySelectorAll(selector); }
  has(selector: string): boolean { return this.root.querySelector(selector) !== null; }
  id(id: string): FakeElement { return this.find(`#${id}`); }
  /** The text of each element a selector finds, without the space around it. */
  texts(selector: string): string[] { return this.all(selector).map(element => element.textContent.trim()); }
  /** An element was taken out of its place, to go or to be put elsewhere: the focus that was on it, or inside it, is
   * lost at once, and does not come back with the element. */
  taken(): void { if (this.focused && !this.focused.isConnected) this.focused = null; }
  /** The browser draws the page, which it does once the script's work is done and not before: the focus leaves an
   * element that can no longer hold it, for the body. Until then the document goes on naming that element as the one
   * with the focus: a script that hides what has the focus and then asks where the focus is hears of the hidden
   * element. What is shown again before the page is drawn keeps the focus. */
  frame(): void { if (!this.focused?.focusable) this.focused = null; }
  /** A key pressed where the focus is. */
  key(key: string): FakeEvent {
    this.frame();
    return this.document.activeElement.dispatch("keydown", { key });
  }
}

/** A piece of markup as elements, for a test that reads what a function wrote. */
export function parseMarkup(html: string): FakeElement {
  const page = new FakePage("<html><head></head><body></body></html>");
  page.document.body.innerHTML = html;
  return page.document.body;
}
