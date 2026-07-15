import { cn } from '@/lib/utils';

export type EntityType = 'location' | 'person' | 'thing' | 'event' | 'time';

export const ENTITY_STYLES: Record<EntityType, string> = {
  location: 'text-primary font-bold',
  person: 'text-primary font-bold',
  thing: 'text-primary font-bold',
  event: 'text-primary font-bold',
  time: 'text-primary font-bold'
};

export function EntityHighlighter({
  text,
  entities
}: {
  text: string;
  entities?: Record<EntityType, string[]>;
}) {
  const parts: { text: string; type?: EntityType }[] = [];
  let remaining = text;

  const keywordPairs: { k: string; t: EntityType }[] = [];
  if (entities) {
    Object.entries(entities).forEach(([t, list]) => {
      if (Array.isArray(list)) {
        list.forEach((k) => {
          if (k && typeof k === 'string')
            keywordPairs.push({ k, t: t as EntityType });
        });
      }
    });
  }
  const sortedKeywords = keywordPairs
    .filter((p) => p.k.length > 0)
    .sort((a, b) => b.k.length - a.k.length);

  while (remaining) {
    let matchFound = false;
    let bestIndex = -1;
    let bestKeyword = '';
    let bestType: EntityType | undefined = undefined;

    for (const { k, t } of sortedKeywords) {
      const index = remaining.indexOf(k);
      if (index !== -1) {
        if (bestIndex === -1 || index < bestIndex) {
          bestIndex = index;
          bestKeyword = k;
          bestType = t;
        }
      }
    }

    if (bestIndex !== -1) {
      if (bestIndex > 0) {
        parts.push({ text: remaining.slice(0, bestIndex) });
      }
      parts.push({
        text: bestKeyword,
        type: bestType
      });
      remaining = remaining.slice(bestIndex + bestKeyword.length);
      matchFound = true;
    }

    if (!matchFound) {
      parts.push({ text: remaining });
      break;
    }
  }

  return (
    <span>
      {parts.map((p, i) =>
        p.type ? (
          <span key={`${p.text}-${i}`} className={cn(ENTITY_STYLES[p.type])}>
            {p.text}
          </span>
        ) : (
          <span key={`${p.text}-${i}`}>{p.text}</span>
        )
      )}
    </span>
  );
}
