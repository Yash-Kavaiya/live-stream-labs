export interface EncodeSettings {
  width: number;
  height: number;
  fps: number;
  videoKbps: number;
  audioKbps: number;
}

export const DEFAULT_ENCODE: EncodeSettings = {
  width: 1280,
  height: 720,
  fps: 30,
  videoKbps: 4000,
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
    '-fflags', '+genpts',
    '-i', 'pipe:0',

    '-map', '0:v:0',
    '-map', '0:a:0?',

    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps}`,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    '-profile:v', 'high',
    '-pix_fmt', 'yuv420p',
    '-b:v', `${videoKbps}k`,
    '-maxrate', `${videoKbps}k`,
    '-bufsize', `${videoKbps * 2}k`,
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

/** True once ffmpeg prints its first progress line, i.e. frames are flowing out. */
export function isProgressLine(line: string): boolean {
  return /frame=\s*\d+/.test(line);
}
