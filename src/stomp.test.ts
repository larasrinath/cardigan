import { afterEach, describe, expect, it, vi } from "vitest";
import { ANAPLAN_HOSTS, OTHER_HOSTS } from "./guards.test-support.js";
import { assertReadOnly, decodeFrames, encodeFrame, StompConnection, StompError } from "./stomp.js";

type Listener = (event: { data?: unknown; code?: number; reason?: string }) => void;

/** A stand-in for the browser WebSocket: records what the client sends and lets a test play server frames. */
class FakeSocket {
  static readonly OPEN = 1;
  static last: FakeSocket | undefined;
  readyState = 0;
  binaryType = "blob";
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, Listener[]>();
  constructor(readonly url: string) {
    FakeSocket.last = this;
    queueMicrotask(() => { this.readyState = 1; this.emit("open", {}); });
  }
  addEventListener(type: string, listener: Listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  send(data: string) { this.sent.push(data); }
  close(code = 1000, reason = "") { if (this.readyState === 3) return; this.readyState = 3; this.emit("close", { code, reason }); }
  emit(type: string, event: { data?: unknown; code?: number; reason?: string }) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
  serve(frame: string) { this.emit("message", { data: frame }); }
  frames() { return this.sent.flatMap(text => decodeFrames(text).frames); }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const log = () => undefined;

async function connected(onLog: (line: string) => void = log): Promise<[StompConnection, FakeSocket]> {
  const opening = StompConnection.open("wss://host.example/ws", { "anaplan-customer": "customer-1" }, onLog);
  await flush();
  FakeSocket.last!.serve("CONNECTED\nversion:1.2\nserver:test\n\n\0");
  return [await opening, FakeSocket.last!];
}

describe("Page analyzer socket client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("refuses every frame or action that could change model data", () => {
    expect(() => encodeFrame({ command: "SEND", headers: { destination: "core://w:m/x", "action-type": "SUBMIT_VALUE" }, body: "{}" }, true))
      .toThrow(/update-subscription/);
    for (const action of ["CHANGE_PARENT", "DELETE_ITEM", undefined]) {
      expect(() => assertReadOnly({ command: "SEND", headers: action ? { "action-type": action } : {}, body: "" })).toThrow();
    }
    for (const command of ["ACK", "NACK", "BEGIN", "COMMIT", "ABORT", "MESSAGE", "send"]) {
      expect(() => assertReadOnly({ command, headers: {}, body: "" })).toThrow();
    }
    expect(() => assertReadOnly({ command: "SEND", headers: { "action-type": "update-subscription" }, body: "{}" })).not.toThrow();
  });

  it("escapes header colons once STOMP 1.2 is agreed, never in CONNECT, and sizes bodies in bytes", () => {
    expect(encodeFrame({ command: "SUBSCRIBE", headers: { id: "json-1", destination: "core://ws:model/lists" }, body: "" }, true))
      .toBe("SUBSCRIBE\nid:json-1\ndestination:core\\c//ws\\cmodel/lists\n\n\0");
    expect(encodeFrame({ command: "SUBSCRIBE", headers: { destination: "core://ws:model/lists" }, body: "" }, false)).toContain("destination:core://ws:model/lists\n");
    expect(encodeFrame({ command: "CONNECT", headers: { "accept-version": "1.2", host: "a:b" }, body: "" }, true)).toBe("CONNECT\naccept-version:1.2\nhost:a:b\n\n\0");
    expect(encodeFrame({ command: "SEND", headers: { destination: "d", "action-type": "update-subscription" }, body: '{"é":1}' }, false)).toContain("content-length:8\n");
  });

  it("splits buffered frames, skips heart-beats and unescapes headers", () => {
    const { frames, rest } = decodeFrames('\n\nMESSAGE\nsubscription:json-1\nmessage-type:update\ndestination:core\\c//w\\cm/lists\nsubscription:ignored\n\n{"data":[]}\0\r\nCONNE');
    expect(frames).toEqual([{ command: "MESSAGE", headers: { subscription: "json-1", "message-type": "update", destination: "core://w:m/lists" }, body: '{"data":[]}' }]);
    expect(rest).toBe("CONNE");
  });

  it("subscribes, asks for the data with update-subscription, resolves on the update and unsubscribes", async () => {
    vi.stubGlobal("WebSocket", FakeSocket);
    const [connection, socket] = await connected();
    const connect = socket.frames()[0];
    expect(connect.command).toBe("CONNECT");
    expect(connect.headers).toMatchObject({ "accept-version": "1.2,1.1,1.0", "heart-beat": "20000,0", "anaplan-customer": "customer-1" });

    const pending = connection.subscribe("core://ws:model/lists", { body: {} });
    const [subscribe, send] = socket.frames().slice(1);
    expect(subscribe).toEqual({ command: "SUBSCRIBE", headers: { id: "json-1", destination: "core://ws:model/lists", "page-visible": "true" }, body: "" });
    expect(send.headers).toMatchObject({ destination: "core://ws:model/lists", "action-type": "update-subscription", "subscription-revision": "00000001", id: "json-1" });
    expect(send.body).toBe("{}");
    expect(socket.sent[1]).toContain("destination:core\\c//ws\\cmodel/lists");

    socket.serve("MESSAGE\nsubscription:json-1\nmessage-type:metadata\n\n{}\0");
    socket.serve("MESSAGE\nsubscription:json-9\nmessage-type:update\n\n{\"data\":[\"other\"]}\0");
    socket.serve("MESSAGE\nsubscription:json-1\nmessage-type:update\n\n{\"data\":[{\"id\":1,\"name\":\"Brand\"}]}\0");
    await expect(pending).resolves.toEqual({ data: [{ id: 1, name: "Brand" }] });
    expect(socket.frames().at(-1)).toEqual({ command: "UNSUBSCRIBE", headers: { id: "json-1" }, body: "" });
    connection.close();
    expect(socket.frames().at(-1)?.command).toBe("DISCONNECT");
  });

