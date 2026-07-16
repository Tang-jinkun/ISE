import type { AgentArtifactView } from '@/api/agent';
import {
  AlertTriangle,
  Boxes,
  Clapperboard,
  SlidersHorizontal
} from 'lucide-react';

type SummaryView = 'blueprint' | 'resources' | 'params';
type DataRecord = Record<string, unknown>;

type ActorSummary = {
  id: string;
  label: string;
  quantity: number | null;
  quantitySource: string | null;
  resourceType: string | null;
};

function isRecord(value: unknown): value is DataRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function records(value: unknown): DataRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function firstString(value: DataRecord, keys: string[]): string | null {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate) return candidate;
  }
  return null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function actorQuantity(value: DataRecord): number | null {
  if (typeof value.quantity === 'number') return value.quantity;
  if (isRecord(value.quantity)) {
    for (const key of ['value', 'count', 'total']) {
      if (typeof value.quantity[key] === 'number') return value.quantity[key];
    }
  }
  return typeof value.count === 'number' ? value.count : null;
}

function actors(data: DataRecord): ActorSummary[] {
  const values = [...records(data.actorGroups), ...records(data.resolvedActors)];
  return values.map((actor, index) => ({
    id:
      firstString(actor, ['actorGroupId', 'actorId', 'id']) ??
      `actor-${index + 1}`,
    label:
      firstString(actor, [
        'label',
        'name',
        'displayName',
        'actorGroupId',
        'actorId'
      ]) ?? `演员 ${index + 1}`,
    quantity: actorQuantity(actor),
    quantitySource: firstString(actor, [
      'quantitySource',
      'quantityDecisionSource',
      'source'
    ]),
    resourceType: firstString(actor, [
      'resourceType',
      'assetType',
      'modelType',
      'type'
    ])
  }));
}

function sourceLabel(source: string | null): string {
  if (!source) return '未注明来源';
  if (source === 'default') return '默认策略';
  if (source === 'evidence') return '证据';
  if (source === 'catalog') return '资源目录';
  return source;
}

function diagnosticText(data: DataRecord): string[] {
  return records(data.diagnostics).flatMap((item) => {
    const value = firstString(item, ['message', 'summary', 'code']);
    return value ? [value] : [];
  });
}

