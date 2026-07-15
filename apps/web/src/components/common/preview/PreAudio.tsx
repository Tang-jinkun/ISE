import { useEffect, useRef } from 'react';
import WaveSurfer from 'wavesurfer.js';

interface PreAudioProps {
  url: string;
}

export function PreAudio({ url }: PreAudioProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurfer = useRef<WaveSurfer | null>(null);

  useEffect(() => {
    if (!containerRef.current || !url) return;

    // Destroy existing instance if any
    if (wavesurfer.current) {
      wavesurfer.current.destroy();
    }

    try {
      wavesurfer.current = WaveSurfer.create({
        container: containerRef.current,
        waveColor: "rgb(0,193,205)",
        progressColor: "rgb(30,128,255)",
        cursorColor: "#ddd5e9",
        url: url,
        mediaControls: true,
        dragToSeek: true,
        autoplay: false,
      });

      wavesurfer.current.on('click', () => {
        wavesurfer.current?.play();
      });
    } catch (e) {
      console.error("Error initializing WaveSurfer:", e);
    }

    return () => {
      wavesurfer.current?.destroy();
    };
  }, [url]);

  return (
    <div className="flex flex-col justify-center items-center w-full h-[60vh] bg-secondary/10 rounded-lg p-4">
      <div ref={containerRef} className="w-full" />
    </div>
  );
}
