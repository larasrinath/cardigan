# Chrome Web Store listing

Everything to paste into the Chrome Web Store Developer Dashboard, in the dashboard's tab order. Each field is under its name; copy what is in its box. The package is the release zip that `npm run package` makes, `release/cardigan-<version>.zip`, the same file as the GitHub release.

**Submitted** for review on 17 October 2026: version 0.45.4, Unlisted, non-trader, with the text below as it is.

**Contents:** [Store listing](#store-listing) · [Privacy practices](#privacy-practices) · [Distribution](#distribution) · [Test instructions](#test-instructions) · [Before submitting](#before-submitting) · [After approval](#after-approval)

## Store listing

### Title

Taken from the package's manifest: **Cardigan**.

### Summary

Taken from the package: the manifest's `description`, as it is. It is 124 characters; the limit is 132.

```text
Read-only look inside any Anaplan model or app: searchable tables and an interactive model map. Nothing leaves your browser.
```

### Description

```text
Cardigan shows how an Anaplan model or app is built, as searchable tables and an interactive model map.

Open a model in Model Building, or a page of an app, and click Cardigan's icon. A results tab opens beside it with:
- an Overview of the model: table counts, the model calendar, and what was read
- tables of the model's modules, line items, lists, versions, saved views, imports and their mappings, processes, exports and Dynamic Cell Access drivers, each with search, filters and a details panel
- the line items and modules nothing seems to use, each with why
- where the model's published pages use its modules, saved views, filters and actions
- a Model map of how groups, modules and line items connect
- for an app: its pages, cards, filters, conditional formatting and action buttons

Cardigan only reads. It changes nothing in your models or apps and runs no model actions. It reads through the tab you clicked, with your own signed-in Anaplan session, and does all its work in your browser. Nothing it reads leaves your browser: its only requests are those reads to Anaplan. There is no Cardigan server, and no analytics, telemetry or ads.

You need an Anaplan account that can open the model or app. Cardigan works in Model Building and on app pages, and reads Classic and Polaris models alike.

Cardigan is an independent project. It is not affiliated with, endorsed by or supported by Anaplan.

Source code, help and privacy policy: https://github.com/larasrinath/cardigan
```

### Category

**Developer Tools** (recommended): its users are Anaplan model builders checking how a model is built. **Productivity** is the alternative, if the listing should speak to planners more than builders.

### Language

**English**

### Graphic assets

All in [`docs/store/images/`](images/). Every model, name and number in the pictures is invented.

| Field | File | Size |
| --- | --- | --- |
| Store icon | `store-icon.png`: the logo with a faint cream edge, so that it reads on dark backgrounds too | 128 × 128, the logo 96 × 96 with 16 transparent pixels on each side |
| Screenshot 1 | `screenshot-1.png`: the Overview, light | 1280 × 800 |
| Screenshot 2 | `screenshot-2.png`: Line Items with a line item's details open, dark | 1280 × 800 |
| Screenshot 3 | `screenshot-3.png`: File Imports with an import's Mapping, light | 1280 × 800 |
| Screenshot 4 | `screenshot-4.png`: the Model map with a module's details, dark | 1280 × 800 |
| Screenshot 5 | `screenshot-5.png`: Saved Views with a view's filters, light | 1280 × 800 |
| Small promo tile | `promo-small.png` | 440 × 280 |
| Marquee promo tile | `promo-marquee.png` (optional) | 1400 × 560 |

Upload the screenshots in that order.

### Homepage URL

```text
https://github.com/larasrinath/cardigan
```

### Support URL

```text
https://github.com/larasrinath/cardigan/issues
```

## Privacy practices

### Single purpose

```text
Cardigan shows how the Anaplan model or app open in the current tab is built, as read-only searchable tables and a model map. It reads that model or app with the user's own Anaplan session and changes nothing.
```

### Permission justification

**activeTab**

```text
Used when you click Cardigan's toolbar icon, for the tab you clicked and no other. On an Anaplan tab that was open before Cardigan was installed or updated, Chrome has not loaded Cardigan's content script, and activeTab lets Cardigan add it to that one tab. On a tab that is not Anaplan, Cardigan reads only the tab's site address, to tell you that Cardigan works on Anaplan tabs, and does nothing more.
```

**contextMenus**

```text
Adds two items to the menu of Cardigan's own toolbar icon: About Cardigan, which opens Cardigan's About page, and the version, greyed out. Nothing is added to any other menu or to any page.
```

**scripting**

```text
Used with activeTab, in the tab you clicked the icon on. It adds Cardigan's own packaged scripts to that Anaplan tab when Chrome has not loaded them there, as after an install or update: the content script, and the model reader where a model's frame still holds an earlier version's. It also reads a clicked tab's site address, to check that the tab is Anaplan before adding anything. Only files from the package are added.
```

### Host permission justification

The dashboard lists the content scripts' sites as a host permission and asks for this, in at most 1,000 characters (this is 904):

```text
Cardigan's two content scripts load only on https://*.app.anaplan.com/* and https://*.app2.anaplan.com/*, Anaplan's own pages, so that they are ready when you click Cardigan's icon. They show nothing and send nothing until you start a run.

dist/content.js runs in the isolated world. It reads the app's or model's definitions with your own session: GET requests to Anaplan's services and read-only subscriptions on Anaplan's model data connection.

dist/model-export.js runs in the page's main world in each Anaplan frame, because a model's settings can be read in full only through the Model Building client the Anaplan page loads for itself. It sends only view requests, each checked before it is sent; edits, saves and model actions are refused. Its messages go only to the top window of the same Anaplan tab, addressed to that page's Anaplan origin.

Everything Cardigan reads stays in your browser.
```

### Remote code

Choose **No, I am not using remote code**. Its justification box then stays greyed out; this text is for a reviewer who asks:

```text
Cardigan runs only the JavaScript in its package: five bundles under dist/, built from the source on GitHub and not minified. It fetches no code, and evaluates no text as code (no eval, no new Function). The content security policy of its pages lets them load only the package's own files. On a Model Building page, the model reader calls the Model Building client that the Anaplan page loads for itself; that client is Anaplan's own page code, not Cardigan's.
```

### Data usage

**What to tick**

- **Website content: tick it.** Cardigan reads the definitions of the Anaplan model or app in the tab you click it on: the names of modules, line items, lists, pages and actions, their formulas, the list items their filters name, and notes. It processes them in your browser and keeps the last result in that tab's session storage. Website content counts even though nothing is sent anywhere.
- **Personally identifiable information: tick it.** Cardigan does not ask for or look for personal information, but a model's definitions can hold people's names or email addresses:
  - list items named after people, such as employees or sales reps, where a filter, a page selection or an import's mapping names them;
  - items of Anaplan's Users list, which are users' names or email addresses, where a page, a filter or a saved view names a particular user;
  - notes written in the model.

  Cardigan shows these, keeps them in the tab's session storage with the result, and sends them nowhere. It is the honest answer for models whose lists name people.
- **Authentication information: do not tick it.** Cardigan never sees, asks for or stores a password. The browser sends Anaplan's session cookies with Cardigan's reads, as with any Anaplan page. To read as Anaplan's own pages do, Cardigan reads Anaplan's anti-forgery token from Anaplan's `XSRF-TOKEN` cookie and sends it back to the same Anaplan site in a request header, as NOTICE.md says. It never stores, logs or sends the token anywhere else. A reviewer reading `dist/content.js` will see `document.cookie`; this is why.
- **Do not tick the others:**
  - Health information, Financial and payment information, Personal communications, Location: Cardigan handles none.
  - Web history: Cardigan keeps no list of pages visited. It reads the Anaplan tab's address to know which app or model to read, and keeps a model's site and customer ID with its result.
  - User activity: Cardigan monitors no clicks, keystrokes or network traffic on websites. Its results page keeps its own searches and filters for a refresh.

**Certifications: tick all three.** Each is true of Cardigan, which sends nothing to its author or to anyone else:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

### Privacy policy URL

```text
https://github.com/larasrinath/cardigan/blob/main/PRIVACY.md
```

## Distribution

- **Payments:** free.
- **Visibility:** **Unlisted** first, so that only people with the link can install it. Make it **Public** once the owner has tested the store's build (see [After approval](#after-approval)).
- **Regions:** all regions.

## Test instructions

**Username** and **Password:** leave both empty.

**Additional instructions:** at most 500 characters (this is 484):

```text
Cardigan needs an Anaplan account; none can be shared, as accounts belong to a company's tenant. Use: open an Anaplan model or app page, click the icon; a results tab reads it with the user's session and changes nothing. Without Anaplan, click the icon on https://example.com: the tab says "Not an Anaplan tab" (expected). Screenshots on invented data: https://github.com/larasrinath/cardigan/tree/main/docs/store/images. Source (not minified): https://github.com/larasrinath/cardigan
```

## Before submitting

- **Contact email:** the publisher's contact email must be entered and verified on the dashboard's **Settings** page, or the item cannot be submitted.
- **Official URL:** leave it as **None**; it needs a site verified in Google Search Console.
- **Verified CRX uploads** (Package): leave it off for now; every later upload would have to be signed with a private key.
- **Publish automatically after review:** ticked, with the visibility Unlisted.

## After approval

1. Install Cardigan from its store link.
2. Turn off the unpacked copy in `chrome://extensions`: both would run on Anaplan tabs.
3. Run the store's Cardigan on a model, and check the Overview, a table, the Model map and the version under **About Cardigan**.
4. Make it **Public**.
