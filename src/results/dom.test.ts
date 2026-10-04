import { describe, expect, it } from "vitest";
import { FakeInput, FakePage, FakeSelect, parseMarkup } from "./dom.test-support.js";

// The stand-in page the page script's tests run on. These checks are what lets those tests trust it: that it finds what is
// there (so "there is no img" means something), and that it refuses what a browser would have to guess at.
const PAGE = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Stand-in</title></head>
<body>
<!-- a comment -->
<header class="hd"><button id="go" class="btn primary" title="Go">
  <svg width="13" height="13"><path d="M1 1"/></svg>
  Go now
</button></header>
<main id="main"><div id="view" tabindex="-1"></div></main>
<div id="drawer" hidden><button id="close">Close</button></div>
</body>
</html>`;

describe("The stand-in page", () => {
  it("reads a page into elements, with their attributes and their text as the browser shows it", () => {
    const page = new FakePage(PAGE);
    expect(page.document.title).toBe("Stand-in");
    expect([page.document.documentElement.localName, page.document.body.localName]).toEqual(["html", "body"]);
    const go = page.id("go");
    expect([go.tagName, go.title, go.textContent.trim(), go.children.map(child => child.localName)]).toEqual(["BUTTON", "Go", "Go now", ["svg"]]);
    // Its words are a text of their own after the icon, which is what lets a script change the words and keep the icon.
    expect([go.lastChild?.nodeType, go.lastChild?.textContent.trim()]).toEqual([3, "Go now"]);
    expect(page.find("meta").children).toEqual([]);
    expect(page.find("path").attributes.get("d")).toBe("M1 1");
    expect(page.document.getElementById("nothing")).toBeNull();
    expect(() => page.find("#nothing")).toThrow("Nothing on the page matches");
  });

  it("writes markup into an element as elements, and text as text", () => {
    const page = new FakePage(PAGE);
    const view = page.id("view");
    view.innerHTML = '<p class="a b" title="x &amp; &quot;y&quot;">1 &lt; 2 &amp;&amp; <em>ok</em></p><input type="search" value="typed"><select><option value="25">25</option><option value="50" selected>50</option></select>';
    expect(view.children.map(child => child.localName)).toEqual(["p", "input", "select"]);
    expect([page.find("p").textContent, page.find("p").title]).toEqual(["1 < 2 && ok", "x & \"y\""]);
    expect([page.find("input") instanceof FakeInput, page.find("select") instanceof FakeSelect, page.find("p") instanceof FakeInput]).toEqual([true, true, false]);
    expect([page.find("input").value, page.find("select").value]).toEqual(["typed", "50"]);
    // Text set as text is never an element, whatever it holds; the same text written as markup is one.
    view.textContent = '<img src="x" onerror="alert(1)">';
    expect([view.children.length, view.textContent, page.has("img")]).toEqual([0, '<img src="x" onerror="alert(1)">', false]);
    expect(view.innerHTML).toBe('&lt;img src="x" onerror="alert(1)"&gt;');
    view.innerHTML = '<img src="x" onerror="alert(1)">';
    expect([page.has("img"), page.find("img").attributes.get("onerror"), view.textContent]).toEqual([true, "alert(1)", ""]);
    // What was there before is no longer on the page.
    expect(page.has("p")).toBe(false);
  });

  it("refuses markup a browser would have to guess at", () => {
    const view = new FakePage(PAGE).id("view");
    for (const [html, problem] of [
      ["<div><span>text</div>", "</div> ends no <div>: <span> is open"],
      ["<div>text", "<div> is not ended"],
      ["text</div>", "</div> ends no <div>"],
      ["<img src=x onerror=alert(1)>", "The value of src is not in double quotes"],
      ["a < b", "A \"<\" that starts no tag"],
      ["<!-- comment -->", "A \"<\" that starts no tag"],
    ]) expect(() => { view.innerHTML = html; }, html).toThrow(problem);
  });

  it("finds elements by the selectors the page's script uses, and by no other", () => {
    const body = parseMarkup(`<div id="tableWrap"><table><thead><tr><th><button class="th-sort" data-sort="0">A</button>
      <button class="th-filter active" data-colfilter="0" aria-label="Filter by A">f</button></th></tr></thead>
      <tbody><tr><td><button class="link" data-act="page">One</button></td><td>x</td></tr><tr><td><span class="cell-t">Two</span></td><td>y</td></tr></tbody></table></div>
      <div class="pager"><button class="pg-btn" data-page="1" aria-label="Next page">n</button><span class="pg-btn">not a button</span><select id="pageSize"></select></div>`);
    const texts = (selector: string) => body.querySelectorAll(selector).map(element => element.textContent.trim());
    expect(texts("button")).toEqual(["A", "f", "One", "n"]);
    expect(texts("#tableWrap tbody tr")).toEqual(["Onex", "Twoy"]);
    expect(texts("tbody td .link, .cell-t")).toEqual(["One", "Two"]);
    expect(texts(".pg-btn[data-page]")).toEqual(["n"]);
    expect(texts('.pg-btn[aria-label="Next page"]')).toEqual(["n"]);
    expect(texts("[data-colfilter], #pageSize")).toEqual(["f", ""]);
    expect(texts('[data-sort="0"]')).toEqual(["A"]);
    expect(texts('[data-sort="1"]')).toEqual([]);
    expect(texts(".th-filter.active")).toEqual(["f"]);
    expect(texts("thead .link")).toEqual([]);
    const link = body.querySelector(".link");
    expect(link?.closest("#tableWrap tbody tr")?.textContent).toBe("Onex");
    expect([link?.closest("button, a, input")?.localName, link?.closest("thead"), link?.matches("td .link"), link?.matches("th .link")]).toEqual(["button", null, true, false]);
    // A row's place among its table's rows is its place in the markup.
    const rows = body.querySelectorAll("tbody tr");
    expect(rows.map(row => row.parentElement?.children.indexOf(row))).toEqual([0, 1]);
    for (const unknown of ["td > .link", "tr:first-child", "*", "td + td", "[data-act^=p]"]) expect(() => body.querySelector(unknown), unknown).toThrow("does not know the selector");
  });

  it("sends an event from the element up to the document, unless a listener stops it", () => {
    const page = new FakePage(PAGE);
    const heard: string[] = [];
    page.document.addEventListener("click", event => heard.push(`document: ${event.target.id}`));
    page.find("header").addEventListener("click", () => heard.push("header"));
    page.id("go").addEventListener("click", () => heard.push("button"));
    page.find("svg").press();
    expect(heard).toEqual(["button", "header", "document: "]);
    heard.length = 0;
    page.id("view").addEventListener("click", event => { heard.push("view"); event.stopPropagation(); });
    page.id("view").press();
    expect(heard).toEqual(["view"]);
    // A key goes to where the focus is, and a listener can prevent what the browser would do with it.
    page.document.addEventListener("keydown", event => { if (event.key === "/") event.preventDefault(); });
    expect([page.key("/").defaultPrevented, page.key("a").defaultPrevented, page.key("/").target.id]).toEqual([true, false, "view"]);
  });

  it("gives focus only to what can take it: a control or a tabindex, shown, enabled, on the page and not inert", () => {
    const page = new FakePage(PAGE);
    const { document } = page;
    expect(document.activeElement).toBe(document.body);
    page.id("go").focus();
    expect(document.activeElement.id).toBe("go");
    // Neither a plain element nor a control inside something hidden takes focus.
    page.find("header").focus();
    page.id("close").focus();
    expect(document.activeElement.id).toBe("go");
    page.id("drawer").hidden = false;
    page.id("close").focus();
    expect(document.activeElement.id).toBe("close");
    // A click gives focus to what was clicked, or to the nearest thing around it that takes focus, or to nothing.
    page.id("view").innerHTML = "<p>text</p>";
    page.find("p").press();
    expect(document.activeElement.id).toBe("view");
    page.find("header").press();
    expect(document.activeElement).toBe(document.body);
    // Focus does not stay on an element that goes away, is hidden, or ends up inside something inert.
    page.id("go").focus();
    page.find("header").inert = true;
    expect(document.activeElement).toBe(document.body);
    page.find("header").inert = false;
    page.id("go").focus();
    page.id("go").disabled = true;
    page.id("go").press();
    page.id("go").focus();
    expect(document.activeElement).toBe(document.body);
    page.id("close").focus();
    const close = page.id("close");
    close.remove();
    expect([document.activeElement, document.contains(page.id("drawer")), page.has("#close")]).toEqual([document.body, true, false]);
    // What a user cannot get at, a test cannot click either: something hidden, inert or no longer on the page.
    page.id("drawer").hidden = true;
    page.find("main").inert = true;
    expect(() => page.id("drawer").press()).toThrow("A user cannot get at <div>: <div> is hidden");
    expect(() => page.id("view").type("x")).toThrow("A user cannot get at <div>: <main> is inert");
    expect(() => close.press()).toThrow("A user cannot get at <button>: it is not on the page");
  });

  it("types, chooses and ticks as a user does, and saves what the script's own click on a link saves", () => {
    const page = new FakePage(PAGE);
    const heard: string[] = [];
    for (const type of ["input", "change", "click"]) page.document.addEventListener(type, event => heard.push(`${type} ${event.target.localName}`));
    page.id("view").innerHTML = '<input id="box" type="search" value=""><select id="size"><option value="25">25</option></select><input id="tick" type="checkbox" checked>';
    page.id("box").type("sal");
    page.id("size").choose("100");
    page.id("tick").tick();
    expect([page.id("box").value, page.id("size").value, page.id("tick").checked, page.document.activeElement.id]).toEqual(["sal", "100", false, "tick"]);
    expect(heard).toEqual(["input input", "change select", "click input", "change input"]);
    const link = page.document.createElement("a");
    link.href = "blob:1";
    link.download = "a.csv";
    link.click();
    expect(page.downloads).toEqual([]);
    page.document.body.appendChild(link);
    link.click();
    link.remove();
    expect([page.downloads, link.clicks, page.created]).toEqual([[{ name: "a.csv", href: "blob:1" }], 2, [link]]);
  });
});
