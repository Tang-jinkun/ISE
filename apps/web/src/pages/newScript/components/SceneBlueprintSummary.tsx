import type { AgentArtifactView } from '@/api/agent';
import {
  AlertTriangle,
  Boxes,
  Clapperboard,
  Route,
  SlidersHorizontal
} from 'lucide-react';

type SummaryView = 'blueprint' | 'resources' | 'params';
type DataRecord = Record<string, unknown>;

type QuantityDecision = {
  value: number;
  constraint: string;
  source: string;
  evidenceRefs: string[];
  reason: string;
  defaultPolicyId?: string;
};

type BlueprintActor = {
  groupId: string;
  semanticEntityRef: string;
  side: string;
  locationRef: string;
  platformType: string;
  role: string;
  quantityDecision: QuantityDecision;
  formationPattern: string;
  leaderPolicy: string;
  behaviorProfile: string;
  lifecycle: string;
};

type ResolvedActor = {
  actorInstanceId: string;
  actorGroupRef: string;
  role: string;
  ordinal: number;
};

function isRecord(value: unknown): value is DataRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function records(value: unknown): DataRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function stringField(value: DataRecord, key: string): string | null {
  return typeof value[key] === 'string' && value[key]
    ? value[key]
    : null;
}

function numberField(value: DataRecord, key: string): number | null {
  return typeof value[key] === 'number' ? value[key] : null;
}

function quantityDecision(value: unknown): QuantityDecision | null {
  if (!isRecord(value)) return null;
  const amount = numberField(value, 'value');
  const constraint = stringField(value, 'constraint');
  const source = stringField(value, 'source');
  const reason = stringField(value, 'reason');
  if (amount === null || !constraint || !source || !reason) return null;
  const defaultPolicyId = stringField(value, 'defaultPolicyId');
  return {
    value: amount,
    constraint,
    source,
    evidenceRefs: strings(value.evidenceRefs),
    reason,
    ...(defaultPolicyId ? { defaultPolicyId } : {})
  };
}

function blueprintActors(data: DataRecord): BlueprintActor[] {
  return records(data.actorGroups).flatMap((actor) => {
    const groupId = stringField(actor, 'groupId');
    const semanticEntityRef = stringField(actor, 'semanticEntityRef');
    const side = stringField(actor, 'side');
    const locationRef = stringField(actor, 'locationRef');
    const platformType = stringField(actor, 'platformType');
    const role = stringField(actor, 'role');
    const decision = quantityDecision(actor.quantityDecision);
    const formationPattern = stringField(actor, 'formationPattern');
    const leaderPolicy = stringField(actor, 'leaderPolicy');
    const behaviorProfile = stringField(actor, 'behaviorProfile');
    const lifecycle = stringField(actor, 'lifecycle');
    if (
      !groupId ||
      !semanticEntityRef ||
      !side ||
      !locationRef ||
      !platformType ||
      !role ||
      !decision ||
      !formationPattern ||
      !leaderPolicy ||
      !behaviorProfile ||
      !lifecycle
    ) {
      return [];
    }
    return [
      {
        groupId,
        semanticEntityRef,
        side,
        locationRef,
        platformType,
        role,
        quantityDecision: decision,
        formationPattern,
        leaderPolicy,
        behaviorProfile,
        lifecycle
      }
    ];
  });
}

function resolvedActors(data: DataRecord): ResolvedActor[] {
  return records(data.resolvedActors).flatMap((actor) => {
    const actorInstanceId = stringField(actor, 'actorInstanceId');
    const actorGroupRef = stringField(actor, 'actorGroupRef');
    const role = stringField(actor, 'role');
    const ordinal = numberField(actor, 'ordinal');
    return actorInstanceId && actorGroupRef && role && ordinal !== null
      ? [{ actorInstanceId, actorGroupRef, role, ordinal }]
      : [];
  });
}

function sourceLabel(source: string): string {
  if (source === 'evidence') return '证据';
  if (source === 'user') return '用户指定';
  if (source === 'default') return '默认策略';
  return source;
}

function diagnosticText(data: DataRecord): string[] {
  return records(data.diagnostics).flatMap((item) => {
    const value = stringField(item, 'message') ?? stringField(item, 'code');
    return value ? [value] : [];
  });
}

