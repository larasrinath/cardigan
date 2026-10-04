/** Reads markup the way a browser finds its tags, so a test can say exactly which elements and attributes a piece of
 * generated markup holds. Tests only.
 *
 * It is strict on purpose. The page writes every attribute value in double quotes and escapes every value that comes
 * from a result, so in what it generates a "<" can only start one of its own tags and a quote can only end one of its own
 * attributes. Anything else (a "<" that starts no tag, a value without double quotes, an attribute twice, a tag that does
 * not end) is an error here instead of a guess, and so fails the test that reads it. */

export interface Tag {
  name: string;
  closing: boolean;
  /** Written as <name ... />: an element that holds nothing. */
  selfClosing: boolean;
  /** Each attribute with its value as written, still escaped; undefined for an attribute without a value. */
  attributes: Map<string, string | undefined>;
}
export interface Markup {
  tags: Tag[];
  /** The text between the tags, as written, still escaped. */
  texts: string[];
  /** The tags and the texts between them, in the order they are written. */
  parts: (Tag | string)[];
}

const TAG_NAME = /[A-Za-z][A-Za-z0-9-]*/y;
const ATTRIBUTE_NAME = /[^\s"'<>/=]+/y;

/** `page` also allows what a whole document has and generated markup never does: a doctype and comments. */
export function readMarkup(html: string, page = false): Markup {
  const tags: Tag[] = [];
  const texts: string[] = [];
  const parts: (Tag | string)[] = [];
  const near = (at: number) => JSON.stringify(html.slice(Math.max(0, at - 20), at + 40));
  let index = 0;
  while (index < html.length) {
    const open = html.indexOf("<", index);
    const text = html.slice(index, open < 0 ? html.length : open);
    if (text) {
      texts.push(text);
      parts.push(text);
    }
    if (open < 0) break;
    if (page && html.startsWith("<!--", open)) {
      const end = html.indexOf("-->", open);
      if (end < 0) throw new Error(`A comment that does not end, near ${near(open)}`);
      index = end + 3;
      continue;
    }
    if (page && /^<!doctype html>/i.test(html.slice(open, open + 15))) {
      index = open + 15;
      continue;
    }
    let at = open + 1;
    const closing = html[at] === "/";
    if (closing) at++;
    TAG_NAME.lastIndex = at;
    const name = TAG_NAME.exec(html)?.[0];
    if (!name) throw new Error(`A "<" that starts no tag, near ${near(open)}`);
    at += name.length;
    const attributes = new Map<string, string | undefined>();
    let selfClosing = false;
    for (;;) {
      while (at < html.length && /\s/.test(html[at])) at++;
      if (at >= html.length) throw new Error(`A tag that does not end, near ${near(open)}`);
      if (html[at] === ">") { at++; break; }
      if (html[at] === "/" && html[at + 1] === ">") { at += 2; selfClosing = true; break; }
      ATTRIBUTE_NAME.lastIndex = at;
      const attribute = ATTRIBUTE_NAME.exec(html)?.[0];
      if (!attribute) throw new Error(`An unexpected character in a tag, near ${near(at)}`);
      if (attributes.has(attribute)) throw new Error(`The attribute ${attribute} twice in one tag, near ${near(at)}`);
      at += attribute.length;
      if (html[at] !== "=") {
        attributes.set(attribute, undefined);
        continue;
      }
      if (html[at + 1] !== "\"") throw new Error(`The value of ${attribute} is not in double quotes, near ${near(at)}`);
      const end = html.indexOf("\"", at + 2);
      if (end < 0) throw new Error(`The value of ${attribute} does not end, near ${near(at)}`);
      attributes.set(attribute, html.slice(at + 2, end));
      at = end + 1;
    }
    const tag: Tag = { name: name.toLowerCase(), closing, selfClosing, attributes };
    tags.push(tag);
    parts.push(tag);
    index = at;
  }
  return { tags, texts, parts };
}

/** The elements and attribute names of a piece of markup, in order, without any value or text: what the data must not be
 * able to change. */
export function structure(html: string): string[] {
  return readMarkup(html).tags.map(tag => (tag.closing ? `/${tag.name}` : `${tag.name}(${[...tag.attributes.keys()].join(",")})`));
}

/** Escaped text as the browser shows it. */
export function decode(text: string): string {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

/** Everything a piece of markup shows or holds as a value: its texts and its attribute values, as the browser reads them. */
export function shownValues(html: string): string[] {
  const { tags, texts } = readMarkup(html);
  return [...texts.map(decode), ...tags.flatMap(tag => [...tag.attributes.values()].flatMap(value => (value === undefined ? [] : [decode(value)])))];
}
