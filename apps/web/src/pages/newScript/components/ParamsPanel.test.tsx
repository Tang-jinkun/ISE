import { useParamsStore } from '@/stores/paramsStore';
import type { SceneProjectConfig } from '@ise/runtime-contracts';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ParamsPanel } from './ParamsPanel';
import {
  canonicalSceneConfig,
  sceneConfigWithUnsupportedAudio
} from './sceneConfig.testData';

// Mock react-i18next
vi.mock('react-i18next', () => {
  return {
    useTranslation: () => ({
      t: (key: string, defaultValue?: string) => defaultValue || key
    })
  };
});

// Mock the stores
vi.mock('@/stores/paramsStore', () => ({
  useParamsStore: vi.fn()
}));

// Mock lucide-react to avoid icon rendering issues in tests
vi.mock('lucide-react', async () => {
  const actual = await vi.importActual('lucide-react');
  return {
    ...actual,
    Activity: () => <div data-testid="icon-activity" />,
    Music: () => <div data-testid="icon-music" />,
    Type: () => <div data-testid="icon-type" />,
    Map: () => <div data-testid="icon-map" />,
    Layers: () => <div data-testid="icon-layers" />,
    MapPin: () => <div data-testid="icon-mappin" />,
    Box: () => <div data-testid="icon-box" />,
    ChevronRight: () => <div data-testid="icon-chevron" />,
    Settings2: () => <div data-testid="icon-settings" />,
    FileJson: () => <div data-testid="icon-filejson" />,
    Search: () => <div data-testid="icon-search" />,
    Sparkles: () => <div data-testid="icon-sparkles" />,
    ArrowRight: () => <div data-testid="icon-arrowright" />,
    Play: () => <div data-testid="icon-play" />
  };
});

describe('ParamsPanel', () => {
  const sceneConfig: SceneProjectConfig = {
    schemaVersion: 'ise-scene/v1',
    sourceDocumentId: 'document-1',
    eventPlanArtifactId: 'event-plan-1',
    runtimePlanArtifactId: 'runtime-plan-1',
    totalDurationMs: 1_000,
    entities: [],
    diagnostics: [],
    tracks: [
      {
        trackId: 'video-track-1',
        label: '视频轨',
        type: 'video',
        visible: true,
        items: [
          {
            id: 'video-1',
            eventUnitId: 'unit-1',
            startMs: 0,
            durationMs: 1_000,
            evidenceRefs: ['evidence-1'],
            assetId: 'video:test',
            params: {
              layout: {
                xPct: 0,
                yPct: 0,
                widthPct: 100,
                heightPct: 100,
                zIndex: 1,
                opacity: 1,
                fit: 'contain'
              },
              volume: 1,
              playbackRate: 1,
              loop: false
            }
          }
        ]
      }
    ]
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useParamsStore as any).mockReturnValue({
      showTransitions: false,
      setShowTransitions: vi.fn()
    });
  });

  it('当轨道数组长度为 0 时，隐藏该轨道的名称展示', () => {
    render(<ParamsPanel sceneConfig={sceneConfig} />);
    // "视频轨" 应该存在，因为长度为 1
    const videoTracks = screen.queryAllByText(/视频轨/);
    expect(videoTracks.length).toBeGreaterThan(0);

    // "音频轨" 不应该存在，因为长度为 0
    const audioTracks = screen.queryAllByText(/音频轨/);
    expect(audioTracks.length).toBe(0);
  });

  it('中文标识正确渲染', () => {
    render(<ParamsPanel sceneConfig={sceneConfig} />);
    expect(screen.getAllByText(/视频轨/)[0]).toBeInTheDocument();
  });

  it('ignores track types outside the canonical SceneProjectConfig taxonomy', () => {
    const dataWithUnknownTrack = {
      ...sceneConfig,
      tracks: [
        {
          ...sceneConfig.tracks[0],
          type: 'unknownTrack',
          label: 'unknownTrack'
        }
      ]
    } as unknown as SceneProjectConfig;

    render(<ParamsPanel sceneConfig={dataWithUnknownTrack} />);
    expect(screen.queryByText(/unknownTrack/)).not.toBeInTheDocument();
  });

  it('renders all and only canonical SceneProjectConfig track types', () => {
    render(<ParamsPanel sceneConfig={sceneConfigWithUnsupportedAudio} />);

    for (const label of [
      '字幕轨',
      '图片轨',
      '视频轨',
      '标注轨',
      '地理轨',
      '镜头轨',
      '模型轨'
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.queryByText('音频轨')).not.toBeInTheDocument();
    expect(screen.getByText('document-1')).toBeInTheDocument();
    expect(screen.getByText('1 UNITS')).toBeInTheDocument();
  });

  it('accepts canonical config metadata without legacy track aliases', () => {
    render(<ParamsPanel sceneConfig={canonicalSceneConfig} />);

    expect(screen.queryByText(/audioTrack|subtitleTrack|videoTrack/)).not.toBeInTheDocument();
  });
});