function ActorList({ data, resolved }: { data: DataRecord; resolved: boolean }) {
  const groups = blueprintActors(data);
  const instances = resolvedActors(data);
  const empty = resolved ? instances.length === 0 : groups.length === 0;
  return (
    <section className="px-4 py-3" aria-labelledby="blueprint-actors">
      <h3
        id="blueprint-actors"
        className="mb-2 text-xs font-semibold text-foreground"
      >
        实际出场对象
      </h3>
      <div className="space-y-3">
        {resolved
          ? instances.map((actor) => (
              <div key={actor.actorInstanceId} className="flex items-start gap-3 text-xs">
                <Boxes className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-600 dark:text-cyan-300" />
                <div className="min-w-0 flex-1">
                  <p className="break-all font-mono text-[11px] text-foreground">
                    {actor.actorInstanceId}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                    <span>{actor.role} · #{actor.ordinal}</span>
                    <span>{actor.actorGroupRef}</span>
                  </div>
                </div>
              </div>
            ))
          : groups.map((actor) => (
              <div key={actor.groupId} className="flex items-start gap-3 text-xs">
                <Boxes className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-600 dark:text-cyan-300" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground">
                    {actor.semanticEntityRef}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                    <span>{actor.side}</span>
                    <span>{actor.locationRef}</span>
                    <span>{actor.role}</span>
                  </div>
                </div>
                <span className="shrink-0 text-muted-foreground">
                  {actor.quantityDecision.value} 架 ·{' '}
                  {sourceLabel(actor.quantityDecision.source)}
                </span>
              </div>
            ))}
        {empty && <p className="text-xs text-muted-foreground">暂无演员定义</p>}
      </div>
    </section>
  );
}

