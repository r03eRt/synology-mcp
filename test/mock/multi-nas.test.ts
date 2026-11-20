import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadConfig, loadNasList } from "../../src/config.js";
import { createServer } from "../../src/server.js";
import { quickConnectCandidates, quickConnectId, resolveQuickConnect } from "../../src/synology/quickconnect.js";
import { NasPool } from "../../src/synology/pool.js";
import { configFor } from "../helpers/harness.js";
import { MockNas } from "../helpers/mock-nas.js";

const USER_Q = ["test", "user"].join("-");
const FAKE_Q = ["fake", "value"].join("-");

describe("QuickConnect", () => {
  // Shape copied from the real service (2026-11-20), with made-up names.
  const serverInfo = {
    command: "get_server_info",
    errno: 0,
    env: { control_host: "dec.quickconnect.to", relay_region: "fr" },
    server: { interface: [{ ip: "192.168.1.2" }], external: { ip: "203.0.113.7" } },
    service: { port: 5001, ext_port: 0, pingpong: "DISCONNECTED" },
    smartdns: { lan: ["192-168-1-2.mynas.direct.quickconnect.to"], external: "syn4-x.mynas.direct.quickconnect.to", host: "mynas.direct.quickconnect.to" },
  };
  const tunnel = { command: "request_tunnel", errno: 0, service: { relay_dn: "synr-fr4.mynas.direct.quickconnect.to", relay_port: 51136 } };

  /** A fake network: the QuickConnect service plus which DSM addresses answer. */
  function fakeFetch(opts: { info?: object; reachable?: string[]; byHost?: Record<string, object> } = {}) {
    const calls: string[] = [];
    const fetchImpl = async (url: string, init?: { body?: unknown }) => {
      calls.push(url);
      const u = new URL(url);
      if (u.pathname === "/Serv.php") {
        const [req] = JSON.parse(String(init?.body));
        const body = opts.byHost?.[u.host] ?? (req.command === "request_tunnel" ? tunnel : (opts.info ?? serverInfo));
        return { ok: true, status: 200, text: async () => JSON.stringify([body]) };
      }
      if ((opts.reachable ?? []).includes(u.origin)) return { ok: true, status: 200, text: async () => '{"data":{},"success":true}' };
      throw new TypeError("fetch failed");
    };
    return { fetchImpl, calls };
  }

  test("quickConnectId accepts quickconnect:<id> and quickconnect://<id>", () => {
    assert.equal(quickConnectId("quickconnect:mynas"), "mynas");
    assert.equal(quickConnectId("QuickConnect://my-nas/"), "my-nas");
    assert.equal(quickConnectId("http://192.168.1.2:5000"), undefined);
    assert.equal(loadConfig({ SYNOLOGY_URL: "quickconnect:mynas", SYNOLOGY_USERNAME: USER_Q, SYNOLOGY_PASSWORD: FAKE_Q }).url, "quickconnect:mynas");
  });

  test("candidates: LAN names first, external only if reachable from the Internet, then the relay", async () => {
    const { fetchImpl } = fakeFetch();
    assert.deepEqual(await quickConnectCandidates("mynas", { fetchImpl }), [
      { kind: "lan", url: "https://192-168-1-2.mynas.direct.quickconnect.to:5001" },
      { kind: "relay", url: "https://synr-fr4.mynas.direct.quickconnect.to:51136" },
    ]);
    const open = fakeFetch({ info: { ...serverInfo, service: { ...serverInfo.service, pingpong: "CONNECTED", ext_port: 15001 } } });
    assert.equal((await quickConnectCandidates("mynas", { fetchImpl: open.fetchImpl }))[1].url, "https://syn4-x.mynas.direct.quickconnect.to:15001");
  });

  test("resolve picks the first address that answers: LAN at home, relay outside", async () => {
    const home = fakeFetch({ reachable: ["https://192-168-1-2.mynas.direct.quickconnect.to:5001", "https://synr-fr4.mynas.direct.quickconnect.to:51136"] });
    assert.equal((await resolveQuickConnect("mynas", { fetchImpl: home.fetchImpl })).kind, "lan");
    const away = fakeFetch({ reachable: ["https://synr-fr4.mynas.direct.quickconnect.to:51136"] });
    assert.deepEqual(await resolveQuickConnect("mynas", { fetchImpl: away.fetchImpl }), { kind: "relay", url: "https://synr-fr4.mynas.direct.quickconnect.to:51136" });
    const none = fakeFetch({ reachable: [] });
    await assert.rejects(resolveQuickConnect("mynas", { fetchImpl: none.fetchImpl }), /none of its 2 addresses answered \(lan, relay\)/);
  });

  test("an unknown ID is explained, and a region redirect is followed", async () => {
    const unknown = fakeFetch({ info: { command: "get_server_info", errno: 4 } });
    await assert.rejects(quickConnectCandidates("nope", { fetchImpl: unknown.fetchImpl }), /QuickConnect ID "nope" was not found \(errno 4\)/);
    const redirected = fakeFetch({ byHost: { "global.quickconnect.to": { errno: 21, sites: ["us.quickconnect.to"] } } });
    const c = await quickConnectCandidates("mynas", { fetchImpl: redirected.fetchImpl });
    assert.equal(c[0].kind, "lan");
    assert.ok(redirected.calls.includes("https://us.quickconnect.to/Serv.php"));
  });
});