function BlueprintView({ data }: { data: DataRecord }) {
  const actorItems = actors(data);
  const beats = records(data.sceneBeats);
  const diagnostics = diagnosticText(data);
  return (
    <div className="divide-y divide-border">
      <section className="px-4 py-3" aria-labelledby="blueprint-actors">
        <h3
          id="blueprint-actors"
          className="mb-2 text-xs font-semibold text-foreground"
        >
          实际出场对象
        </h3>
        <div className="space-y-2">
          {actorItems.map((actor) => (
            <div key={actor.id} className="flex items-center gap-3 text-xs">
              <Boxes className="h-3.5 w-3.5 shrink-0 text-cyan-600 dark:text-cyan-300" />
              <span className="min-w-0 flex-1 truncate text-foreground">
                {actor.label}
              </span>
              {actor.quantity !== null && (
                <span className="shrink-0 text-muted-foreground">
                  {actor.quantity} 架 · {sourceLabel(actor.quantitySource)}
                </span>
              )}
            </div>
          ))}
          {actorItems.length === 0 && (
            <p className="text-xs text-muted-foreground">暂无演员定义</p>
          )}
        </div>
      </section>

      <section className="px-4 py-3" aria-labelledby="blueprint-beats">
        <h3
          id="blueprint-beats"
          className="mb-2 text-xs font-semibold text-foreground"
        >
          场景段落
        </h3>
        <ol className="space-y-3">
          {beats.map((beat, index) => {
            const purpose = firstString(beat, [
              'purpose',
              'title',
              'sceneBeatId'
            ]);
            const behavior = stringList(beat.behaviorIntents)[0];
            const camera = isRecord(beat.cameraIntent)
              ? firstString(beat.cameraIntent, [
                  'attentionTarget',
                  'subject',
                  'intent'
                ])
              : null;
            return (
              <li
                key={firstString(beat, ['sceneBeatId', 'id']) ?? index}
                className="text-xs"
              >
                <div className="flex items-start gap-2">
                  <Clapperboard className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">
                      {purpose ?? `段落 ${index + 1}`}
                    </p>
                    {behavior && (
                      <p className="mt-1 text-muted-foreground">{behavior}</p>
                    )}
                    {camera && (
                      <p className="mt-1 text-muted-foreground">
                        镜头关注 {camera}
                      </p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
          {beats.length === 0 && (
            <li className="text-xs text-muted-foreground">暂无场景段落</li>
          )}
        </ol>
      </section>

      {diagnostics.length > 0 && (
        <section className="space-y-1 px-4 py-3" aria-label="资源警告">
          {diagnostics.map((text) => (
            <p
              key={text}
              className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {text}
            </p>
          ))}
        </section>
      )}
    </div>
  );
}

function ResourcesView({ data }: { data: DataRecord }) {
  const actorItems = actors(data);
  const resolvedAssets = records(data.resolvedAssets);
  const resources = [
    ...actorItems.flatMap((actor) =>
      actor.resourceType
        ? [{ id: actor.id, label: actor.label, type: actor.resourceType }]
        : []
    ),
    ...resolvedAssets.map((asset, index) => ({
      id: firstString(asset, ['assetId', 'id']) ?? `asset-${index + 1}`,
      label:
        firstString(asset, ['label', 'name', 'assetId', 'id']) ??
        `资源 ${index + 1}`,
      type:
        firstString(asset, ['resourceType', 'assetType', 'type']) ?? 'asset'
    }))
  ];
  return (
    <section className="px-4 py-3" aria-label="蓝图资源">
      <h3 className="mb-2 text-xs font-semibold text-foreground">资源需求</h3>
      <div className="divide-y divide-border">
        {resources.map((resource) => (
          <div
            key={`${resource.id}:${resource.type}`}
            className="flex items-center gap-3 py-2 text-xs"
          >
            <Boxes className="h-3.5 w-3.5 shrink-0 text-cyan-600 dark:text-cyan-300" />
            <span className="min-w-0 flex-1 truncate text-foreground">
              {resource.label}
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {resource.type}
            </span>
          </div>
        ))}
        {resources.length === 0 && (
          <p className="py-3 text-xs text-muted-foreground">暂无资源需求</p>
        )}
      </div>
    </section>
  );
}

function ParamsView({ data }: { data: DataRecord }) {
  const actorItems = actors(data);
  const profile =
    typeof data.generationProfile === 'string'
      ? data.generationProfile
      : null;
  return (
    <section className="px-4 py-3" aria-label="蓝图参数">
      <div className="mb-3 flex items-center gap-2 text-xs">
        <SlidersHorizontal className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-300" />
        <span className="font-semibold text-foreground">生成策略</span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          {profile ?? '未指定'}
        </span>
      </div>
      <div className="divide-y divide-border">
        {actorItems.map((actor) => (
          <div key={actor.id} className="flex items-center gap-3 py-2 text-xs">
            <span className="min-w-0 flex-1 truncate text-foreground">
              {actor.label}
            </span>
            <span className="shrink-0 text-muted-foreground">
              {actor.quantity !== null ? `${actor.quantity} 架` : '数量待定'} ·{' '}
              {sourceLabel(actor.quantitySource)}
            </span>
          </div>
        ))}
        {actorItems.length === 0 && (
          <p className="py-3 text-xs text-muted-foreground">暂无数量参数</p>
        )}
      </div>
    </section>
  );
}

export function SceneBlueprintSummary({
  artifact,
  view
}: {
  artifact: AgentArtifactView;
  view: SummaryView;
}) {
  const data = isRecord(artifact.data) ? artifact.data : {};
  const title =
    artifact.type === 'ise.resolved-scene-plan/v1'
      ? '解析场景计划'
      : '场景蓝图';

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label={title}>
      <header className="flex h-11 shrink-0 items-center border-b border-border px-4">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          v{artifact.version}
        </span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto thin-scrollbar">
        {view === 'blueprint' ? (
          <BlueprintView data={data} />
        ) : view === 'resources' ? (
          <ResourcesView data={data} />
        ) : (
          <ParamsView data={data} />
        )}
      </div>
    </section>
  );
}
