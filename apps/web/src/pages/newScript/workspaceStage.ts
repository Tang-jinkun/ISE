import type {
  AgentArtifactView,
  AgentTurnView,
  ReviewTuple
} from '@/api/agent';

export type WorkspaceTab =
  | 'event-plan'
  | 'narration'
  | 'blueprint'
  | 'assets'
  | 'params'
  | 'preview';

export type WorkspaceStateInput = {
  artifacts: AgentArtifactView[];
  activeReview: ReviewTuple | null;
  latestTurnStatus: AgentTurnView['status'] | undefined;
  completedRuntimeArtifactId: string | null;
};

export type WorkspaceState = {
  visible: boolean;
  defaultTab: WorkspaceTab | null;
  availableTabs: WorkspaceTab[];
  eventPlan?: AgentArtifactView;
  narration?: AgentArtifactView;
  blueprint?: AgentArtifactView;
  runtime?: AgentArtifactView;
  failed: boolean;
};

const ROLE_TYPES = {
  eventPlan: new Set([
    'ise.event-plan-draft/v1',
    'ise.event-plan-accepted/v1',
    'ise.event-plan/v2'
  ]),
  narration: new Set([
    'ise.narrative-plan/v1',
    'ise.narration-plan/v1'
  ]),
  blueprint: new Set([
    'ise.scene-blueprint/v1',
    'ise.resolved-scene-plan/v1'
  ]),
  runtime: new Set([
    'ise.canonical-runtime-plan/v1',
    'ise.scene-project-config/v2'
  ])
} as const;

function newest(
  artifacts: AgentArtifactView[],
  types: ReadonlySet<string>
): AgentArtifactView | undefined {
  return artifacts
    .filter((artifact) => !artifact.superseded && types.has(artifact.type))
    .sort((left, right) => {
      const byTime = right.createdAt.localeCompare(left.createdAt);
      return byTime || right.version - left.version;
    })[0];
}

export function selectWorkspaceState(
  input: WorkspaceStateInput
): WorkspaceState {
  const eventPlan = newest(input.artifacts, ROLE_TYPES.eventPlan);
  const narration = newest(input.artifacts, ROLE_TYPES.narration);
  const blueprint = newest(input.artifacts, ROLE_TYPES.blueprint);
  const runtimeCandidates = input.artifacts.filter(
    (artifact) =>
      !artifact.superseded && ROLE_TYPES.runtime.has(artifact.type)
  );
  const runtime =
    runtimeCandidates.find(
      (artifact) => artifact.artifactId === input.completedRuntimeArtifactId
    ) ?? newest(runtimeCandidates, ROLE_TYPES.runtime);

  const availableTabs: WorkspaceTab[] = [];
  if (eventPlan) availableTabs.push('event-plan');
  if (narration) availableTabs.push('narration');
  if (blueprint) availableTabs.push('blueprint');
  if (runtime) availableTabs.push('assets', 'params', 'preview');

  let defaultTab: WorkspaceTab | null = null;
  if (input.activeReview && eventPlan) defaultTab = 'event-plan';
  else if (runtime) defaultTab = 'preview';
  else if (blueprint) defaultTab = 'blueprint';
  else if (narration) defaultTab = 'narration';
  else if (eventPlan) defaultTab = 'event-plan';

  return {
    visible: availableTabs.length > 0,
    defaultTab,
    availableTabs,
    ...(eventPlan ? { eventPlan } : {}),
    ...(narration ? { narration } : {}),
    ...(blueprint ? { blueprint } : {}),
    ...(runtime ? { runtime } : {}),
    failed: input.latestTurnStatus === 'failed'
  };
}