describe("several NAS", () => {
  // Fake values built at runtime so secret scanners (GitGuardian) do not mistake test fixtures for credentials.
  const FAKE = ["fake", "value"].join("-");
  const USER = ["test", "user"].join("-");
  const env = { SYNOLOGY_NAS_FILE: "/nas.json", CASA_PW: FAKE, SYNOLOGY_READ_ONLY: "false" };
  const file = (o: object) => () => JSON.stringify(o);

  test("loadNasList reads the file, passwords from the environment and the default", () => {
    const { entries, defaultName } = loadNasList(
      env,
      file({
        default: "oficina",
        nas: [
          { name: "casa", url: "http://192.168.1.2:5000", username: USER, password_env: "CASA_PW" },
          { name: "oficina", url: "quickconnect:office-nas", username: USER, password: FAKE, insecure_tls: true },
        ],
      }),
    );
    assert.equal(defaultName, "oficina");
    assert.equal(entries[0].config.password, FAKE);
    assert.equal(entries[0].config.readOnly, false, "read-only stays global");
    assert.equal(entries[1].config.insecureTls, true);
    assert.equal(loadNasList({ SYNOLOGY_URL: "http://n:5000", SYNOLOGY_USERNAME: USER, SYNOLOGY_PASSWORD: FAKE }).entries[0].name, "default");
  });

  test("loadNasList explains configuration mistakes", () => {
    const bad = (o: object) => () => loadNasList(env, file(o));
    assert.throws(bad({ nas: [] }), /non-empty "nas" list/);
    assert.throws(bad({ nas: [{ url: "http://a:5000", username: USER, password: FAKE }] }), /"name" is required/);
    assert.throws(bad({ nas: [{ name: "a", url: "http://a", username: USER, password: FAKE }, { name: "A", url: "http://b", username: USER, password: FAKE }] }), /duplicate name "A"/);
    assert.throws(bad({ nas: [{ name: "a", url: "http://a", username: USER, password_env: "MISSING" }] }), /MISSING is not set/);
    assert.throws(bad({ default: "z", nas: [{ name: "a", url: "http://a", username: USER, password: FAKE }] }), /default "z" is not in the list/);
    assert.throws(() => loadNasList(env, () => "{not json"), /cannot read it as JSON/);
  });

  describe("list_nas and use_nas", () => {
    let a: MockNas;
    let b: MockNas;
    let mcp: Client;
    let pool: NasPool;

    before(async () => {
      a = await new MockNas().start();
      b = await new MockNas().start();
      a.on("SYNO.FileStation.Info", "get", () => ({ hostname: "nas-a" }));
      b.on("SYNO.FileStation.Info", "get", () => ({ hostname: "nas-b" }));
      pool = new NasPool(
        [
          { name: "casa", config: configFor(a) },
          { name: "oficina", config: configFor(b) },
        ],
        "casa",
      );
      const server = createServer(pool.client, configFor(a), pool);
      const [s, c] = InMemoryTransport.createLinkedPair();
      await server.connect(s);
      mcp = new Client({ name: "t", version: "0" });
      await mcp.connect(c);
    });
    after(async () => {
      await pool.logoutAll();
      await mcp.close();
      await a.stop();
      await b.stop();
    });

    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await mcp.callTool({ name, arguments: args });
      const text = (r.content as { text: string }[])[0].text;
      return { isError: Boolean(r.isError), text, json: (() => { try { return JSON.parse(text); } catch { return undefined; } })() };
    };

    test("tools act on the active NAS and use_nas switches it", async () => {
      assert.match(mcp.getInstructions() ?? "", /Several NAS are configured \(casa, oficina\)/);
      assert.match((await call("get_info")).text, /nas-a/);
      assert.deepEqual((await call("use_nas", { name: "OFICINA" })).json, { active: "oficina" });
      assert.match((await call("get_info")).text, /nas-b/);
      const list = (await call("list_nas")).json;
      assert.equal(list.active, "oficina");
      assert.deepEqual(list.nas.map((n: { name: string; active: boolean; url: string }) => [n.name, n.active, n.url]), [
        ["casa", false, a.url],
        ["oficina", true, b.url],
      ]);
      assert.match((await call("use_nas", { name: "nope" })).text, /No NAS named "nope". Configured: casa, oficina/);
      assert.equal(a.logins.length, 1, "each NAS keeps its own session");
      assert.equal(b.logins.length, 1);
    });

    test("with a single NAS the tools are not registered", async () => {
      const single = new NasPool([{ name: "default", config: configFor(a) }], "default");
      const tools = (await (async () => {
        const server = createServer(single.client, configFor(a), single);
        const [s, c] = InMemoryTransport.createLinkedPair();
        await server.connect(s);
        const client = new Client({ name: "t", version: "0" });
        await client.connect(c);
        const t = (await client.listTools()).tools;
        await client.close();
        return t;
      })()).map((t) => t.name);
      assert.equal(tools.includes("use_nas"), false);
    });
  });
});
