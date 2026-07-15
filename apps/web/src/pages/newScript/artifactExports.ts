import {
  type SceneProjectConfig,
  sceneProjectConfigSchema
} from '@ise/runtime-contracts';
import type { AgentArtifactView } from '@/api/agent';
import type { AgentSessionState } from '@/stores/agentSessionStore';

const ACCEPTED_EVENT_PLAN_ARTIFACT = 'ise.event-plan-accepted/v1';
const COMPILED_RUNTIME_ARTIFACT = 'ise.canonical-runtime-plan/v1';

export type ArtifactExports = {
  eventPlan?: Record<string, unknown>;
  runtimePlan?: Record<string, unknown>;
  sceneProject?: SceneProjectConfig;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function artifactData(
  artifact: AgentArtifactView | undefined
): Record<string, unknown> | undefined {
  return artifact && isRecord(artifact.data) ? artifact.data : undefined;
}

export function selectArtifactExports(
  state: AgentSessionState
): ArtifactExports {
  if (state.status !== 'completed') return {};

  const completedArtifactId = state.latestCompletedRuntimeArtifactId;
  const completedArtifact = completedArtifactId
    ? state.artifacts[completedArtifactId]
    : undefined;
  if (
    !completedArtifactId ||
    completedArtifact?.artifactId !== completedArtifactId ||
    completedArtifact.type !== COMPILED_RUNTIME_ARTIFACT ||
    completedArtifact.superseded
  ) {
    return {};
  }

  const compiledData = artifactData(completedArtifact);
  if (!compiledData) return {};

  const runtimePlan = compiledData.runtimePlan;
  if (!isRecord(runtimePlan)) return {};

  const acceptedArtifactId = runtimePlan.eventPlanArtifactId;
  if (typeof acceptedArtifactId !== 'string') return {};

  const acceptedArtifact = state.artifacts[acceptedArtifactId];
  const eventPlan = artifactData(acceptedArtifact);
  if (
    acceptedArtifact?.artifactId !== acceptedArtifactId ||
    acceptedArtifact.type !== ACCEPTED_EVENT_PLAN_ARTIFACT ||
    !eventPlan
  ) {
    return {};
  }

  const parsedSceneProject = sceneProjectConfigSchema.safeParse(
    compiledData.sceneProjectConfig
  );
  if (!parsedSceneProject.success) return {};

  const sceneProject = parsedSceneProject.data;
  if (
    sceneProject.eventPlanArtifactId !== acceptedArtifactId ||
    sceneProject.runtimePlanArtifactId !== completedArtifactId
  ) {
    return {};
  }

  return { eventPlan, runtimePlan, sceneProject };
}

export const serializeJson = (payload: unknown) =>
  `${JSON.stringify(payload, null, 2)}\n`;

export function downloadJson(filename: string, payload: unknown): void {
  const blob = new Blob([serializeJson(payload)], {
    type: 'application/json;charset=utf-8'
  });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  try {
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }
}
