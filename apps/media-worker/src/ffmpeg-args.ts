export interface EncodeSettings {
  width: number;
  height: number;
  fps: number;
  videoKbps: number;
  audioKbps: number;
}

/**
 * 1080p at 30 frames a second. 6000 kbit/s is the most Twitch accepts and is within what YouTube,
 * Facebook, LinkedIn and X ask for at this size, so one encode serves every platform.
 */
export const DEFAULT_ENCODE: EncodeSettings = {
  width: 1920,
  height: 1080,
  fps: 30,
  videoKbps: 6000,
  audioKbps: 160,
};

export interface TeeOutput {
  format: 'flv' | 'mp4';
  url: string;
}

/** `|` separates tee outputs and `\` and `'` are its quoting characters, so all three are escaped. */
function escapeTee(url: string): string {
  return url.replace(/\\/g, '/').replace(/(['|])/g, '\\$1');
}

export function teeSpec(outputs: TeeOutput[]): string {
  return outputs
    .map(({ format, url }) => {
      // Fragmented MP4 stays playable even if ffmpeg is killed mid-stream.
      const options =
        format === 'mp4'
          ? 'f=mp4:movflags=frag_keyframe+empty_moov+default_base_moof:onfail=ignore'
          : 'f=flv:flvflags=no_duration_filesize:onfail=ignore';
      return `[${options}]${escapeTee(url)}`;
    })
    .join('|');
}

/**
 * One encode, many outputs. The program arrives on stdin as the browser's MediaRecorder stream
 * (WebM); it is transcoded once to H.264 + AAC and the tee muxer copies that to every output.
 * `onfail=ignore` keeps the other outputs running when one destination drops.
 */
export function buildFfmpegArgs(outputs: TeeOutput[], encode: EncodeSettings = DEFAULT_ENCODE): string[] {
  if (outputs.length === 0) throw new Error('At least one output is required');
  const { width, height, fps, videoKbps, audioKbps } = encode;
  const gop = fps * 2; // Platforms want a keyframe every 2 seconds.

  return [
    '-hide_banner',
    '-loglevel', 'info',
    '-fflags', '+genpts+nobuffer',
    // A live pipe: take the codec parameters from the container header instead of waiting for
    // megabytes of data. A quiet scene sends so little that default probing can take a minute.
    '-probesize', '64k',
    '-analyzeduration', '0',
    '-i', 'pipe:0',

    '-map', '0:v:0',
    '-map', '0:a:0?',

    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps}`,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    '-profile:v', 'high',
    '-pix_fmt', 'yuv420p',
    // A constant bitrate. Left to itself the encoder sends almost nothing for a picture that does
    // not move (a holding screen, a news graphic, someone listening): about 50 kbit/s where the
    // platform was promised 6000. YouTube reports that as "not receiving enough video" and viewers
    // see buffering. `nal-hrd=cbr` pads the stream so the rate never sags, which is what every
    // platform's ingest guide asks for.
    '-b:v', `${videoKbps}k`,
    '-minrate', `${videoKbps}k`,
    '-maxrate', `${videoKbps}k`,
    '-bufsize', `${videoKbps}k`,
    '-x264-params', 'nal-hrd=cbr:force-cfr=1',
    '-g', String(gop),
    '-keyint_min', String(gop),
    '-sc_threshold', '0',

    '-af', 'aresample=async=1:first_pts=0',
    '-c:a', 'aac',
    '-b:a', `${audioKbps}k`,
    '-ar', '44100',
    '-ac', '2',

    '-flags', '+global_header',
    '-f', 'tee',
    teeSpec(outputs),
  ];
}

/** `Slave muxer #1 failed: ...` → 1. The index matches the order of `outputs`. */
export function parseFailedOutput(line: string): number | null {
  const match = /Slave muxer #(\d+) failed/.exec(line);
  return match ? Number(match[1]) : null;
}

export interface Progress {
  frame: number;
  /** Frames encoded per second, averaged since the start. */
  fps: number;
  /** Stream time over real time: 1 keeps up, less falls behind. Null until ffmpeg knows. */
  speed: number | null;
}

/** `frame= 1234 fps= 30 ... speed=1.00x` → the numbers. Null for any other line. */
export function parseProgress(line: string): Progress | null {
  const frame = /frame=\s*(\d+)/.exec(line);
  const fps = /fps=\s*([\d.]+)/.exec(line);
  if (!frame || !fps) return null;
  const speed = /speed=\s*([\d.]+)x/.exec(line);
  return { frame: Number(frame[1]), fps: Number(fps[1]), speed: speed ? Number(speed[1]) : null };
}

/** True once ffmpeg prints its first progress line, i.e. frames are flowing out. */
export function isProgressLine(line: string): boolean {
  return /frame=\s*\d+/.test(line);
}
