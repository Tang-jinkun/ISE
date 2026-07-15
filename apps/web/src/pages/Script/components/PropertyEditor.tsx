import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

const renderInput = (value: any, onChange: (val: any) => void) => {
  const type = typeof value;

  if (type === 'boolean') {
    return (
      <div className="flex items-center h-7">
        <button
          onClick={() => onChange(!value)}
          className={cn(
            'relative inline-flex h-4 w-7 items-center rounded-full transition-colors',
            value ? 'bg-primary' : 'bg-input'
          )}
        >
          <span
            className={cn(
              'inline-block h-2.5 w-2.5 transform rounded-full bg-background transition-transform',
              value ? 'translate-x-3.5' : 'translate-x-0.5'
            )}
          />
        </button>
      </div>
    );
  }

  if (type === 'number') {
    return (
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-7 bg-transparent border-border text-xs focus:border-primary/50"
      />
    );
  }

  if (type === 'string') {
    if (/^#[0-9A-Fa-f]{6}$/.test(value) || /^#[0-9A-Fa-f]{3}$/.test(value)) {
      return (
        <div className="flex items-center gap-2">
          <div className="relative h-6 w-6 shrink-0 overflow-hidden rounded-md border border-border bg-background/5">
            <input
              type="color"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="absolute inset-0 h-[150%] w-[150%] -translate-x-1/4 -translate-y-1/4 cursor-pointer p-0 opacity-0"
            />
            <div className="h-full w-full" style={{ backgroundColor: value }} />
          </div>
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="h-7 flex-1 bg-transparent border-border text-xs font-mono uppercase focus:border-primary/50"
          />
        </div>
      );
    }
    return (
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 bg-transparent border-border text-xs focus:border-primary/50"
      />
    );
  }

  if (Array.isArray(value)) {
    if (value.length > 0 && typeof value[0] === 'number') {
      return (
        <div className="flex gap-1">
          {value.map((v, idx) => (
            <Input
              key={idx}
              type="number"
              value={v}
              onChange={(e) => {
                const newArr = [...value];
                newArr[idx] = parseFloat(e.target.value);
                onChange(newArr);
              }}
              className="h-7 min-w-0 flex-1 bg-transparent border-border text-xs focus:border-primary/50 px-1"
            />
          ))}
        </div>
      );
    }
    return (
      <Input
        value={JSON.stringify(value)}
        onChange={(e) => {
          try {
            onChange(JSON.parse(e.target.value));
          } catch {
          }
        }}
        className="h-7 bg-transparent border-border text-xs focus:border-primary/50"
      />
    );
  }

  return <span className="text-xs text-muted-foreground">Unknown type</span>;
};

export const PropertyEditor = ({
  data,
  onChange,
  level = 0
}: {
  data: any;
  onChange: (newData: any) => void;
  level?: number;
}) => {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set([]));

  useEffect(() => {
    if (level === 0 && data) {
      const initialKeys = Object.keys(data)
        .filter(
          (k) =>
            typeof data[k] === 'object' &&
            data[k] !== null &&
            !Array.isArray(data[k])
        )
        .map((k) => `${level}-${k}`);
      setExpandedKeys(new Set(initialKeys));
    }
  }, [data, level]);

  const toggleExpand = (key: string) => {
    const newKeys = new Set(expandedKeys);
    if (newKeys.has(key)) {
      newKeys.delete(key);
    } else {
      newKeys.add(key);
    }
    setExpandedKeys(newKeys);
  };

  if (!data || typeof data !== 'object') return null;

  return (
    <div className="space-y-0.5">
      {Object.entries(data).map(([key, value]) => {
        const isObject =
          typeof value === 'object' && value !== null && !Array.isArray(value);
        const uniqueKey = `${level}-${key}`;
        const isExpanded = expandedKeys.has(uniqueKey);

        const handleValueChange = (newValue: any) => {
          onChange({ ...data, [key]: newValue });
        };

        if (isObject) {
          return (
            <div key={key} className="space-y-0.5">
              <div
                className="flex items-center gap-2 px-2 py-1.5 hover:bg-background/5 rounded-md cursor-pointer select-none transition-colors"
                style={{ marginLeft: level * 8 }}
                onClick={() => toggleExpand(uniqueKey)}
              >
                {isExpanded ? (
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                )}
                <span className="text-xs font-medium text-foreground">{key}</span>
              </div>
              {isExpanded && (
                <PropertyEditor
                  data={value}
                  onChange={handleValueChange}
                  level={level + 1}
                />
              )}
            </div>
          );
        }

        return (
          <div
            key={key}
            className="flex items-center gap-3 px-2 py-1 group hover:bg-background/5 rounded-md transition-colors"
            style={{ marginLeft: level * 8 + (level > 0 ? 12 : 0) }}
          >
            <span
              className="text-xs text-muted-foreground min-w-[80px] max-w-[120px] truncate shrink-0"
              title={key}
            >
              {key}
            </span>
            <div className="flex-1 min-w-0">
              {renderInput(value, handleValueChange)}
            </div>
          </div>
        );
      })}
    </div>
  );
};
