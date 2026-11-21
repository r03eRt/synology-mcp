import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { generatePassword } from "../../src/tools/admin.js";
import { withMockNas } from "../helpers/harness.js";
import { SynoError } from "../helpers/mock-nas.js";

type H = Awaited<ReturnType<typeof withMockNas>>;

describe("generatePassword", () => {
  test("20 characters with every class, different each time", () => {
    const a = generatePassword();
    assert.equal(a.length, 20);
    assert.match(a, /[A-Z]/);
    assert.match(a, /[a-z]/);
    assert.match(a, /[0-9]/);
    assert.match(a, /[^A-Za-z0-9]/);
    assert.notEqual(a, generatePassword());
  });
});

describe("DSM user management", () => {
  let h: H;
  // The mock NAS signs in as "tester": that is the MCP's own account here.
  const users = new Map<string, { description: string; expired: string; groups: string[]; password: string }>();
  const minLength = 6;

  before(async () => {
    h = await withMockNas();
    const { nas } = h;
    users.set("tester", { description: "", expired: "normal", groups: ["administrators", "users"], password: "" });
    users.set("marta", { description: "Ds photo", expired: "normal", groups: ["users"], password: "" });
    nas.on("SYNO.Core.User", "get", (p) => {
      assert.equal(p.action, '"get"');
      const name = JSON.parse(p.name);
      if (!users.has(name)) throw new SynoError(3106);
      return { users: [{ name, uid: 1030 }] };
    });
    nas.on("SYNO.Core.User.PasswordPolicy", "check", (p) => {
      if (JSON.parse(p.password).length < minLength) throw new SynoError(3121);
      return {};
    });
    nas.on("SYNO.Core.User", "create", (p) => {
      const name = JSON.parse(p.name);
      assert.equal(p.expired, '"normal"');
      assert.equal(p.notify_by_email, "false");
      users.set(name, { description: JSON.parse(p.description), expired: "normal", groups: ["users"], password: JSON.parse(p.password) });
      return { name, uid: 1040 };
    });
    nas.on("SYNO.Core.User", "set", (p) => {
      const u = users.get(JSON.parse(p.name))!;
      if (p.description !== undefined) u.description = JSON.parse(p.description);
      if (p.expired !== undefined) u.expired = JSON.parse(p.expired);
      if (p.password !== undefined) u.password = JSON.parse(p.password);
      return {};
    });
    nas.on("SYNO.Core.User", "delete", (p) => {
      for (const n of JSON.parse(p.name)) users.delete(n);
      return {};
    });
    // Like the real NAS: join is a background task; the change shows once join_status says finish.
    const pending = new Map<string, () => void>();
    nas.on("SYNO.Core.User.Group", "join", (p) => {
      const u = users.get(JSON.parse(p.name))!;
      const join: string[] = JSON.parse(p.join_group);
      const leave: string[] = JSON.parse(p.leave_group);
      const task = `@administrators/JOIN${pending.size}`;
      pending.set(task, () => (u.groups = [...new Set([...u.groups.filter((g) => !leave.includes(g)), ...join])]));
      return { task_id: task };
    });
    nas.on("SYNO.Core.User.Group", "join_status", (p) => {
      const task = JSON.parse(p.task_id);
      pending.get(task)?.();
      pending.delete(task);
      return { finish: true };
    });
    nas.on("SYNO.Core.User.Group", "get", (p) => ({ groups: users.get(JSON.parse(p.name))!.groups }));
    nas.on("SYNO.Core.User.UsernamePolicy", "list", () => ["admin", "test", "pi"]);
  });

  after(async () => {
    await h?.close();
  });

  test("dsm_create_user with a generated password and extra groups", async () => {
    const r = await h.call("dsm_create_user", { name: "lucia", description: "Hija", groups: ["family"] });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.json.created, "lucia");
    assert.deepEqual(r.json.groups, ["users", "family"]);
    assert.equal(r.json.generated_password.length, 20);
    assert.equal(users.get("lucia")!.password, r.json.generated_password);
    assert.match(r.json.note, /only once/);
  });

  test("dsm_create_user with a given password does not echo it and warns about common names", async () => {
    const pass = ["given", "Value", "42"].join("-");
    const r = await h.call("dsm_create_user", { name: "pi", password: pass });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.json.generated_password, undefined);
    assert.doesNotMatch(r.text, new RegExp(pass));
    assert.match(r.json.warning, /common user name/);
  });

  test("dsm_create_user refuses existing users and weak passwords", async () => {
    const exists = await h.call("dsm_create_user", { name: "marta" });
    assert.equal(exists.isError, true);
    assert.match(exists.text, /already exists/);
    const weak = await h.call("dsm_create_user", { name: "pepe", password: ["a", "b"].join("") });
    assert.equal(weak.isError, true);
    assert.match(weak.text, /password policy/);
    assert.equal(users.has("pepe"), false);
  });

  test("dsm_update_user disables, changes groups and generates a password", async () => {
    const r = await h.call("dsm_update_user", { name: "marta", disabled: true, add_groups: ["family"], generate_password: true });
    assert.equal(r.isError, false, r.text);
    assert.equal(users.get("marta")!.expired, "now");
    assert.deepEqual(r.json.groups, ["users", "family"]);
    assert.equal(r.json.status, "disabled");
    assert.equal(users.get("marta")!.password, r.json.generated_password);
  });

  test("dsm_update_user will not lock out the MCP's own account", async () => {
    const off = await h.call("dsm_update_user", { name: "tester", disabled: true });
    assert.equal(off.isError, true);
    assert.match(off.text, /lock the MCP out/);
    const demote = await h.call("dsm_update_user", { name: "Tester", remove_groups: ["administrators"] });
    assert.equal(demote.isError, true);
    assert.deepEqual(users.get("tester")!.groups, ["administrators", "users"]);
    const missing = await h.call("dsm_update_user", { name: "nadie", description: "x" });
    assert.equal(missing.isError, true);
    assert.match(missing.text, /No user nadie/);
  });

  test("dsm_delete_user deletes, but not itself, built-in or unknown accounts", async () => {
    for (const [names, msg] of [
      [["tester"], /cannot delete itself/],
      [["admin"], /Built-in/],
      [["lucia", "nadie"], /No such user: nadie/],
    ] as const) {
      const r = await h.call("dsm_delete_user", { names });
      assert.equal(r.isError, true);
      assert.match(r.text, msg);
    }
    assert.equal(users.has("lucia"), true);
    const r = await h.call("dsm_delete_user", { names: ["lucia", "pi"] });
    assert.equal(r.isError, false, r.text);
    assert.deepEqual(r.json.deleted, ["lucia", "pi"]);
    assert.equal(users.has("lucia"), false);
  });

  test("read-only mode does not register user writes", async () => {
    const ro = await withMockNas({ config: { readOnly: true } });
    try {
      const { tools } = await ro.mcp.listTools();
      const names = tools.map((t) => t.name);
      for (const n of ["dsm_create_user", "dsm_update_user", "dsm_delete_user", "downloads_set_limits", "downloads_set_schedule"]) assert.equal(names.includes(n), false, n);
      assert.equal(names.includes("downloads_search"), true);
    } finally {
      await ro.close();
    }
  });
});
