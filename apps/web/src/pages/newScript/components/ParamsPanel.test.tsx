import { useParamsStore } from '@/stores/paramsStore';
import { useWarDataStore } from '@/stores/warDataStore';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ParamsPanel } from './ParamsPanel';

// Mock react-i18next
vi.mock('react-i18next', () => {
  return {
    useTranslation: () => ({
      t: (key: string, defaultValue?: string) => defaultValue || key
    })
  };
});

// Mock the stores
vi.mock('@/stores/warDataStore', () => ({
  useWarDataStore: vi.fn()
}));

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
  const mockData = {
    war_name: 'Test War',
    outline: [
      {
        descriptions: [
          {
            units: [
              {
                id: 'unit-1',
                core_content: 'Test Content',
                paths: {
                  video: [{ uuid: 'v1', start: 0, finish: 1000 }],
                  audio: [] // 轨道数组长度为 0
                },
                time: { start: 0, finish: 1000 }
              }
            ]
          }
        ]
      }
    ]
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useWarDataStore as any).mockReturnValue({
      currentData: mockData
    });
    (useParamsStore as any).mockReturnValue({
      showTransitions: false,
      setShowTransitions: vi.fn()
    });
  });

  it('当轨道数组长度为 0 时，隐藏该轨道的名称展示', () => {
    render(<ParamsPanel />);
    // "视频轨" 应该存在，因为长度为 1
    const videoTracks = screen.queryAllByText(/视频轨/);
    expect(videoTracks.length).toBeGreaterThan(0);

    // "音频轨" 不应该存在，因为长度为 0
    const audioTracks = screen.queryAllByText(/音频轨/);
    expect(audioTracks.length).toBe(0);
  });

  it('中文标识正确渲染', () => {
    render(<ParamsPanel />);
    expect(screen.getAllByText(/视频轨/)[0]).toBeInTheDocument();
  });

  it('映射表缺失字段时有降级提示', () => {
    const dataWithUnknownTrack = {
      ...mockData,
      outline: [
        {
          descriptions: [
            {
              units: [
                {
                  ...mockData.outline[0].descriptions[0].units[0],
                  paths: {
                    unknownTrack: [{ uuid: 'u1' }]
                  }
                }
              ]
            }
          ]
        }
      ]
    };
    (useWarDataStore as any).mockReturnValue({
      currentData: dataWithUnknownTrack
    });

    render(<ParamsPanel />);
    // 应该显示 key "unknownTrack" 作为降级名称
    const elements = screen.getAllByText(/unknownTrack/);
    expect(elements.length).toBeGreaterThan(0);
    expect(elements[0]).toBeInTheDocument();
  });
});
