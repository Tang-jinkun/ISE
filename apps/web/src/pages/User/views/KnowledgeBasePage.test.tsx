import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import KnowledgeBasePage from './KnowledgeBasePage';

// Mock react-virtuoso
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ data, itemContent, className, style }: any) => {
    return (
      <div className={className} style={style}>
        {data.map((item: any, index: number) => (
          <div key={item.id || index}>{itemContent(index, item)}</div>
        ))}
      </div>
    );
  }
}));

// Mock Sigma since it requires a real DOM and WebGL context
vi.mock('sigma', () => {
  return {
    default: vi.fn().mockImplementation(function () {
      return {
        kill: vi.fn(),
        getCamera: () => ({
          animatedZoom: vi.fn(),
          animatedUnzoom: vi.fn()
        }),
        on: vi.fn()
      };
    })
  };
});

// Mock lucide-react icons
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lucide-react')>();
  const mockIcon = (name: string) => (props: any) => (
    <div data-testid={`icon-${name.toLowerCase()}`} {...props} />
  );

  return {
    ...actual,
    Target: mockIcon('Target'),
    Users: mockIcon('Users'),
    Info: mockIcon('Info'),
    Zap: mockIcon('Zap'),
    Activity: mockIcon('Activity'),
    MapPin: mockIcon('MapPin'),
    Database: mockIcon('Database'),
    Layers: mockIcon('Layers'),
    Search: mockIcon('Search'),
    Navigation: mockIcon('Navigation'),
    Calendar: mockIcon('Calendar'),
    ChevronRight: mockIcon('ChevronRight'),
    Shield: mockIcon('Shield'),
    Clock: mockIcon('Clock'),
    BookOpen: mockIcon('BookOpen'),
    ExternalLink: mockIcon('ExternalLink'),
    Maximize2: mockIcon('Maximize'),
    Minimize2: mockIcon('Minimize'),
    X: mockIcon('X'),
    Image: mockIcon('Image')
  };
});

describe('KnowledgeBasePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correctly with default campaign', () => {
    render(<KnowledgeBasePage />);
    // Use getAllByText and check if at least one is present
    expect(screen.getAllByText('海南岛战役').length).toBeGreaterThan(0);
    expect(screen.getByText('史料库')).toBeInTheDocument();
  });

  it('switches campaign when clicked', () => {
    render(<KnowledgeBasePage />);
    const normandyBtn = screen.getAllByText('诺曼底登陆')[0];
    fireEvent.click(normandyBtn);
    // Use getAllByText for switched campaign as well
    expect(screen.getAllByText(/诺曼底登陆/i).length).toBeGreaterThan(0);
  });

  it('filters campaign list when searching', async () => {
    render(<KnowledgeBasePage />);
    const searchInput = screen.getByPlaceholderText('快速检索战役...');
    fireEvent.change(searchInput, { target: { value: '赤壁' } });

    // Check if the filtered list contains "赤壁之战"
    expect(screen.getAllByText('赤壁之战').length).toBeGreaterThan(0);
  });

  it('handles keyboard navigation in campaign list', () => {
    render(<KnowledgeBasePage />);
    const campaigns = screen.getAllByRole('option');
    const firstCampaign = campaigns[0];

    // Focus and press Enter
    firstCampaign.focus();
    fireEvent.keyDown(firstCampaign, { key: 'Enter', code: 'Enter' });

    expect(firstCampaign).toHaveAttribute('aria-selected', 'true');
  });

  it('renders battle details correctly', () => {
    render(<KnowledgeBasePage />);
    expect(screen.getByText('战役进程分解')).toBeInTheDocument();
    // Background and other sections should be removed
    expect(screen.queryByText('背景与导火索')).not.toBeInTheDocument();
  });
});
