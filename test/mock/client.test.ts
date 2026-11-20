import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { explainNetworkError, SynologyClient } from "../../src/synology/client.js";
import { SynologyApiError } from "../../src/synology/errors.js";
import { configFor } from "../helpers/harness.js";
import { MockNas, RawBody, SynoError } from "../helpers/mock-nas.js";

let nas: MockNas;
let client: SynologyClient;

async function setup(opts: ConstructorParameters<typeof MockNas>[0] = {}, config = {}) {
  nas = await new MockNas(opts).start();
  nas.on("SYNO.FileStation.Info", "get", () => ({ hostname: "mock" }));
  client = new SynologyClient(configFor(nas, config));
}

afterEach(async () => {
  await client?.logout();
  await nas?.stop();
});

/** The client prints a warning when it falls back to v6; keep test output clean. */
async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = original;
  }
}

describe("login", () => {
  test("uses the Noise v7 login when the NAS supports it", async () => {
    await setup();
    assert.deepEqual(await client.request("SYNO.FileStation.Info", "get"), { hostname: "mock" });
    assert.deepEqual(nas.logins, [{ version: 7 }]);
    const login = nas.callsTo("SYNO.API.Auth", "login")[0];
    assert.equal(login.params.enable_syno_token, "yes");
    assert.ok(login.params.ik_message);
    assert.match(String(login.headers.cookie), /_SSID=/);
  });

  test("falls back to v6 when the NAS gives no Noise key", async () => {
    await setup({ noiseKey: false });
    await quietly(() => client.request("SYNO.FileStation.Info", "get"));
    assert.deepEqual(nas.logins, [{ version: 6 }]);
  });

  test("uses v6 directly when the NAS only supports Auth v6", async () => {
    await setup({ authMaxVersion: 6 });
    await client.request("SYNO.FileStation.Info", "get");
    assert.deepEqual(nas.logins, [{ version: 6 }]);
    assert.equal(nas.callsTo("SYNO.API.Auth.Type").length, 0);
  });

  test("wrong credentials fail without falling back to v6", async () => {
    await setup({}, { password: "wrong" });
    await assert.rejects(client.request("SYNO.FileStation.Info", "get"), (err: unknown) => {
      assert.ok(err instanceof SynologyApiError);
      assert.equal(err.code, 400);
      assert.match(err.message, /incorrect password/);
      return true;
    });
    assert.equal(nas.callsTo("SYNO.API.Auth", "login").length, 1);
  });

  test("sends X-SYNO-TOKEN and the sid on every call", async () => {
    await setup();
    await client.request("SYNO.FileStation.Info", "get");
    const call = nas.callsTo("SYNO.FileStation.Info", "get")[0];
    assert.equal(call.headers["x-syno-token"], "token-1");
    assert.equal(call.params._sid, "sid-1");
  });

  test("logs in again once when the session expires", async () => {
    await setup();
    await client.request("SYNO.FileStation.Info", "get");
    nas.expireSessions();
    assert.deepEqual(await client.request("SYNO.FileStation.Info", "get"), { hostname: "mock" });
    assert.equal(nas.logins.length, 2);
  });

  test("concurrent first calls share a single login", async () => {
    await setup();
    await Promise.all([1, 2, 3].map(() => client.request("SYNO.FileStation.Info", "get")));
    assert.equal(nas.logins.length, 1);
  });

  test("logout closes the session", async () => {
    await setup();
    await client.request("SYNO.FileStation.Info", "get");
    await client.logout();
    assert.equal(nas.callsTo("SYNO.API.Auth", "logout")[0].params._sid, "sid-1");
  });
});

describe("requests", () => {
  test("caps the version to what the NAS advertises", async () => {
    await setup();
    nas.on("SYNO.FileStation.CopyMove", "status", () => ({ finished: true }));
    await client.request("SYNO.FileStation.CopyMove", "status");
    assert.equal(nas.callsTo("SYNO.FileStation.CopyMove")[0].version, 3); // preferred version
    await client.request("SYNO.FileStation.CopyMove", "status", {}, 99);
    assert.equal(nas.callsTo("SYNO.FileStation.CopyMove")[1].version, 20); // NAS max
  });

  test("an API the NAS does not have is error 102", async () => {
    await setup();
    await assert.rejects(client.request("SYNO.Nope", "get"), /does not exist \(code 102\)/);
  });

  test("API errors become SynologyApiError with the right description", async () => {
    await setup();
    nas.on("SYNO.FileStation.Rename", "rename", () => {
      throw new SynoError(1200, [{ code: 1200, path: "/home/a" }]);
    });
    await assert.rejects(client.request("SYNO.FileStation.Rename", "rename"), /Failed to rename it .*\/home\/a/);
  });

  test("drops undefined and null parameters", async () => {
    await setup();
    await client.request("SYNO.FileStation.Info", "get", { a: undefined, b: null, c: 0, d: false });
    const p = nas.callsTo("SYNO.FileStation.Info")[0].params;
    assert.equal("a" in p, false);
    assert.equal("b" in p, false);
    assert.equal(p.c, "0");
    assert.equal(p.d, "false");
  });

  test("poll stops when done and reports timeouts", async () => {
    await setup();
    let n = 0;
    const done = await client.poll(async () => ++n, (r) => r >= 3, 5_000, 1);
    assert.deepEqual(done, { result: 3, finished: true });
    const late = await client.poll(async () => 0, () => false, 20, 5);
    assert.equal(late.finished, false);
  });
});

