import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { json, type SynologyClient } from "../synology/client.js";
import { SynologyApiError } from "../synology/errors.js";
import { humanSize, ok, safe } from "./format.js";

/**
 * Synology Photos. Undocumented: the API names, methods and versions come from the
 * table in the Photos web app (webman/3rdparty/SynologyPhotos/react_bundle.js), where
 * SYNO.Foto.* is the user's personal space (/home/Photos) and SYNO.FotoTeam.* the
 * shared space (the /photo shared folder). String and array parameters are JSON-encoded.
 */

const SPACES = { personal: "SYNO.Foto", shared: "SYNO.FotoTeam" } as const;
type Space = keyof typeof SPACES;
/** Versions from the web app's method table. */
const V = { item: 7, search: 7, album: 4, normalAlbum: 1, albumWrite: 1, folder: 2, person: 1, geocoding: 1, tag: 2, userInfo: 1 } as const;
/** Max items scanned when two filters the API cannot combine are given (filtered here). */
const SCAN_LIMIT = 5000;

interface PhotoItem {
  id: number;
  filename: string;
  filesize: number;
  /** Taken time, Unix seconds (local time of the photo written as if UTC). */
  time: number;
  owner_user_id: number;
  folder_id: number;
  type: string;
  additional?: {
    description?: string;
    exif?: Record<string, string>;
    resolution?: { width: number; height: number };
    address?: { country?: string; state?: string; county?: string; city?: string; town?: string; district?: string; village?: string; route?: string; landmark?: string };
    tag?: { name: string }[];
    rating?: number;
  };
}

interface Album {
  id: number;
  name: string;
  item_count: number;
  type: string;
  shared?: boolean;
  start_time?: number;
  end_time?: number;
  create_time?: number;
  owner_user_id?: number;
  passphrase?: string;
}

/** Photos stores taken time as local wall-clock seconds; show it without a time zone. */
export function takenAt(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 19);
}

