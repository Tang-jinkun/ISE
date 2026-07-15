interface PreImageProps {
  url: string;
  alt?: string;
}

export function PreImage({ url, alt = "Image Preview" }: PreImageProps) {
  if (!url) {
    return (
      <div className="flex items-center justify-center w-full h-full min-h-[300px] bg-muted/50 rounded-lg text-muted-foreground">
        No Image Source
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center w-full h-full min-h-[300px] bg-muted/50 rounded-lg overflow-hidden">
      <img
        src={url}
        alt={alt}
        className="max-w-full max-h-[60vh] object-contain shadow-lg"
      />
    </div>
  );
}
