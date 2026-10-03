# Notice

Cardigan (the **Anaplan Analyzer** Chrome extension) is an independent project. It is **not affiliated with, endorsed by or supported by Anaplan, Inc.** "Anaplan" is used only to say which service the extension reads.

- **Internal services.** The extension reads Anaplan's internal page services: the page and app definition service, Page Builder's model data socket, the actions service, and the classic Model Building client inside the page. These are not public, documented APIs. Anaplan can change them without notice, and the extension can then stop working or export incomplete results.
- **Read-only by construction.** REST reads are GET-only and limited to the services it reads. The socket client refuses to send anything except subscribe, unsubscribe and `update-subscription` frames. The model export checks that every request carries no changes before sending it. Tests pin each of these rules.
- **Reading can load a model.** Reading a model's names subscribes to that model, which can make Anaplan load it, as opening one of its pages would.
- **Nothing leaves the browser** except those reads to Anaplan, made with your own signed-in session. The CSV files and zips are built in the browser and saved as local downloads. There is no server, analytics or telemetry.
- **Your responsibility.** Use it only on apps and models you are allowed to read, and handle the exported files as you would the model itself.
- **No warranty.** It is provided as is, without warranty of any kind, under the [MIT licence](LICENSE).
