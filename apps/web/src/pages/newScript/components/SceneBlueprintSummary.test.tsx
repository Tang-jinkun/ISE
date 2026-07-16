import type { AgentArtifactView } from '@/api/agent';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SceneBlueprintSummary } from './SceneBlueprintSummary';

const fingerprint = `sha256:${'1'.repeat(64)}`;

const blueprint: AgentArtifactView = {
  artifactId: 'blueprint-1',
  type: 'ise.scene-blueprint/v1',
  version: 1,
  createdAt: '2026-07-16T00:00:00.000Z',
  createdBy: 'agent',
  superseded: false,
  data: {
    schemaVersion: 'ise.scene-blueprint/v1',
    blueprintId: 'blueprint:1',
    sourceNarrationPlanId: 'narration:1',
    sourceNarrationFingerprint: fingerprint,
    actorGroups: [
      {
        groupId: 'group:india-su30-adampur',
        semanticEntityRef: '苏-30MKI',
        side: 'india',
        locationRef: 'location:adampur',
        platformType: 'fighter',
        role: 'fighter-formation',
        quantityDecision: {
          value: 2,
          constraint: 'exact',
          source: 'evidence',
          evidenceRefs: ['evidence:su30'],
          reason: 'Explicit quantity adjacent to entity'
        },
        formationPattern: 'finger-four',
        leaderPolicy: 'stable-first-member',
        behaviorProfile: 'fighter-formation/v1',
        lifecycle: 'scene-persistent'
      },
      {
        groupId: 'group:pakistan-jf17-minhas',
        semanticEntityRef: 'JF-17',
        side: 'pakistan',
        locationRef: 'location:minhas',
        platformType: 'fighter',
        role: 'fighter-formation',
        quantityDecision: {
          value: 4,
          constraint: 'plural',
          source: 'default',
          evidenceRefs: [],
          defaultPolicyId: 'fighter-formation/v1',
          reason: 'No explicit quantity'
        },
        formationPattern: 'finger-four',
        leaderPolicy: 'stable-first-member',
        behaviorProfile: 'fighter-formation/v1',
        lifecycle: 'scene-persistent'
      }
    ],
    sceneBeats: [
      {
        sceneBeatId: 'scene-beat:1',
        subtitleId: 'subtitle:1',
        eventUnitId: 'event:1',
        purpose: '建立双方初始态势',
        actorRefs: ['group:india-su30-adampur'],
        behaviorIntents: ['formation_departure'],
        spatialConstraints: ['depart-from:adampur'],
        stateTransitions: ['grounded->airborne'],
        cameraIntent: 'group-frame',
        mediaIntents: ['media:satellite-overlay'],
        requiredFacts: ['evidence:su30'],
        forbiddenClaims: [],
        fidelity: 'evidence',
        priority: 'high'
      }
    ],
    diagnostics: [
      {
        code: 'RESOURCE_FALLBACK',
        severity: 'warning',
        recoverable: true,
        message: '使用默认机型资源'
      }
    ]
  }
};

