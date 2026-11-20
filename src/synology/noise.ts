import noise from "noise-protocol";

/**
 * DSM 7.2 "Noise" login (SYNO.API.Auth v7), as done by the DSM web login page.
 *
 * Sessions created with the classic v6 login are refused some operations
 * (e.g. SYNO.FileStation.Compress returns 105). Sessions created through the
 * Noise_IK_25519_ChaChaPoly_BLAKE2b handshake are not.
 *
 * Flow:
 *  1. SYNO.API.Auth.Type/get sets the `_SSID` cookie: the server's static X25519 public key.
 *  2. The client runs the IK initiator handshake against that key and sends the first
 *     message (payload `{"time": <unix>}`) as `ik_message` with version=7.
 *  3. The server answers with its own `ik_message`, which completes the handshake.
 */

const b64decode = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
const b64url = (b: Uint8Array) => Buffer.from(b).toString("base64url");

export interface NoiseHandshake {
  /** Value for the `ik_message` login parameter. */
  ikMessage: string;
  /** Feed the server's `ik_message` from the login response to finish the handshake. */
  finish(serverIkMessage: string): boolean;
}

export function startNoiseHandshake(serverStaticKeyB64: string): NoiseHandshake {
  const serverKey = b64decode(serverStaticKeyB64);
  if (serverKey.length !== 32) throw new Error("Invalid _SSID server key");

  const state = noise.initialize("IK", true, Buffer.alloc(0), noise.keygen(), null, serverKey);
  const out = Buffer.alloc(512);
  noise.writeMessage(state, Buffer.from(JSON.stringify({ time: Math.floor(Date.now() / 1000) })), out);
  const ikMessage = b64url(out.subarray(0, noise.writeMessage.bytes));

  return {
    ikMessage,
    finish(serverIkMessage: string) {
      try {
        return Boolean(noise.readMessage(state, b64decode(serverIkMessage), Buffer.alloc(512)));
      } catch {
        return false;
      }
    },
  };
}

/** Extract a cookie value from Set-Cookie headers. */
export function cookieFrom(setCookies: string[], name: string): string | undefined {
  for (const c of setCookies) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    if (pair.slice(0, i).trim() === name) return pair.slice(i + 1);
  }
  return undefined;
}
