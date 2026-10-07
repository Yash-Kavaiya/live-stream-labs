import {
  EgressClient,
  EncodedFileOutput,
  EncodingOptionsPreset,
  StreamOutput,
  StreamProtocol,
} from 'livekit-server-sdk';
import type { JWTPayload } from 'jose';
import type { Config } from '../config';
import type { TokenSigner } from '../crypto';
import { roomName } from '../services/livekit';

export interface EgressTarget {
  destinationId: string;
  /** Full RTMP(S) URL including the stream key. */
  url: string;
}

export interface EgressStart {
  /** Relay mode: where the host's browser streams the program. */
  ingestUrl: string | null;
  /** LiveKit mode: the egress id, needed to stop it. */
  externalId: string | null;
}

/** How the composed program gets from the studio to the RTMP destinations. */
export interface EgressProvider {
  readonly mode: 'relay' | 'livekit';
  start(broadcastId: string, targets: EgressTarget[]): Promise<EgressStart>;
  stop(broadcastId: string, externalId: string | null): Promise<void>;
}

export interface IngestClaims extends JWTPayload {
  bid: string;
}

/**
 * The host's browser composes the program and streams it to a media worker, which runs ffmpeg.
 * The worker later exchanges the ingest token for the targets, so stream keys stay server-side.
 */
export class RelayEgress implements EgressProvider {
  readonly mode = 'relay';

  constructor(
    private readonly signer: TokenSigner,
    private readonly publicIngestUrl: string,
  ) {}

  async start(broadcastId: string): Promise<EgressStart> {
    const claims: IngestClaims = { bid: broadcastId };
    const token = await this.signer.sign('ingest', { ...claims }, '12h');
    return { ingestUrl: `${this.publicIngestUrl}?token=${token}`, externalId: null };
  }

  async stop(): Promise<void> {
    // The host closes the ingest socket; the worker then finalises and reports `ended`.
  }
}

/**
 * LiveKit Egress opens `/render` in headless Chrome, joins the room as a hidden participant and
 * pushes the page to RTMP. The stream no longer depends on the host's machine or upload.
 */
export class LiveKitEgress implements EgressProvider {
  readonly mode = 'livekit';
  private readonly client: EgressClient;

  constructor(private readonly config: Config) {
    const { url, apiKey, apiSecret } = config.livekit;
    this.client = new EgressClient(url.replace(/^ws/, 'http'), apiKey, apiSecret);
  }

  async start(broadcastId: string, targets: EgressTarget[]): Promise<EgressStart> {
    const info = await this.client.startRoomCompositeEgress(
      roomName(broadcastId),
      {
        stream: new StreamOutput({
          protocol: StreamProtocol.RTMP,
          urls: targets.map((t) => t.url),
        }),
        file: new EncodedFileOutput({ filepath: `recordings/${broadcastId}-{time}.mp4` }),
      },
      {
        customBaseUrl: `${this.config.webOrigin}/render`,
        encodingOptions: EncodingOptionsPreset.H264_1080P_30,
      },
    );
    return { ingestUrl: null, externalId: info.egressId };
  }

  async stop(_broadcastId: string, externalId: string | null): Promise<void> {
    if (externalId) await this.client.stopEgress(externalId);
  }
}

export function createEgressProvider(config: Config, signer: TokenSigner): EgressProvider {
  return config.egressMode === 'livekit'
    ? new LiveKitEgress(config)
    : new RelayEgress(signer, config.publicIngestUrl);
}
