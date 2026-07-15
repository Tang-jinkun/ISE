import type { SceneProjectConfig } from '@ise/runtime-contracts';

const overlayLayout = {
  xPct: 0,
  yPct: 0,
  widthPct: 100,
  heightPct: 100,
  zIndex: 1,
  opacity: 1,
  fit: 'contain' as const
};

const itemBase = (id: string) => ({
  id,
  eventUnitId: 'event-unit-1',
  startMs: 0,
  durationMs: 1_000,
  evidenceRefs: ['evidence-1']
});

export const canonicalSceneConfig: SceneProjectConfig = {
  schemaVersion: 'ise-scene/v1',
  sourceDocumentId: 'document-1',
  eventPlanArtifactId: 'event-plan-1',
  runtimePlanArtifactId: 'runtime-plan-1',
  totalDurationMs: 1_000,
  entities: [
    {
      entityId: 'aircraft-1',
      displayName: 'Aircraft 1',
      kind: 'aircraft',
      modelAssetId: 'model:aircraft-1',
      initialState: 'normal'
    }
  ],
  tracks: [
    {
      trackId: 'subtitle-track',
      label: '字幕轨',
      type: 'subtitle',
      visible: true,
      items: [
        {
          ...itemBase('subtitle-1'),
          params: { text: 'Caption', position: 'bottom', maxWidthPct: 80 }
        }
      ]
    },
    {
      trackId: 'image-track',
      label: '图片轨',
      type: 'image',
      visible: true,
      items: [
        {
          ...itemBase('image-1'),
          assetId: 'image:briefing',
          params: { layout: overlayLayout, enter: 'fade', exit: 'fade' }
        }
      ]
    },
    {
      trackId: 'video-track',
      label: '视频轨',
      type: 'video',
      visible: true,
      items: [
        {
          ...itemBase('video-1'),
          assetId: 'video:clip',
          params: {
            layout: overlayLayout,
            volume: 1,
            playbackRate: 1,
            loop: false
          }
        }
      ]
    },
    {
      trackId: 'marker-track',
      label: '标注轨',
      type: 'marker',
      visible: true,
      items: [
        {
          ...itemBase('marker-1'),
          params: { coordinates: [120, 30], label: 'Target', color: '#ff0000' }
        }
      ]
    },
    {
      trackId: 'geojson-track',
      label: '地理轨',
      type: 'geojson',
      visible: true,
      items: [
        {
          ...itemBase('geojson-1'),
          assetId: 'geojson:area',
          params: {
            lineColor: '#ffffff',
            lineWidth: 1,
            fillColor: '#000000',
            fillOpacity: 0.5,
            circleColor: '#ffffff',
            circleRadius: 4,
            keepAfterEnd: false
          }
        }
      ]
    },
    {
      trackId: 'camera-track',
      label: '镜头轨',
      type: 'camera',
      visible: true,
      items: [
        {
          ...itemBase('camera-1'),
          params: {
            center: [120, 30],
            zoom: 8,
            pitch: 45,
            bearing: 0,
            easing: 'easeInOut'
          }
        }
      ]
    },
    {
      trackId: 'model-track',
      label: '模型轨',
      type: 'model',
      visible: true,
      items: [
        {
          ...itemBase('model-1'),
          params: { action: 'model.spawn', entityId: 'aircraft-1' }
        }
      ]
    }
  ],
  diagnostics: [
    {
      code: 'TEST_DIAGNOSTIC',
      severity: 'warning',
      recoverable: true,
      message: 'Track metadata warning'
    }
  ]
};

export const sceneConfigWithUnsupportedAudio = {
  ...canonicalSceneConfig,
  tracks: [
    ...canonicalSceneConfig.tracks,
    {
      trackId: 'audio-track',
      label: '音频轨',
      type: 'audio',
      visible: true,
      items: [{ ...itemBase('audio-1'), params: { volume: 1 } }]
    }
  ]
} as unknown as SceneProjectConfig;
