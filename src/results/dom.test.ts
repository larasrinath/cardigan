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
    // The way up is settled before the first listener hears the event, as in a browser: a listener that takes the element
    // off the page does not keep the event from those above it, which hear it with an element that is no longer there.
    heard.length = 0;
    const header = page.find("header");
    page.document.addEventListener("click", event => heard.push(`on the page: ${event.target.isConnected}`));
    page.id("go").addEventListener("click", () => { header.innerHTML = ""; });
    page.id("go").press();
    expect(heard).toEqual(["button", "header", "document: go", "on the page: false"]);
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
    // What a user cannot get at, a test cannot click either: something hidden, inert or no longer on the page.
    const close = page.id("close");
    close.remove();
    expect([document.contains(page.id("drawer")), page.has("#close")]).toEqual([true, false]);
    page.id("drawer").hidden = true;
    page.find("main").inert = true;
    expect(() => page.id("drawer").press()).toThrow("A user cannot get at <div>: <div> is hidden");
    expect(() => page.id("view").type("x")).toThrow("A user cannot get at <div>: <main> is inert");
    expect(() => close.press()).toThrow("A user cannot get at <button>: it is not on the page");
  });

  it("names the element with the focus as Chrome does: one that can no longer hold it until the page is next drawn, one that is taken out of its place no longer", () => {
    const page = new FakePage(PAGE);
    const { document } = page;
    page.id("drawer").hidden = false;
    // An element that can no longer hold the focus, being hidden, disabled or inside something inert, is still named as
    // the one with the focus while the script works on, as Chrome names it. The focus falls to the body when the browser
    // next draws the page, and not while a script asks where it is.
    const header = page.find("header");
    page.id("go").focus();
    header.hidden = true;
    expect([document.activeElement.id, header.contains(document.activeElement), page.id("go").focusable]).toEqual(["go", true, false]);
    // Another element takes the focus meanwhile, and the hidden one does not take it back.
    page.id("view").focus();
    page.id("go").focus();
    expect(document.activeElement.id).toBe("view");
    header.hidden = false;
    page.id("go").focus();
    header.inert = true;
    expect(document.activeElement.id).toBe("go");
    page.frame();
    expect(document.activeElement).toBe(document.body);
    // The focus does not come back when the element can hold it again.
    header.inert = false;
    expect(document.activeElement).toBe(document.body);
    // What is hidden and shown again before the page is drawn keeps the focus.
    page.id("go").focus();
    header.hidden = true;
    header.hidden = false;
    page.frame();
    expect(document.activeElement.id).toBe("go");
    // A user acts on the page as it was last drawn: a key goes to the body once the control with the focus is disabled,
    // and a press on that control does nothing.
    page.id("go").disabled = true;
    expect(document.activeElement.id).toBe("go");
    expect(page.key("a").target).toBe(document.body);
    page.id("go").focus();
    page.id("go").press();
    page.id("go").focus();
    expect(document.activeElement).toBe(document.body);
    // What a details element holds is the same, once the element is closed.
    page.id("view").innerHTML = '<details id="more" open><summary>More</summary><button id="inner">Inner</button></details>';
    page.id("inner").focus();
    page.id("more").removeAttribute("open");
    expect([document.activeElement.id, page.id("inner").focusable]).toEqual(["inner", false]);
    page.frame();
    expect(document.activeElement).toBe(document.body);
    // An element that is taken off the page loses the focus at once, and so does one that is put elsewhere on it.
    // The focus does not come back with the element.
    const close = page.id("close");
    close.focus();
    expect(document.activeElement.id).toBe("close");
    close.remove();
    expect([document.activeElement, page.has("#close")]).toEqual([document.body, false]);
    page.id("drawer").append(close);
    expect([page.has("#close"), document.activeElement]).toEqual([true, document.body]);
    close.focus();
    page.id("view").append(close);
    expect([page.id("view").contains(close), close.focusable, document.activeElement]).toEqual([true, true, document.body]);
    close.focus();
    page.id("view").innerHTML = "";
    expect([document.activeElement, close.isConnected]).toEqual([document.body, false]);
  });

  it("shows of a closed details element only its summary, which takes the focus and opens and closes it", () => {
    const page = new FakePage(PAGE);
    page.id("view").innerHTML = '<details id="more"><summary id="sum"><h2 id="head">More</h2></summary><div><button id="inner">Inner</button></div><summary id="second">Not a summary</summary></details>'
      + '<details id="shown" open><summary>Shown</summary><button id="open">Open</button></details><summary id="stray">No details</summary>';
    const { document } = page;
    const [more, sum, inner] = [page.id("more"), page.id("sum"), page.id("inner")];
    // Closed: the first summary is in sight and takes the focus; nothing else of the element does, a second summary neither.
    expect([sum.focusable, sum.inClosedDetails, page.id("head").inClosedDetails, inner.focusable, inner.inClosedDetails, page.id("second").focusable]).toEqual([true, false, false, false, true, false]);
    expect(() => inner.press()).toThrow("A user cannot get at <button>: it is in a closed <details>");
    inner.focus();
    expect(document.activeElement.id).not.toBe("inner");
    // A click on the summary, on what stands in it, or Enter on it while it has the focus, opens the element; again, and it closes.
    page.id("head").press();
    expect([more.hasAttribute("open"), document.activeElement.id, inner.focusable]).toEqual([true, "sum", true]);
    inner.press();
    expect([document.activeElement.id, more.hasAttribute("open")]).toEqual(["inner", true]);
    sum.press();
    expect([more.hasAttribute("open"), inner.focusable, document.activeElement.id === "inner"]).toEqual([false, false, false]);
    // A script that takes the click keeps the element as it is.
    sum.addEventListener("click", event => event.preventDefault());
    sum.press();
    expect(more.hasAttribute("open")).toBe(false);
    // An element that is open shows what it holds; a summary outside a details element is no control.
    expect([page.id("open").focusable, page.id("stray").focusable, page.id("shown").hasAttribute("open")]).toEqual([true, false, true]);
    page.id("open").press();
    expect(page.id("shown").hasAttribute("open")).toBe(true);
  });

  it("types, chooses and ticks as a user does, and keeps the elements the script makes itself", () => {
    const page = new FakePage(PAGE);
    const heard: string[] = [];
    for (const type of ["input", "change", "click"]) page.document.addEventListener(type, event => heard.push(`${type} ${event.target.localName}`));
    page.id("view").innerHTML = '<input id="box" type="search" value=""><select id="size"><option value="25">25</option></select><input id="tick" type="checkbox" checked>';
    page.id("box").type("sal");
    page.id("size").choose("100");
    page.id("tick").tick();
    expect([page.id("box").value, page.id("size").value, page.id("tick").checked, page.document.activeElement.id]).toEqual(["sal", "100", false, "tick"]);
    expect(heard).toEqual(["input input", "change select", "click input", "change input"]);
    // An element the script makes is among those it made, also once it is taken off the page again.
    const area = page.document.createElement("textarea");
    page.document.body.appendChild(area);
    area.remove();
    expect([page.created, area.isConnected]).toEqual([[area], false]);
  });
});