/** "2024-07-01" → start of that day; "2024-07-01T18:00" kept; both read as wall-clock time like Photos. */
export function wallClockSeconds(d: string, endOfDay = false): number {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T${endOfDay ? "23:59:59" : "00:00:00"}Z` : /Z|[+-]\d{2}:?\d{2}$/.test(d) ? d : `${d}Z`;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error(`Not a date: ${d}`);
  return Math.floor(t / 1000);
}

function placeOf(a?: NonNullable<PhotoItem["additional"]>["address"]): string | undefined {
  if (!a) return undefined;
  const parts = [a.landmark, a.route, a.village ?? a.district, a.town ?? a.city, a.county, a.state, a.country].filter((p): p is string => Boolean(p));
  return [...new Set(parts)].join(", ") || undefined;
}

export function registerPhotosTools(server: McpServer, client: SynologyClient, opts: { readOnly: boolean }) {
  const READ = { readOnlyHint: true, openWorldHint: false } as const;
  const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
  const req = <T>(space: Space, api: string, method: string, params: Record<string, string | number | boolean | undefined>, version: number, timeoutMs?: number) =>
    client.request<T>(`${SPACES[space]}.${api}`, method, params, version, timeoutMs ? { timeoutMs } : {});
  /** Whole-library queries (place tree, conditional counts) took 30–50 s on 229,000 photos. */
  const SLOW = 180_000;
  const space = z.enum(["personal", "shared"]).optional();

  let me: Promise<number> | undefined;
  /** Photos' own user id (owner_user_id of personal items); 0 is the shared space. */
  const myPhotosId = () => (me ??= client.request<{ id: number }>("SYNO.Foto.UserInfo", "me", {}, V.userInfo).then((u) => u.id).catch(() => -1));

  /**
   * NAS path of each item, to open it with read_file / download_file: shared space
   * items live in /photo/<folder>, the user's own personal items in /home/Photos/<folder>.
   * Folder names come from Browse.Folder get (one call per folder, cached per request).
   */
  const withPaths = async (items: PhotoItem[]) => {
    const mine = await myPhotosId();
    const folders = new Map<string, Promise<string | undefined>>();
    const folderName = (sp: Space, id: number) => {
      const key = `${sp}:${id}`;
      if (!folders.has(key)) {
        folders.set(key, req<{ folder: { name: string } }>(sp, "Browse.Folder", "get", { id }, V.folder).then((r) => r.folder.name).catch(() => undefined));
      }
      return folders.get(key)!;
    };
    return Promise.all(
      items.map(async (i) => {
        const sp: Space | undefined = i.owner_user_id === 0 ? "shared" : i.owner_user_id === mine ? "personal" : undefined;
        const folder = sp ? await folderName(sp, i.folder_id) : undefined;
        const root = sp === "shared" ? "/photo" : "/home/Photos";
        const a = i.additional;
        return {
          id: i.id,
          filename: i.filename,
          type: i.type,
          taken: takenAt(i.time),
          size: humanSize(i.filesize),
          ...(sp && { space: sp }),
          ...(folder !== undefined && { path: `${root}${folder === "/" ? "" : folder}/${i.filename}` }),
          ...(placeOf(a?.address) && { place: placeOf(a?.address) }),
          ...(a?.resolution && { resolution: `${a.resolution.width}x${a.resolution.height}` }),
          ...(a?.exif?.camera && { camera: a.exif.camera }),
          ...(a?.description && { description: a.description }),
          ...(a?.tag?.length && { tags: a.tag.map((t) => t.name) }),
          ...(a?.rating && { rating: a.rating }),
        };
      }),
    );
  };

  /** Person lists answer 901 when face recognition has nothing (seen in the shared space). */
  const noFaces = (err: unknown) => err instanceof SynologyApiError && err.code === 901;

  server.registerTool(
    "photos_albums",
    {
      title: "Photos: albums",
      description:
        "Synology Photos albums of the user (normal and conditional albums) or shared with them: id, name, number of items, date range and whether they are shared. Use the id with photos_list to see the photos.",
      inputSchema: {
        shared_with_me: z.boolean().optional().describe("Albums others shared with the user instead of the user's own"),
        limit: z.number().int().min(1).max(500).optional().describe("Default 100"),
      },
      annotations: READ,
    },
    safe(async ({ shared_with_me, limit }) => {
      const { list } = await client.request<{ list: Album[] }>(
        "SYNO.Foto.Browse.Album",
        "list",
        { offset: 0, limit: limit ?? 100, ...(shared_with_me && { category: json("shared") }) },
        V.album,
      );
      return ok({
        total: list.length,
        albums: list.map((a) => ({
          id: a.id,
          name: a.name,
          items: a.item_count,
          type: a.type === "normal" ? "normal" : "conditional",
          ...(a.shared && { shared: true }),
          ...(a.start_time && { from: takenAt(a.start_time).slice(0, 10) }),
          ...(a.end_time && { to: takenAt(a.end_time).slice(0, 10) }),
        })),
      });
    }),
  );

  server.registerTool(
    "photos_browse",
    {
      title: "Photos: places, people, tags",
      description:
        "What Synology Photos groups the photos by, with how many photos each has: places (from GPS), people (face recognition) or tags. Use the id with photos_list (place_id, person_id, tag_id). Space shared is the /photo folder (default), personal the user's /home/Photos.",
      inputSchema: {
        kind: z.enum(["places", "people", "tags"]),
        space,
        query: z.string().optional().describe("Only names containing this text (case-insensitive)"),
        limit: z.number().int().min(1).max(1000).optional().describe("Default 100"),
      },
      annotations: READ,
    },
    safe(async ({ kind, space: sp = "shared", query, limit }) => {
      const api = kind === "places" ? "Browse.Geocoding" : kind === "people" ? "Browse.Person" : "Browse.GeneralTag";
      const version = kind === "places" ? V.geocoding : kind === "people" ? V.person : V.tag;
      let list: { id: number; name: string; item_count?: number; country?: string }[];
      try {
        list = (await req<{ list: typeof list }>(sp, api, "list", { offset: 0, limit: 5000 }, version)).list;
      } catch (err) {
        if (kind === "people" && noFaces(err)) return ok({ kind, space: sp, total: 0, items: [], note: "No people in this space: face recognition is off or has found no faces yet." });
        throw err;
      }
      const q = query?.toLowerCase();
      const items = list
        .filter((x) => !q || x.name.toLowerCase().includes(q))
        .sort((a, b) => (b.item_count ?? 0) - (a.item_count ?? 0))
        .slice(0, limit ?? 100)
        .map((x) => ({ id: x.id, name: x.name || "(unnamed)", photos: x.item_count, ...(x.country && kind === "places" && { country: x.country }) }));
      return ok({ kind, space: sp, total: list.length, items });
    }),
  );

  server.registerTool(
    "photos_list",
    {
      title: "Photos: find photos",
      description:
        "Photos and videos in Synology Photos, newest first: in an album, of a person, at a place, with a tag, between two dates, or matching a text search (file name, description, place…). Each one comes with its NAS path (open it with read_file or download_file), date taken, size, and with details: true also place, camera, resolution, description and tags. Space shared is the /photo folder (default), personal the user's /home/Photos; albums can mix both.",
      inputSchema: {
        album_id: z.number().int().optional().describe("Album id from photos_albums"),
        person_id: z.number().int().optional().describe("From photos_browse kind people"),
        place_id: z.number().int().optional().describe("From photos_browse kind places"),
        tag_id: z.number().int().optional().describe("From photos_browse kind tags"),
        keyword: z.string().min(1).optional().describe("Text search, like the Photos search box"),
        from: z.string().optional().describe("Taken on or after this date, e.g. 2024-07-01"),
        to: z.string().optional().describe("Taken on or before this date, e.g. 2024-07-31"),
        space,
        details: z.boolean().optional().describe("Add place, camera, resolution, description and tags (slower)"),
        offset: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(500).optional().describe("Default 50"),
      },
      annotations: READ,
    },
    safe(async (a) => {
      const sources = [a.album_id, a.person_id, a.place_id, a.tag_id, a.keyword].filter((x) => x !== undefined);
      if (sources.length > 1) throw new Error("Give only one of album_id, person_id, place_id, tag_id or keyword (dates can be added to any)");
      const sp: Space = a.album_id !== undefined ? "personal" : (a.space ?? "shared");
      const start = a.from ? wallClockSeconds(a.from) : undefined;
      const end = a.to ? wallClockSeconds(a.to, true) : undefined;
      const hasDates = start !== undefined || end !== undefined;
      const offset = a.offset ?? 0;
      const limit = a.limit ?? 50;
      const additional = a.details ? json(["address", "resolution", "exif", "tag", "description", "rating"]) : undefined;
      const idParam =
        a.album_id !== undefined ? { album_id: a.album_id } : a.person_id !== undefined ? { person_id: a.person_id } : a.place_id !== undefined ? { geocoding_id: a.place_id } : a.tag_id !== undefined ? { general_tag_id: a.tag_id } : undefined;

      const page = (off: number, lim: number) => {
        if (a.keyword) return req<{ list: PhotoItem[] }>(sp, "Search.Search", "list_item", { keyword: json(a.keyword), offset: off, limit: lim, additional }, V.search);
        if (idParam) return req<{ list: PhotoItem[] }>(sp, "Browse.Item", "list", { ...idParam, offset: off, limit: lim, additional }, V.item);
        if (hasDates) {
          const time = json([{ ...(start !== undefined && { start_time: start }), ...(end !== undefined && { end_time: end }) }]);
          return req<{ list: PhotoItem[] }>(sp, "Browse.Item", "list_with_filter", { time, offset: off, limit: lim, additional }, V.item);
        }
        return req<{ list: PhotoItem[] }>(sp, "Browse.Item", "list", { offset: off, limit: lim, additional }, V.item);
      };

      let items: PhotoItem[];
      let note: string | undefined;
      if (hasDates && (a.keyword || idParam)) {
        // The search ignores `time` and list_with_filter does not combine with ids reliably: filter dates here.
        const inRange = (i: PhotoItem) => (start === undefined || i.time >= start) && (end === undefined || i.time <= end);
        const matched: PhotoItem[] = [];
        let scanned = 0;
        while (scanned < SCAN_LIMIT && matched.length < offset + limit) {
          const batch = (await page(scanned, 500)).list;
          matched.push(...batch.filter(inRange));
          scanned += batch.length;
          if (batch.length < 500) break;
        }
        if (scanned >= SCAN_LIMIT) note = `Only the first ${SCAN_LIMIT} matches were checked against the dates; narrow the search for more.`;
        items = matched.slice(offset, offset + limit);
      } else {
        items = (await page(offset, limit)).list;
      }
      return ok({ space: sp, offset, returned: items.length, ...(note && { note }), items: await withPaths(items) });
    }),
  );

  if (opts.readOnly) return;

  const albumItems = z.array(z.number().int()).min(1).describe("Photo ids from photos_list");

  server.registerTool(
    "photos_create_album",
    {
      title: "Photos: create an album",
      description: "Create a normal Synology Photos album, optionally with photos (ids from photos_list; they can come from the shared or the personal space). The photos are not moved or copied.",
      inputSchema: { name: z.string().min(1).max(255), item_ids: z.array(z.number().int()).optional() },
      annotations: WRITE,
    },
    safe(async ({ name, item_ids }) => {
      const r = await client.request<{ album: Album }>(
        "SYNO.Foto.Browse.NormalAlbum",
        "create",
        { name: json(name), ...(item_ids?.length && { item: json(item_ids) }) },
        V.normalAlbum,
      );
      return ok({ id: r.album.id, name: r.album.name, items: r.album.item_count ?? item_ids?.length ?? 0 });
    }),
  );

  server.registerTool(
    "photos_album_items",
    {
      title: "Photos: add or remove album photos",
      description: "Add photos to a normal album or take them out (remove only takes them out of the album; the photos stay in the library). Conditional albums fill themselves and cannot be edited this way.",
      inputSchema: { album_id: z.number().int(), add: albumItems.optional(), remove: albumItems.optional() },
      annotations: { ...WRITE, idempotentHint: true },
    },
    safe(async ({ album_id, add, remove }) => {
      if (!add?.length && !remove?.length) throw new Error("Give add and/or remove");
      let failed: unknown[] = [];
      if (add?.length) {
        const r = await client.request<{ error_list?: unknown[] }>("SYNO.Foto.Browse.NormalAlbum", "add_item", { id: album_id, item: json(add) }, V.normalAlbum);
        failed = r.error_list ?? [];
      }
      if (remove?.length) await client.request("SYNO.Foto.Browse.NormalAlbum", "delete_item", { id: album_id, item: json(remove) }, V.normalAlbum);
      return ok({
        album_id,
        ...(add?.length && { added: add.length - failed.length }),
        ...(failed.length && { not_added: failed, note: "Some photos were not added (they may not exist or not be accessible)." }),
        ...(remove?.length && { removed: remove.length }),
      });
    }),
  );

  /** Place tree of the filter / conditional-album API (ids differ from Browse.Geocoding's). */
  interface PlaceNode {
    id: number;
    name: string;
    level: number;
    children?: PlaceNode[];
  }
  const placeTree = async (sp: Space) =>
    // ~30 s on a library of 229,000 photos.
    (await req<{ geocoding?: PlaceNode[] }>(sp, "Search.Filter", "list", { setting: json({ geocoding: true }) }, 4, SLOW)).geocoding ?? [];
  const findPlaces = (tree: PlaceNode[], name: string) => {
    const flat: { node: PlaceNode; path: string }[] = [];
    const walk = (nodes: PlaceNode[], parents: string[]) => {
      for (const n of nodes) {
        flat.push({ node: n, path: [...parents, n.name].join(" > ") });
        walk(n.children ?? [], [...parents, n.name]);
      }
    };
    walk(tree, []);
    const q = name.toLowerCase();
    const exact = flat.filter((f) => f.node.name.toLowerCase() === q);
    return exact.length ? exact : flat.filter((f) => f.node.name.toLowerCase().includes(q));
  };

  server.registerTool(
    "photos_create_condition_album",
    {
      title: "Photos: create a conditional album",
      description:
        "Create a conditional album that fills itself with every photo matching the conditions, now and in the future: a place (by name, e.g. \"Madrid\"; looking it up takes up to ~30 s on big libraries), a date range and/or a text. Says how many photos match before creating it. Space shared (default) is /photo, personal the user's /home/Photos.",
      inputSchema: {
        name: z.string().min(1).max(255),
        place: z.string().min(1).optional().describe("Place name: country, region, city or district"),
        place_id: z.number().int().optional().describe("Exact place from a previous answer's candidates, when the name is ambiguous"),
        from: z.string().optional().describe("Taken on or after, e.g. 2025-01-01"),
        to: z.string().optional().describe("Taken on or before, e.g. 2025-12-31"),
        keyword: z.string().min(1).optional().describe("Text in the file name or description"),
        space,
      },
      annotations: WRITE,
    },
    safe(async ({ name, place, place_id, from, to, keyword, space: sp = "shared" }) => {
      if (!place && place_id === undefined && !from && !to && !keyword) throw new Error("Give at least one condition: place, from/to or keyword");
      const ownerId = sp === "shared" ? 0 : await myPhotosId();
      let placeIds: number[] | undefined;
      let placeLabel: string | undefined;
      if (place_id !== undefined) placeIds = [place_id];
      else if (place) {
        const found = findPlaces(await placeTree(sp), place);
        if (!found.length) throw new Error(`No place called "${place}" in the ${sp} space's photos`);
        if (found.length > 1) {
          return ok({ created: false, note: `"${place}" matches several places: call again with place_id.`, candidates: found.slice(0, 20).map((f) => ({ place_id: f.node.id, place: f.path })) });
        }
        placeIds = [found[0].node.id];
        placeLabel = found[0].path;
      }
      const start = from ? wallClockSeconds(from) : undefined;
      const end = to ? wallClockSeconds(to, true) : undefined;
      const condition = {
        user_id: ownerId,
        // All item types, as the albums the web UI creates.
        item_type: [4, 3, 0, 2],
        ...(placeIds && { geocoding: placeIds }),
        ...((start !== undefined || end !== undefined) && { time: [{ ...(start !== undefined && { start_time: start }), ...(end !== undefined && { end_time: end }) }] }),
        ...(keyword && { keyword: [keyword] }),
      };
      const { count } = await client.request<{ count: number }>("SYNO.Foto.Browse.ConditionAlbum", "peek_item_count", { condition: json(condition) }, 4, { timeoutMs: SLOW });
      const r = await client.request<{ album: Album }>("SYNO.Foto.Browse.ConditionAlbum", "create", { name: json(name), condition: json(condition) }, 4, { timeoutMs: SLOW });
      return ok({ created: true, id: r.album.id, name: r.album.name ?? name, photos: count, ...(placeLabel && { place: placeLabel }), space: sp });
    }),
  );

  server.registerTool(
    "photos_share_album",
    {
      title: "Photos: share an album by link",
      description:
        "Turn on a public link to an album (anyone with the link can see it: view, or view and download), optionally with a password and an expiry date, or turn it off. This exposes the photos outside the NAS: confirm first.",
      inputSchema: {
        album_id: z.number().int(),
        access: z.enum(["view", "download", "off"]),
        password: z.string().min(1).max(127).optional(),
        expires: z.string().optional().describe("Date the link stops working, e.g. 2026-12-31"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    safe(async ({ album_id, access, password, expires }) => {
      if (access === "off") {
        await client.request("SYNO.Foto.Sharing.Passphrase", "set_shared", { policy: json("album"), album_id, enabled: false }, 1);
        return ok({ album_id, link: "off" });
      }
      const shared = await client.request<{ sharing_link: string; passphrase: string }>("SYNO.Foto.Sharing.Passphrase", "set_shared", { policy: json("album"), album_id, enabled: true }, 1);
      let expiration: number | undefined;
      if (expires) {
        expiration = wallClockSeconds(expires, true);
        if (expiration * 1000 < Date.now()) throw new Error(`${expires} is in the past`);
      }
      await client.request(
        "SYNO.Foto.Sharing.Passphrase",
        "update",
        {
          passphrase: json(shared.passphrase),
          permission: json([{ action: "update", role: access, member: { type: "public" } }]),
          ...(password && { password: json(password) }),
          ...(expiration !== undefined && { expiration }),
        },
        1,
      );
      return ok({ album_id, access, url: shared.sharing_link, password: Boolean(password), ...(expiration && { expires: takenAt(expiration).slice(0, 10) }) });
    }),
  );

  server.registerTool(
    "photos_edit_person",
    {
      title: "Photos: name, hide or merge people",
      description:
        "Edit a person found by face recognition: give them a name, hide or show them, or merge other people into them (same person detected twice; merging cannot be undone, confirm first). Ids from photos_browse kind people.",
      inputSchema: {
        person_id: z.number().int(),
        name: z.string().max(255).optional(),
        hidden: z.boolean().optional(),
        merge_ids: z.array(z.number().int()).min(1).optional().describe("People to merge into person_id"),
        space,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    safe(async ({ person_id, name, hidden, merge_ids, space: sp = "shared" }) => {
      if (name === undefined && hidden === undefined && !merge_ids) throw new Error("Give name, hidden or merge_ids");
      if (merge_ids?.includes(person_id)) throw new Error("merge_ids cannot include person_id itself");
      if (merge_ids) await req(sp, "Browse.Person", "merge", { target_id: person_id, merged_id: json(merge_ids), ...(name !== undefined && { name: json(name) }) }, 2);
      else if (name !== undefined) await req(sp, "Browse.Person", "set", { id: person_id, name: json(name) }, 1);
      if (hidden !== undefined) await req(sp, "Browse.Person", "show", { id: person_id, show: !hidden }, 1);
      return ok({ person_id, ...(name !== undefined && { name }), ...(hidden !== undefined && { hidden }), ...(merge_ids && { merged: merge_ids }) });
    }),
  );

  server.registerTool(
    "photos_delete_album",
    {
      title: "Photos: delete albums",
      description: "Delete Synology Photos albums. Only the albums go: the photos stay in the library. Their sharing links stop working. Confirm first.",
      inputSchema: { album_ids: z.array(z.number().int()).min(1) },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    safe(async ({ album_ids }) => {
      await client.request("SYNO.Foto.Browse.Album", "delete", { id: json(album_ids) }, V.albumWrite);
      return ok({ deleted: album_ids, note: "The photos themselves were not deleted." });
    }),
  );
}
