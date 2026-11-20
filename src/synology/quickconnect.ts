import { fetch } from "undici";

/**
 * QuickConnect: turn a QuickConnect ID into a DSM address that answers, the way
 * Synology's apps do. Protocol (undocumented, checked against the real service on
 * 2026-11-20, see docs/api-synology.md):
 *
 * 1. POST [{command: "get_server_info", serverID: <id>, id: "dsm_portal_https"}] to
 *    https://global.quickconnect.to/Serv.php. The answer lists the NAS's LAN
 *    addresses as Synology-signed names (smartdns.lan, e.g.
 *    192-168-1-2.<id>.direct.quickconnect.to), its external name and port, and the
 *    control host for relays. An unknown ID gives errno != 0; a NAS registered in
 *    another region may answer with `sites` to ask again there.
 * 2. POST [{command: "request_tunnel", …}] to the control host gives a relay
 *    (relay_dn:relay_port) that works from anywhere without opening ports.
 *
 * Candidates are probed in order (LAN, then direct external, then relay) with a
 * cheap SYNO.API.Info query; the first that answers wins. All of them use
 * certificates valid for *.direct.quickconnect.to, so no insecure TLS is needed.
 */

const GLOBAL = "global.quickconnect.to";

interface ServerInfo {
  errno?: number;
  sites?: string[];
  env?: { control_host?: string; relay_region?: string };
  server?: { interface?: { ip?: string }[]; external?: { ip?: string } };
  service?: { port?: number; ext_port?: number; pingpong?: string; relay_dn?: string; relay_port?: number };
  smartdns?: { lan?: string[]; external?: string; host?: string };
}

export interface Candidate {
  kind: "lan" | "external" | "relay";
  url: string;
}

type Fetch = (url: string, init?: Parameters<typeof fetch>[1]) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface ResolveOptions {
  /** For tests: replaces undici's fetch. */
  fetchImpl?: Fetch;
  /** Base of the QuickConnect service, for tests (default https://global.quickconnect.to). */
  serviceUrl?: (host: string) => string;
  probeTimeoutMs?: number;
}

/** `quickconnect:<ID>` (or quickconnect://<ID>) in SYNOLOGY_URL. */
export function quickConnectId(url: string): string | undefined {
  const m = /^quickconnect:(?:\/\/)?([A-Za-z0-9][A-Za-z0-9-]*)\/?$/i.exec(url.trim());
  return m?.[1];
}

async function serv(host: string, body: object, opts: ResolveOptions): Promise<ServerInfo> {
  const doFetch = (opts.fetchImpl ?? (fetch as unknown as Fetch)) as Fetch;
  const url = opts.serviceUrl ? opts.serviceUrl(host) : `https://${host}/Serv.php`;
  const res = await doFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify([body]),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`QuickConnect service answered HTTP ${res.status}`);
  const parsed = JSON.parse(await res.text()) as ServerInfo[];
  return parsed[0] ?? {};
}

/** Ask the QuickConnect service where the NAS is; returns the candidate addresses in the order to try. */
export async function quickConnectCandidates(id: string, opts: ResolveOptions = {}): Promise<Candidate[]> {
  const request = { version: 1, command: "get_server_info", stop_when_error: false, stop_when_success: false, id: "dsm_portal_https", serverID: id, is_gofile: false, path: "" };
  let info = await serv(GLOBAL, request, opts);
  if (info.errno && info.sites?.length) info = await serv(info.sites[0], request, opts);
  if (info.errno || !info.service) {
    throw new Error(`QuickConnect ID "${id}" was not found (errno ${info.errno ?? "?"}). Check it in DSM: Control Panel > External Access > QuickConnect.`);
  }

  const port = info.service.port ?? 5001;
  const candidates: Candidate[] = [];
  for (const host of info.smartdns?.lan ?? []) candidates.push({ kind: "lan", url: `https://${host}:${port}` });
  if (info.smartdns?.external && info.service.pingpong === "CONNECTED") {
    candidates.push({ kind: "external", url: `https://${info.smartdns.external}:${info.service.ext_port || port}` });
  }
  if (info.env?.control_host) {
    try {
      const tunnel = await serv(info.env.control_host, { ...request, command: "request_tunnel", stop_when_success: true }, opts);
      if (tunnel.service?.relay_dn) candidates.push({ kind: "relay", url: `https://${tunnel.service.relay_dn}:${tunnel.service.relay_port || 443}` });
    } catch {
      // No relay: the direct candidates may still work.
    }
  }
  return candidates;
}

/** Resolve a QuickConnect ID to the first candidate that answers a DSM API query. */
export async function resolveQuickConnect(id: string, opts: ResolveOptions = {}): Promise<Candidate> {
  const doFetch = (opts.fetchImpl ?? (fetch as unknown as Fetch)) as Fetch;
  const candidates = await quickConnectCandidates(id, opts);
  for (const c of candidates) {
    try {
      const res = await doFetch(`${c.url}/webapi/query.cgi?api=SYNO.API.Info&version=1&method=query&query=SYNO.API.Auth`, {
        signal: AbortSignal.timeout(opts.probeTimeoutMs ?? (c.kind === "lan" ? 3_000 : 8_000)),
      });
      if (res.ok && (await res.text()).includes('"success":true')) return c;
    } catch {
      // Not reachable from here; try the next one.
    }
  }
  throw new Error(
    `QuickConnect ID "${id}": none of its ${candidates.length} addresses answered (${candidates.map((c) => c.kind).join(", ") || "none offered"}). Is QuickConnect enabled and the NAS online?`,
  );
}