describe("download and upload", () => {
  test("download returns the bytes and the file name", async () => {
    await setup();
    nas.on("SYNO.FileStation.Download", "download", () =>
      new RawBody(Buffer.from("hola"), "text/plain", { "content-disposition": "attachment; filename*=UTF-8''a%C3%B1o.txt" }),
    );
    const r = await client.download(["/home/año.txt"]);
    assert.equal(r.data.toString(), "hola");
    assert.equal(r.filename, "año.txt");
    assert.equal(nas.callsTo("SYNO.FileStation.Download")[0].params.path, '["/home/año.txt"]');
  });

  test("download turns a JSON answer into an error", async () => {
    await setup();
    nas.on("SYNO.FileStation.Download", "download", () => {
      throw new SynoError(408);
    });
    await assert.rejects(client.download(["/home/x"]), (e: unknown) => e instanceof SynologyApiError && e.code === 408);
  });

  test("upload sends a multipart form with the file last and overwrite only when true", async () => {
    await setup();
    nas.on("SYNO.FileStation.Upload", "upload", () => ({}));
    await client.upload({ destFolder: "/home/t", filename: "a.txt", content: Buffer.from("x"), overwrite: false, createParents: true });
    await client.upload({ destFolder: "/home/t", filename: "a.txt", content: Buffer.from("y"), overwrite: true, createParents: false });
    const [first, second] = nas.callsTo("SYNO.FileStation.Upload");
    assert.deepEqual(Object.keys(first.form!), ["path", "create_parents", "file"]);
    assert.deepEqual(first.form!.file, { filename: "a.txt", content: Buffer.from("x") });
    assert.equal(second.form!.overwrite, "true");
    assert.equal(second.form!.create_parents, "false");
    assert.ok(first.headers["x-syno-token"]);
  });
});

describe("connection errors", () => {
  const fetchFailed = (code: string, message = code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(message), { code }) });

  test("certificate problems suggest renewing it or SYNOLOGY_INSECURE_TLS", () => {
    const e = explainNetworkError(fetchFailed("CERT_HAS_EXPIRED", "certificate has expired"), "https://nas:5001/webapi/entry.cgi") as Error;
    assert.match(e.message, /^TLS error talking to https:\/\/nas:5001: certificate has expired \(CERT_HAS_EXPIRED\)/);
    assert.match(e.message, /SYNOLOGY_INSECURE_TLS=true/);
    assert.match((explainNetworkError(fetchFailed("ERR_TLS_CERT_ALTNAME_INVALID"), "https://1.2.3.4:5001/") as Error).message, /host name the certificate/);
  });

  test("other errors are left alone", () => {
    const e = new Error("boom");
    assert.equal(explainNetworkError(e, "http://nas:5000/"), e);
  });

  test("an unreachable NAS gives an actionable message", async () => {
    const nas = await new MockNas().start();
    const config = configFor(nas);
    await nas.stop(); // nothing listens on that port any more
    const client = new SynologyClient(config);
    await assert.rejects(client.request("SYNO.FileStation.Info", "get"), /Cannot reach the NAS at http:\/\/127\.0\.0\.1:\d+ \(ECONNREFUSED\)/);
  });
});

describe("2-step verification", () => {
  for (const authMaxVersion of [7, 6]) {
    test(`v${authMaxVersion}: a device token from register-device replaces the code`, async () => {
      await setup({ otp: "123456", authMaxVersion });

      await assert.rejects(client.request("SYNO.FileStation.Info", "get"), /2-step verification code required: run `synology-mcp register-device`.*\(code 403\)/);
      await assert.rejects(client.registerDevice("000000"), /wrong or expired code\) \(code 404\)/);

      const did = await client.registerDevice("123456");
      assert.equal(did, "did-1");
      const login = nas.callsTo("SYNO.API.Auth", "login").at(-1)!;
      assert.equal(login.params.otp_code, "123456");
      assert.equal(login.params.enable_device_token, "yes");
      assert.equal(login.params.device_name, "synology-mcp");

      const trusted = new SynologyClient(configFor(nas, { deviceId: did, deviceName: "synology-mcp" }));
      try {
        assert.deepEqual(await trusted.request("SYNO.FileStation.Info", "get"), { hostname: "mock" });
        const last = nas.callsTo("SYNO.API.Auth", "login").at(-1)!;
        assert.equal(last.params.device_id, "did-1");
        assert.equal(last.params.otp_code, undefined);
      } finally {
        await trusted.logout();
      }
    });
  }
});
