import { describe, expect, it } from "vitest";
import { DETAILS_FILE, TAB_FILES } from "../analyse.js";
import { REFRESH, SEND_LOG, UNEXPECTED } from "../progress.js";
import { HEADERS } from "../report.js";
import { BUSY, NOTHING_TO_ANALYSE, UNSENT } from "../tab-port.js";
import { APP_FILES, COLUMN_CHOICES } from "./columns.js";
import { NO_REASON, runLabel, UNREADABLE } from "./connection.js";
import { parseMarkup } from "./dom.test-support.js";
import { noteBannerHtml, overviewHtml, runBannerHtml, runHtml } from "./markup.js";
import { CARD_PARTS } from "./result-view.js";

// The names the results page and the engine share without sharing code: the page knows an app's files by their names,
// and the engine's sentences tell the user to choose controls of the page by theirs. A name changed on one side only
// fails here, instead of a table silently losing its column choices or a sentence pointing at a button that is not there.

describe("The names the results page and the engine know each other by", () => {
  it("knows an app's files by the names the analysis writes them under", () => {
    expect(APP_FILES).toEqual(TAB_FILES);
    expect(Object.keys(APP_FILES)).toEqual(Object.keys(HEADERS));
    // Everything the page keys by a file's name is keyed by one of the engine's: the column choices, and a card's parts.
    const written = Object.values(TAB_FILES);
    expect([...COLUMN_CHOICES.keys()]).toEqual(written);
    expect(CARD_PARTS.map(part => part.file).filter(file => !written.includes(file))).toEqual([]);
    // The Details file is none of them: the page finds it by its mark, and the engine names it apart. (engine.test.ts
    // checks on a real analysis that the file the engine marks is the one it names, and that it comes first.)
    expect([DETAILS_FILE, written.includes(DETAILS_FILE)]).toEqual(["App Details.csv", false]);
  });

  it("has the two controls the engine's sentences tell the user to choose, under the names the sentences use", () => {
    // The sentences: what every failure of a run says to do next.
    const sentences = [UNEXPECTED, UNSENT, BUSY, NOTHING_TO_ANALYSE, SEND_LOG];
    const again = runLabel(true);
    expect(again).toBe("Run again");
    expect([UNEXPECTED, UNSENT, BUSY, NOTHING_TO_ANALYSE].filter(sentence => !new RegExp(`hoose ${again}\\.`).test(sentence))).toEqual([]);
    expect(SEND_LOG).toBe("If it keeps happening, choose Copy diagnostic log and send the log.");
    // No sentence names a control the page does not have: what follows "choose" begins with one of these two names.
    const controls = [again, "Copy diagnostic log"];
    const chosen = sentences.flatMap(sentence => sentence.split(/[Cc]hoose /).slice(1));
    expect(chosen.filter(rest => !controls.some(control => rest.startsWith(control)))).toEqual([]);
    expect(controls.map(control => chosen.filter(rest => rest.startsWith(control)).length)).toEqual([4, 3]);
    // The button that copies a log reads exactly so wherever a failed run or a result shows its log.
    const overview = overviewHtml({ tiles: [], cardTypes: [], models: [], notes: [], about: [], files: [], howToRead: [], log: ["a line"] });
    for (const html of [runHtml(), runBannerHtml(), noteBannerHtml(), overview]) {
      expect(parseMarkup(html).querySelectorAll("button").map(button => button.textContent.trim())).toEqual(["Copy diagnostic log"]);
    }
    // The page's own two failures say what to do in the engine's words.
    expect(UNREADABLE).toBe(`Cardigan received a result it could not read. ${REFRESH}`);
    expect(NO_REASON).toBe(`The analysis stopped without saying why. Choose ${again}. ${SEND_LOG}`);
  });
});
