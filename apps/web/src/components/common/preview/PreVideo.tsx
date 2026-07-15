interface PreVideoProps {
  url: string;
}

export function PreVideo({ url }: PreVideoProps) {
  if (!url) {
    return (
      <div className="w-full h-[60vh] bg-black rounded-lg overflow-hidden flex items-center justify-center shadow-lg text-white/50">
        No Video Source
      </div>
    );
  }
  return (
    <div className="w-full h-[60vh] bg-black rounded-lg overflow-hidden flex items-center justify-center shadow-lg">
      <video
        src={url}
        controls
        className="max-w-full max-h-full"
      />
    </div>
  );
}
