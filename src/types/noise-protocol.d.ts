declare module "noise-protocol" {
  interface KeyPair {
    publicKey: Uint8Array;
    secretKey: Uint8Array;
  }
  interface HandshakeState {
    readonly __brand: "HandshakeState";
  }
  interface Split {
    tx: Uint8Array;
    rx: Uint8Array;
  }
  interface WriteMessage {
    (state: HandshakeState, payload: Uint8Array, messageBuffer: Uint8Array): Split | undefined;
    bytes: number;
  }
  interface ReadMessage {
    (state: HandshakeState, message: Uint8Array, payloadBuffer: Uint8Array): Split | undefined;
    bytes: number;
  }
  const noise: {
    keygen(): KeyPair;
    initialize(
      pattern: string,
      initiator: boolean,
      prologue: Uint8Array,
      staticKeys?: KeyPair | null,
      ephemeralKeys?: KeyPair | null,
      remoteStaticKey?: Uint8Array | null,
    ): HandshakeState;
    writeMessage: WriteMessage;
    readMessage: ReadMessage;
    destroy(state: HandshakeState): void;
  };
  export default noise;
}