  it("waits for the predicate, and rejects on a failed action status or a server error", async () => {
    vi.stubGlobal("WebSocket", FakeSocket);
    const [connection, socket] = await connected();
    const ready = connection.subscribe("core://ws:model", { accept: "widget/model", until: data => (data as { status: string }).status === "READY" });
    expect(socket.frames()[1].headers.accept).toBe("widget/model");
    socket.serve("MESSAGE\nsubscription:json-1\nmessage-type:update\n\n{\"status\":\"LOADING\"}\0");
    await flush();
    socket.serve("MESSAGE\nsubscription:json-1\nmessage-type:update\n\n{\"status\":\"READY\"}\0");
    await expect(ready).resolves.toEqual({ status: "READY" });

    const refused = connection.subscribe("core://ws:model/lists");
    socket.serve("MESSAGE\nsubscription:json-2\nmessage-type:action-status\n\n{\"status\":\"failure\",\"reason\":\"Not allowed\"}\0");
    await expect(refused).rejects.toThrow("Not allowed");

    const waiting = connection.subscribe("core://ws:model/moduleViews");
    socket.serve('ERROR\nmessage:redirect\n\n{"error":"REDIRECTION_REQUIRED","fqdn":"other.app.anaplan.com"}\0');
    const error = await waiting.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(StompError);
    expect(error).toMatchObject({ code: "REDIRECTION_REQUIRED", fqdn: "other.app.anaplan.com" });
    await expect(connection.subscribe("core://ws:model/lists")).rejects.toThrow();
    connection.close();
  });

  it("ignores an update for another subscription revision, as Page Builder does", async () => {
    vi.stubGlobal("WebSocket", FakeSocket);
    const [connection, socket] = await connected();
    const pending = connection.subscribe("core://ws:model/applicableModules", { body: { dimensions: [101000000901] } });
    expect(socket.frames()[2].body).toBe('{"dimensions":[101000000901]}');
    socket.serve('MESSAGE\nsubscription:json-1\nmessage-type:update\nsubscription-revision:00000000\n\n{"data":["stale"]}\0');
    socket.serve('MESSAGE\nsubscription:json-1\nmessage-type:update\nsubscription-revision:00000001\n\n{"data":["current"]}\0');
    await expect(pending).resolves.toEqual({ data: ["current"] });
    connection.close();
  });

  it("reports a refused connection with the server's error", async () => {
    vi.stubGlobal("WebSocket", FakeSocket);
    const opening = StompConnection.open("wss://host.example/ws", {}, log);
    await flush();
    FakeSocket.last!.serve('ERROR\n\n{"error":"UNAUTHENTICATED"}\0');
    await expect(opening).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("reads a close whose reason is an Anaplan host as a redirect there, and any other close as a closed connection", async () => {
    vi.stubGlobal("WebSocket", FakeSocket);
    // Every close is written to the diagnostic log with its code, and with its reason when it has one.
    const lines: string[] = [];
    const closes = () => lines.splice(0).filter(line => line.startsWith("socket closed"));
    for (const host of ANAPLAN_HOSTS) {
      const [connection, socket] = await connected(line => { lines.push(line); });
      const pending = connection.subscribe("core://ws:model/lists");
      socket.close(1012, host);
      const error = await pending.catch((reason: unknown) => reason);
      expect(error, host).toBeInstanceOf(StompError);
      expect(error, host).toMatchObject({ message: `Redirected to ${host}.`, code: "REDIRECTION_REQUIRED", fqdn: host });
      expect(connection.failed).toBe(error);
      expect(closes(), host).toEqual([`socket closed code=1012 reason=${host}`]);
    }

    for (const reason of [...OTHER_HOSTS, "going away"]) {
      const [connection, socket] = await connected(line => { lines.push(line); });
      const pending = connection.subscribe("core://ws:model/lists");
      socket.close(1006, reason);
      const error = await pending.catch((thrown: unknown) => thrown);
      expect(error, reason).toBeInstanceOf(StompError);
      expect(error, reason).toMatchObject({ message: `Connection closed (code 1006, ${reason}).`, code: "CLOSE_1006", fqdn: undefined });
      expect(connection.failed, reason).toBe(error);
      expect(closes(), reason).toEqual([`socket closed code=1006 reason=${reason}`]);
    }

    const opening = StompConnection.open("wss://host.example/ws", {}, line => { lines.push(line); });
    await flush();
    FakeSocket.last!.close(1008);
    await expect(opening).rejects.toMatchObject({ message: "Connection closed (code 1008).", code: "CLOSE_1008", fqdn: undefined });
    expect(closes()).toEqual(["socket closed code=1008"]);
  });
});
