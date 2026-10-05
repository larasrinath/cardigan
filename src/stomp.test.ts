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
    // A socket that was closed while it connected does not open, as a browser's does not.
    queueMicrotask(() => { if (this.readyState !== 0) return; this.readyState = 1; this.emit("open", {}); });
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
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

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

  it("keeps a quiet subscription's three frames out of the log, and sends them like any other", async () => {
    vi.stubGlobal("WebSocket", FakeSocket);
    const lines: string[] = [];
    const [connection, socket] = await connected(line => { lines.push(line); });
    lines.length = 0;
    const sent = () => socket.frames().slice(1).map(frame => `${frame.command} ${frame.headers.id}`);
    const answer = (id: string) => socket.serve(`MESSAGE\nsubscription:${id}\nmessage-type:update\n\n{"data":[]}\0`);

    // Two reads at once, one of them quiet. Both are subscribed to, asked for and unsubscribed from, with the same headers;
    // only the other's frames are logged, as every subscription's were.
    const quiet = connection.subscribe("core://ws:model/modules/102000000901/lineItems", { body: {}, quiet: true });
    const other = connection.subscribe("core://ws:model/lists", { body: {} });
    answer("json-1");
    answer("json-2");
    await expect(Promise.all([quiet, other])).resolves.toEqual([{ data: [] }, { data: [] }]);
    expect(sent()).toEqual(["SUBSCRIBE json-1", "SEND json-1", "SUBSCRIBE json-2", "SEND json-2", "UNSUBSCRIBE json-1", "UNSUBSCRIBE json-2"]);
    expect(socket.frames()[2].headers).toMatchObject({ destination: "core://ws:model/modules/102000000901/lineItems", "action-type": "update-subscription", "subscription-revision": "00000001" });
    expect(lines.splice(0)).toEqual(["SUBSCRIBE core://ws:model/lists id=json-2", "SEND core://ws:model/lists id=json-2 action-type=update-subscription", "UNSUBSCRIBE id=json-2"]);

    // A quiet read that the service refuses, or does not answer in its time, is unsubscribed from as quietly: its failure is
    // its caller's to log, as any read's is.
    const refused = connection.subscribe("core://ws:model/modules/102000000902/lineItems", { quiet: true });
    socket.serve('MESSAGE\nsubscription:json-3\nmessage-type:error\n\n{"error":"LINE_ITEMS_UNAVAILABLE"}\0');
    await expect(refused).rejects.toThrow("LINE_ITEMS_UNAVAILABLE");
    await expect(connection.subscribe("core://ws:model/modules/102000000903/lineItems", { quiet: true, timeoutMs: 5 })).rejects.toMatchObject({ code: "TIMEOUT" });
    expect([sent().slice(6), lines]).toEqual([["SUBSCRIBE json-3", "SEND json-3", "UNSUBSCRIBE json-3", "SUBSCRIBE json-4", "SEND json-4", "UNSUBSCRIBE json-4"], []]);

    // Everything else is logged as before.
    connection.close();
    expect(lines).toEqual(["DISCONNECT", "socket closed code=1000"]);
  });

  it("gives a subscription up when its signal aborts: unsubscribed from at once, rejected, and deaf to an answer that still comes", async () => {
    vi.stubGlobal("WebSocket", FakeSocket);
    const lines: string[] = [];
    const [connection, socket] = await connected(line => { lines.push(line); });
    lines.length = 0;
    const unsubscribed = () => socket.frames().filter(frame => frame.command === "UNSUBSCRIBE").map(frame => frame.headers.id);
    const answer = (id: string, data: unknown[]) => socket.serve(`MESSAGE\nsubscription:${id}\nmessage-type:update\n\n${JSON.stringify({ data })}\0`);
    const outcomes: string[] = [];
    const watch = (name: string, read: Promise<unknown>) => read.then(data => { outcomes.push(`${name} answered ${JSON.stringify(data)}`); },
      (error: unknown) => { outcomes.push(`${name} ${(error as StompError).code}: ${(error as StompError).message}`); });

    // Three reads wait under one signal, one of them quiet, and a fourth without it.
    const givingUp = new AbortController();
    const first = watch("first", connection.subscribe("core://ws:model/a", { signal: givingUp.signal }));
    const second = watch("second", connection.subscribe("core://ws:model/b", { signal: givingUp.signal, quiet: true }));
    const third = watch("third", connection.subscribe("core://ws:model/c", { signal: givingUp.signal }));
    const other = watch("other", connection.subscribe("core://ws:model/d"));
    // The first is answered before the signal aborts: it is done with, and the abort is nothing to it.
    answer("json-1", ["a"]);
    await first;
    givingUp.abort();
    await Promise.all([second, third]);
    expect(outcomes).toEqual(['first answered {"data":["a"]}', "second GIVEN_UP: Gave up waiting for core://ws:model/b.", "third GIVEN_UP: Gave up waiting for core://ws:model/c."]);
    // Each was unsubscribed from once: the first when it was answered, the two others when they were given up. The quiet
    // one's frame is not logged, like its others.
    expect(unsubscribed()).toEqual(["json-1", "json-2", "json-3"]);
    expect(lines.filter(line => line.startsWith("UNSUBSCRIBE"))).toEqual(["UNSUBSCRIBE id=json-1", "UNSUBSCRIBE id=json-3"]);

    // An answer that still comes for a read that was given up is not read, and the read without the signal goes on.
    answer("json-2", ["late"]);
    answer("json-4", ["d"]);
    await other;
    expect(outcomes.slice(3)).toEqual(['other answered {"data":["d"]}']);
    expect(unsubscribed()).toEqual(["json-1", "json-2", "json-3", "json-4"]);

    // Under a signal that has aborted already, a read sends nothing and is rejected at once.
    const frames = socket.sent.length;
    await expect(connection.subscribe("core://ws:model/e", { signal: givingUp.signal })).rejects.toMatchObject({ code: "GIVEN_UP" });
    expect(socket.sent.length).toBe(frames);
    // The next read has the next number: none was used up for the one that was not made.
    void connection.subscribe("core://ws:model/f").catch(() => undefined);
    expect(socket.frames().at(-1)?.headers.id).toBe("json-5");
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

  it("ends an opening that is stopped at once: no socket once stopped, a connecting one closed without waiting for the service", async () => {
    vi.stubGlobal("WebSocket", FakeSocket);
    const stopped = new Error("Stopped: the results page was closed.");
    const lines: string[] = [];
    const open = (signal: AbortSignal) => StompConnection.open("wss://host.example/ws", {}, line => { lines.push(line); }, signal);
    const sent = () => FakeSocket.last!.frames().map(frame => frame.command);

    // Stopped already: no socket is opened.
    FakeSocket.last = undefined;
    const before = new AbortController();
    before.abort(stopped);
    await expect(open(before.signal)).rejects.toBe(stopped);
    expect(FakeSocket.last).toBeUndefined();

    // Stopped while the socket itself still connects: it is closed before it opens, so CONNECT is never sent.
    const connecting = new AbortController();
    const unopened = open(connecting.signal);
    connecting.abort(stopped);
    await expect(unopened).rejects.toBe(stopped);
    await flush();
    expect([FakeSocket.last!.readyState, sent(), lines.splice(0)]).toEqual([3, [], ["socket closed code=1000"]]);

    // Stopped after CONNECT, which the service has not answered: closed at once, with the DISCONNECT every open socket ends on.
    const unanswered = new AbortController();
    const waiting = open(unanswered.signal);
    await flush();
    expect(sent()).toEqual(["CONNECT"]);
    unanswered.abort(stopped);
    await expect(waiting).rejects.toBe(stopped);
    expect([FakeSocket.last!.readyState, sent()]).toEqual([3, ["CONNECT", "DISCONNECT"]]);
    // The service's answer may still arrive on the closing socket: it connects nothing, and no heart-beat is started for it.
    const intervals = vi.spyOn(globalThis, "setInterval");
    FakeSocket.last!.serve("CONNECTED\nversion:1.2\nserver:test\n\n\0");
    expect(intervals).not.toHaveBeenCalled();
    expect(lines.splice(0)).toEqual(["socket open; sending CONNECT", "CONNECT", "DISCONNECT", "socket closed code=1000"]);

    // A stop without a reason of its own rejects with the signal's.
    const bare = new AbortController();
    const unexplained = open(bare.signal);
    bare.abort();
    await expect(unexplained).rejects.toBe(bare.signal.reason);

    // Once the connection is open a stop is no longer this step's to act on: the connection stays open, for its user to close.
    const later = new AbortController();
    const opening = open(later.signal);
    await flush();
    FakeSocket.last!.serve("CONNECTED\nversion:1.2\nserver:test\n\n\0");
    const connection = await opening;
    expect(intervals).toHaveBeenCalledTimes(1);
    later.abort(stopped);
    expect([connection.failed, FakeSocket.last!.readyState, sent()]).toEqual([undefined, 1, ["CONNECT"]]);
    connection.close();
  });

  it("sends nothing on a socket that opens after its opening has ended: after a stop, or after the time to connect is over", async () => {
    vi.stubGlobal("WebSocket", FakeSocket);
    const stopped = new Error("Stopped: the results page was closed.");
    const lines: string[] = [];
    const sent = () => FakeSocket.last!.frames().map(frame => frame.command);

    // Stopped while the socket connects, it is closed and no frame was sent. Should it say that it has opened all the
    // same, nothing is sent on it then either, and nothing is logged for it.
    const stopping = new AbortController();
    const opening = StompConnection.open("wss://host.example/ws", {}, line => { lines.push(line); }, stopping.signal);
    stopping.abort(stopped);
    await expect(opening).rejects.toBe(stopped);
    await flush();
    expect([sent(), lines]).toEqual([[], ["socket closed code=1000"]]);
    FakeSocket.last!.emit("open", {});
    await flush();
    expect([sent(), lines.splice(0)]).toEqual([[], ["socket closed code=1000"]]);

    // The same once the time to connect is over, here without an answer to CONNECT: the socket was closed with the
    // DISCONNECT every open socket ends on, and an open that arrives after that sends no second CONNECT.
    const slow = StompConnection.open("wss://host.example/ws", {}, line => { lines.push(line); }, undefined, 5);
    await expect(slow).rejects.toThrow("Timed out connecting to the model data service.");
    expect([sent(), lines]).toEqual([["CONNECT", "DISCONNECT"], ["socket open; sending CONNECT", "CONNECT", "DISCONNECT", "socket closed code=1000"]]);
    FakeSocket.last!.emit("open", {});
    await flush();
    expect([sent(), lines]).toEqual([["CONNECT", "DISCONNECT"], ["socket open; sending CONNECT", "CONNECT", "DISCONNECT", "socket closed code=1000"]]);
  });
});