const resolvedPlan: AgentArtifactView = {
  artifactId: 'resolved-1',
  type: 'ise.resolved-scene-plan/v1',
  version: 1,
  createdAt: '2026-07-16T00:00:01.000Z',
  createdBy: 'agent',
  superseded: false,
  data: {
    schemaVersion: 'ise.resolved-scene-plan/v1',
    resolvedScenePlanId: 'resolved-scene-plan:1',
    sourceBlueprintId: 'blueprint:1',
    sourceBlueprintFingerprint: fingerprint,
    trajectoryCatalogFingerprint: fingerprint,
    scenarioMappingFingerprint: fingerprint,
    resolvedActors: [
      {
        actorInstanceId: 'actor:india-su30-adampur:leader',
        actorGroupRef: 'group:india-su30-adampur',
        role: 'leader',
        ordinal: 0
      }
    ],
    resolvedLocations: ['location:adampur'],
    resolvedAssets: [
      'model:su30mki',
      'trajectory:adampur-su30-1'
    ],
    resolvedFormationBundles: [
      {
        bundleId: 'formation:india-su30-adampur',
        actorGroupRef: 'group:india-su30-adampur',
        routeAssetRefs: ['trajectory:adampur-su30-1'],
        recommendedActorCount: 1,
        role: 'fighter-formation',
        side: 'india',
        semanticTags: ['su30mki'],
        scenarioBindings: ['indo-pak/v1'],
        mappingAuthority: 'scenario_config',
        diagnostics: []
      }
    ],
    actorRouteAssignments: [
      {
        actorInstanceRef: 'actor:india-su30-adampur:leader',
        formationBundleRef: 'formation:india-su30-adampur',
        trajectoryAssetRef: 'trajectory:adampur-su30-1',
        segmentId: 'segment:india-su30:departure',
        resamplePolicy: 'preserve-source-samples',
        timeMapping: {
          mode: 'fit-window',
          startMs: 800,
          durationMs: 12_000
        },
        spatialPathMode: 'preserve',
        sourceKind: 'catalog',
        matchReason: 'Exact scenario alias and location match',
        lineage: [
          'catalog:indo-pak/v1',
          'formation:india-su30-adampur'
        ]
      }
    ],
    fallbackTrajectoryRecipes: [],
    resolvedBehaviors: ['fighter-formation/v1', 'formation_departure'],
    resolvedMedia: ['media:satellite-overlay'],
    fallbackDecisions: [],
    diagnostics: []
  }
};

describe('SceneBlueprintSummary', () => {
  it('renders exact SceneBlueprint actor, resource, and parameter fields', () => {
    const { rerender } = render(
      <SceneBlueprintSummary artifact={blueprint} view="blueprint" />
    );

    expect(screen.getByText('苏-30MKI')).toBeInTheDocument();
    expect(screen.getByText('location:adampur')).toBeInTheDocument();
    expect(screen.getByText('镜头关注 group-frame')).toBeInTheDocument();
    expect(screen.getByText('使用默认机型资源')).toBeInTheDocument();

    rerender(<SceneBlueprintSummary artifact={blueprint} view="resources" />);
    expect(screen.getByText('fighter')).toBeInTheDocument();
    expect(screen.getByText('media:satellite-overlay')).toBeInTheDocument();

    rerender(<SceneBlueprintSummary artifact={blueprint} view="params" />);
    expect(screen.getByText('2 架 · 证据')).toBeInTheDocument();
    expect(screen.getByText('4 架 · 默认策略')).toBeInTheDocument();
    expect(screen.getAllByText('finger-four')).toHaveLength(2);
    expect(screen.getAllByText('fighter-formation/v1')).toHaveLength(2);
  });

  it('renders exact ResolvedScenePlan actors, string resources, and routes', () => {
    const { rerender } = render(
      <SceneBlueprintSummary artifact={resolvedPlan} view="blueprint" />
    );

    expect(screen.getByText('actor:india-su30-adampur:leader')).toBeInTheDocument();
    expect(screen.getByText('leader · #0')).toBeInTheDocument();

    rerender(<SceneBlueprintSummary artifact={resolvedPlan} view="resources" />);
    expect(screen.getByText('model:su30mki')).toBeInTheDocument();
    expect(screen.getByText('trajectory:adampur-su30-1')).toBeInTheDocument();
    expect(screen.getByText('location:adampur')).toBeInTheDocument();
    expect(screen.getByText('media:satellite-overlay')).toBeInTheDocument();

    rerender(<SceneBlueprintSummary artifact={resolvedPlan} view="params" />);
    expect(screen.getByText('fighter-formation/v1')).toBeInTheDocument();
    expect(screen.getByText('formation_departure')).toBeInTheDocument();
    expect(screen.getByText('actor:india-su30-adampur:leader')).toBeInTheDocument();
    expect(screen.getByText('trajectory:adampur-su30-1')).toBeInTheDocument();
  });
});