function BlueprintView({ data, resolved }: { data: DataRecord; resolved: boolean }) {
  const beats = records(data.sceneBeats);
  const diagnostics = diagnosticText(data);
  return (
    <div className="divide-y divide-border">
      <ActorList data={data} resolved={resolved} />

      {resolved ? (
        <section className="px-4 py-3" aria-label="解析范围">
          <h3 className="mb-2 text-xs font-semibold text-foreground">解析范围</h3>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>{resolvedActors(data).length} 个演员实例</span>
            <span>{records(data.resolvedFormationBundles).length} 个编队资源包</span>
            {stringField(data, 'sourceBlueprintId') && (
              <span>{stringField(data, 'sourceBlueprintId')}</span>
            )}
          </div>
        </section>
      ) : (
        <section className="px-4 py-3" aria-labelledby="blueprint-beats">
          <h3
            id="blueprint-beats"
            className="mb-2 text-xs font-semibold text-foreground"
          >
            场景段落
          </h3>
          <ol className="space-y-3">
            {beats.map((beat, index) => {
              const purpose = stringField(beat, 'purpose');
              const behavior = strings(beat.behaviorIntents)[0];
              const camera = stringField(beat, 'cameraIntent');
              return (
                <li
                  key={stringField(beat, 'sceneBeatId') ?? index}
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
      )}

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

function ResourcesView({ data, resolved }: { data: DataRecord; resolved: boolean }) {
  const resources = resolved
    ? [
        ...strings(data.resolvedAssets).map((value) => ({ type: '资源', value })),
        ...strings(data.resolvedLocations).map((value) => ({ type: '位置', value })),
        ...strings(data.resolvedMedia).map((value) => ({ type: '媒体', value }))
      ]
    : [
        ...unique(blueprintActors(data).map((actor) => actor.platformType)).map(
          (value) => ({ type: '平台', value })
        ),
        ...unique(
          records(data.sceneBeats).flatMap((beat) => strings(beat.mediaIntents))
        ).map((value) => ({ type: '媒体', value }))
      ];
  return (
    <section className="px-4 py-3" aria-label="蓝图资源">
      <h3 className="mb-2 text-xs font-semibold text-foreground">资源需求</h3>
      <div className="divide-y divide-border">
        {resources.map((resource) => (
          <div
            key={`${resource.type}:${resource.value}`}
            className="flex items-center gap-3 py-2 text-xs"
          >
            <Boxes className="h-3.5 w-3.5 shrink-0 text-cyan-600 dark:text-cyan-300" />
            <span className="min-w-0 flex-1 break-all font-mono text-[11px] text-foreground">
              {resource.value}
            </span>
            <span className="shrink-0 text-[10px] text-muted-foreground">
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

function BlueprintParams({ data }: { data: DataRecord }) {
  const actors = blueprintActors(data);
  return (
    <div className="divide-y divide-border">
      {actors.map((actor) => (
        <section key={actor.groupId} className="px-4 py-3">
          <div className="flex items-center gap-3 text-xs">
            <span className="min-w-0 flex-1 font-medium text-foreground">
              {actor.semanticEntityRef}
            </span>
            <span className="shrink-0 text-muted-foreground">
              {actor.quantityDecision.value} 架 ·{' '}
              {sourceLabel(actor.quantityDecision.source)}
            </span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-[10px] text-muted-foreground">
            <span>{actor.formationPattern}</span>
            <span>{actor.behaviorProfile}</span>
            <span>{actor.leaderPolicy}</span>
            <span>{actor.lifecycle}</span>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            {actor.quantityDecision.constraint} · {actor.quantityDecision.reason}
          </p>
        </section>
      ))}
      {actors.length === 0 && (
        <p className="px-4 py-3 text-xs text-muted-foreground">暂无数量参数</p>
      )}
    </div>
  );
}

function ResolvedParams({ data }: { data: DataRecord }) {
  const behaviors = strings(data.resolvedBehaviors);
  const routes = records(data.actorRouteAssignments).flatMap((assignment) => {
    const actorInstanceRef = stringField(assignment, 'actorInstanceRef');
    const trajectoryAssetRef = stringField(assignment, 'trajectoryAssetRef');
    return actorInstanceRef && trajectoryAssetRef
      ? [{ actorInstanceRef, trajectoryAssetRef }]
      : [];
  });
  return (
    <div className="divide-y divide-border">
      <section className="px-4 py-3" aria-label="解析行为">
        <h3 className="mb-2 text-xs font-semibold text-foreground">行为配置</h3>
        <div className="flex flex-wrap gap-x-4 gap-y-2 font-mono text-[10px] text-muted-foreground">
          {behaviors.map((behavior) => (
            <span key={behavior}>{behavior}</span>
          ))}
          {behaviors.length === 0 && <span>暂无行为配置</span>}
        </div>
      </section>
      <section className="px-4 py-3" aria-label="演员航迹分配">
        <h3 className="mb-2 text-xs font-semibold text-foreground">演员航迹</h3>
        <div className="space-y-3">
          {routes.map((route) => (
            <div key={route.actorInstanceRef} className="flex items-start gap-2 text-xs">
              <Route className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-600 dark:text-cyan-300" />
              <div className="min-w-0 font-mono text-[10px]">
                <p className="break-all text-foreground">{route.actorInstanceRef}</p>
                <p className="mt-1 break-all text-muted-foreground">
                  {route.trajectoryAssetRef}
                </p>
              </div>
            </div>
          ))}
          {routes.length === 0 && (
            <p className="text-xs text-muted-foreground">暂无航迹分配</p>
          )}
        </div>
      </section>
    </div>
  );
}

function ParamsView({ data, resolved }: { data: DataRecord; resolved: boolean }) {
  return (
    <section aria-label="蓝图参数">
      <header className="flex h-10 items-center gap-2 border-b border-border px-4 text-xs">
        <SlidersHorizontal className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-300" />
        <span className="font-semibold text-foreground">
          {resolved ? '解析参数' : '生成参数'}
        </span>
      </header>
      {resolved ? <ResolvedParams data={data} /> : <BlueprintParams data={data} />}
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
  const resolved = artifact.type === 'ise.resolved-scene-plan/v1';
  const title = resolved ? '解析场景计划' : '场景蓝图';

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
          <BlueprintView data={data} resolved={resolved} />
        ) : view === 'resources' ? (
          <ResourcesView data={data} resolved={resolved} />
        ) : (
          <ParamsView data={data} resolved={resolved} />
        )}
      </div>
    </section>
  );
}
