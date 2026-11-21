import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SynologyClient } from "../synology/client.js";
import { humanSize, ok, safe } from "./format.js";

/**
 * Surveillance Station: cameras, recordings and Home Mode. SYNO.SurveillanceStation.*
 * has an official guide (Surveillance Station Web API). Camera List v9, Recording
 * List v6 and HomeMode GetInfo v1 were checked against the real NAS (one camera,
 * no recordings); HomeMode Switch only with the mock NAS.
 */

const SS = "SYNO.SurveillanceStation";

/** Camera `status` codes, from the table in the Surveillance Station Web API guide. */
export const CAMERA_STATUS: Record<number, string> = {
  1: "normal",
  2: "deleted",
  3: "disconnected",
  4: "unavailable",
  5: "ready",
  6: "inaccessible",
  7: "disabled",
  8: "unrecognized",
  9: "setting up",
  10: "server disconnected",
  11: "migrating",
  12: "other",
  13: "storage removed",
  14: "stopping",
  15: "connection failed",
  16: "unauthorized",
  17: "RTSP error",
  18: "no video",
};

interface Camera {
  id: number;
  newName?: string;
  name?: string;
  vendor?: string;
  model?: string;
  status: number;
  enabled?: boolean;
  isDisableRec?: boolean;
  recStatus?: number;
  folder?: string;
  recordingKeepDays?: number;
  enableRecordingKeepDays?: boolean;
  recordingKeepSize?: string;
  enableRecordingKeepSize?: boolean;
}

interface Recording {
  id: number;
  cameraId?: number;
  cameraName?: string;
  startTime?: number;
  stopTime?: number;
  sizeByte?: number;
  recording?: boolean;
  eventType?: number;
}

export function registerSurveillanceTools(server: McpServer, client: SynologyClient, opts: { readOnly: boolean }) {
  const READ = { readOnlyHint: true, openWorldHint: false } as const;
  const iso = (s?: number) => (s ? new Date(s * 1000).toISOString() : undefined);

  const homeMode = () => client.request<{ on: boolean; mode_schedule_on?: boolean }>(`${SS}.HomeMode`, "GetInfo", {}, 1);

  server.registerTool(
    "surveillance_cameras",
    {
      title: "Surveillance Station: cameras",
      description:
        "Cameras in Surveillance Station: name, brand and model, status (normal, disconnected, connection failed…), whether it is enabled and recording, where it records and how long recordings are kept. Also whether Home Mode is on (in Home Mode recording and alerts usually change).",
      annotations: READ,
    },
    safe(async () => {
      const [{ cameras }, home] = await Promise.all([
        client.request<{ cameras: Camera[] }>(`${SS}.Camera`, "List", { basic: true, privCamType: 1, streamInfo: false }, 9),
        homeMode().catch(() => undefined),
      ]);
      return ok({
        total: cameras.length,
        ...(home && { home_mode: home.on }),
        cameras: cameras.map((c) => ({
          id: c.id,
          name: c.newName ?? c.name,
          camera: [c.vendor, c.model].filter(Boolean).join(" ") || undefined,
          status: CAMERA_STATUS[c.status] ?? `code ${c.status}`,
          enabled: c.enabled !== false,
          recording: c.enabled !== false && !c.isDisableRec,
          ...(c.folder && { folder: c.folder }),
          keeps: [c.enableRecordingKeepDays && `${c.recordingKeepDays} days`, c.enableRecordingKeepSize && `${c.recordingKeepSize} GB`].filter(Boolean).join(" / ") || "until the volume is full",
        })),
      });
    }),
  );

  server.registerTool(
    "surveillance_recordings",
    {
      title: "Surveillance Station: recordings",
      description: "Recent recordings, newest first: camera, start and end time, size and whether it is still recording. Optionally for one camera (ids from surveillance_cameras).",
      inputSchema: {
        camera_id: z.number().int().optional(),
        limit: z.number().int().min(1).max(200).optional().describe("Default 20"),
      },
      annotations: READ,
    },
    safe(async ({ camera_id, limit }) => {
      const r = await client.request<{ total: number; recordings: Recording[] }>(
        `${SS}.Recording`,
        "List",
        { offset: 0, limit: limit ?? 20, ...(camera_id !== undefined && { cameraIds: String(camera_id) }) },
        6,
      );
      return ok({
        total: r.total,
        recordings: r.recordings.map((x) => ({
          id: x.id,
          camera: x.cameraName ?? x.cameraId,
          start: iso(x.startTime),
          end: iso(x.stopTime),
          ...(x.sizeByte !== undefined && { size: humanSize(x.sizeByte) }),
          ...(x.recording && { recording_now: true }),
        })),
      });
    }),
  );

  if (opts.readOnly) return;

  server.registerTool(
    "surveillance_set_home_mode",
    {
      title: "Surveillance Station: Home Mode",
      description: "Turn Surveillance Station's Home Mode on (someone is home: usually fewer recordings and alerts) or off. Its scheduled switching, if any, keeps working.",
      inputSchema: { on: z.boolean() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    safe(async ({ on }) => {
      await client.request(`${SS}.HomeMode`, "Switch", { on }, 1);
      const after = await homeMode();
      return ok({ home_mode: after.on, ...(after.on !== on && { note: "Surveillance Station did not apply the change" }) });
    }),
  );
}
