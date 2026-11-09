import { useEffect, useState } from "react";
import type { CSSProperties, MouseEvent } from "react";

type Props = {
  src: string;
  color: string;
  position: number;
  duration: number;
  onSeek: (seconds: number) => void;
};

const BAR_COUNT = 160;
const peakCache = new Map<string, Promise<number[]>>();

async function loadPeaks(src: string): Promise<number[]> {
  const response = await fetch(src);
  if (!response.ok) throw new Error("Could not load waveform audio");
  const bytes = await response.arrayBuffer();
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(bytes);
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index));
    const samplesPerBar = Math.max(1, Math.ceil(decoded.length / BAR_COUNT));
    const peaks = Array.from({ length: BAR_COUNT }, (_, index) => {
      const start = index * samplesPerBar;
      const end = Math.min(decoded.length, start + samplesPerBar);
      let peak = 0;
      // Sampling avoids scanning every sample in large WAV files.
      const stride = Math.max(1, Math.floor((end - start) / 256));
      for (let sample = start; sample < end; sample += stride) {
        for (const channel of channels) peak = Math.max(peak, Math.abs(channel[sample]));
      }
      return peak;
    });
    const maxPeak = Math.max(0.001, ...peaks);
    return peaks.map((peak) => Math.max(0.045, peak / maxPeak));
  } finally {
    await context.close();
  }
}

export default function Waveform({ src, color, position, duration, onSeek }: Props) {
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setPeaks(null);
    setFailed(false);
    if (!src) return () => { active = false; };
    let pending = peakCache.get(src);
    if (!pending) {
      pending = loadPeaks(src);
      peakCache.set(src, pending);
    }
    pending.then((values) => {
      if (active) setPeaks(values);
    }).catch(() => {
      peakCache.delete(src);
      if (active) setFailed(true);
    });
    return () => { active = false; };
  }, [src]);

  const ratio = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
  function handleSeek(event: MouseEvent<HTMLButtonElement>) {
    if (!src || duration <= 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    onSeek(fraction * duration);
  }

  return (
    <button
      type="button"
      className="real-waveform"
      style={{ "--wave-color": color } as CSSProperties}
      onClick={handleSeek}
      disabled={!src || duration <= 0}
      aria-label="Seek stem by clicking its waveform"
      title={src ? "Click to seek all stems" : "Separate audio to see its waveform"}
    >
      {peaks ? (
        <svg viewBox={`0 0 ${BAR_COUNT * 3} 100`} preserveAspectRatio="none" aria-hidden="true">
          {peaks.map((peak, index) => (
            <rect key={index} x={index * 3} y={50 - peak * 44} width="2" height={Math.max(2, peak * 88)} rx="1" />
          ))}
        </svg>
      ) : (
        <span className="waveform-placeholder">{failed ? "Waveform unavailable" : src ? "Loading waveform…" : "Awaiting separation"}</span>
      )}
      <span className="waveform-playhead" style={{ left: `${ratio * 100}%` }} />
    </button>
  );
}
