import type { FakePage } from "./dom.test-support.js";

/** What holds the results page to making no file and naming none, for the page's own tests. Tests only.
 *
 * The page shows a result and nothing else: it makes no file of it, starts no download and sends its tab nowhere. A test
 * of the page runs in Node, where a script can make a blob and an address for one without anything being seen of it, and
 * where the page's address is a plain object that takes whatever is written to it. So a suite watches for that from
 * before each of its tests to after it (`watchForFiles`), and what was used fails the test.
 *
 * And no word the page has for its user names a file, a CSV or a zip, or a download (`fileWords`). */

/** An address that is a file's own bytes, or stands for them: what a page is sent to, or given a link to, to save them. */
const A_FILE = /^\s*(?:blob|data|filesystem):/i;

export interface FileWatch {
  /** The page's address for a test: it holds what the test gives it and takes what is written to it, as the plain object
   * does, and it tells of a script that sends the page to a file. */
  location<T extends object>(address: T): T;
  /** Ends the watch and puts back what it stood in for. It gives what was used since the watch began, each named as a
   * script writes it, with what the page given holds at the end that saves a file: an element with a `download`
   * attribute, or with an address that is a file. Nothing of it is the results page's to use. */
  stop(page?: FakePage): string[];
}

/** Watches, from now until `stop`, for what a page makes a file with or starts a download by: a blob or a file made,
 * an address made for one, and the page sent to an address that is a file. */
export function watchForFiles(): FileWatch {
  const used: string[] = [];
  const globals = globalThis as unknown as Record<string, unknown>;
  const before = { Blob: globals.Blob, File: globals.File, createObjectURL: URL.createObjectURL };
  const goes = (how: string, address: unknown): void => {
    if (typeof address === "string" && A_FILE.test(address)) used.push(`${how} ${address.trim().slice(0, 40)}`);
  };
  let watched: object | undefined;
  for (const name of ["Blob", "File"] as const) globals[name] = class { constructor() { used.push(`new ${name}`); } };
  URL.createObjectURL = () => {
    used.push("URL.createObjectURL");
    return "blob:watched";
  };
  return {
    location: address => {
      const page = new Proxy(address, {
        get: (target, key, receiver) => (key === "assign" || key === "replace" ? (to: unknown) => goes(`location.${key}`, to) : Reflect.get(target, key, receiver) as unknown),
        set: (target, key, value: unknown, receiver) => {
          if (key === "href") goes("location.href =", value);
          return Reflect.set(target, key, value, receiver);
        },
      });
      watched = page;
      return page;
    },
    stop: page => {
      // A script that writes over the page's address itself, and not into it, leaves another thing in its place.
      if (watched && globals.location !== watched) goes("location =", globals.location);
      globals.Blob = before.Blob;
      globals.File = before.File;
      URL.createObjectURL = before.createObjectURL;
      for (const element of page?.elements() ?? []) {
        if (element.attributes.has("download")) used.push(`<${element.localName} download>`);
        for (const name of ["href", "src"]) goes(`<${element.localName} ${name}>`, element.attributes.get(name));
      }
      return used;
    },
  };
}

/** Each place where one of the texts names a file, a CSV or a zip, or a download, with the words around it. `theirs`
 * is what the app or the model itself says and the page shows as it was read, such as the name of the file an import
 * reads: it is taken out first, so that what is left is the page's own words. */
export function fileWords(texts: readonly string[], theirs?: RegExp): string[] {
  return texts.flatMap(text => (theirs ? text.replace(theirs, "") : text).match(/.{0,40}(?:\.csv|\bcsv\b|\bzip\b|download|\bfiles?\b).{0,40}/gi) ?? []);
}
