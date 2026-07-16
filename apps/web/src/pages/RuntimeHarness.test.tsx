import { getScene, type SceneItem } from '@/api/scene';
import { useSceneRuntime } from '@/hooks/useSceneRuntime';
import { RUNTIME_MAIN_CONFIG } from '@/runtime';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeHarness } from './RuntimeHarness';

const mapboxMock = vi.hoisted(() => {
  const instance = {
    on: vi.fn(),
    off: vi.fn(),
    remove: vi.fn(),
    resize: vi.fn(),
  };
  instance.on.mockImplementation((event: string, listener: () => void) => {
    if (event === 'load') listener();
    return instance;
  });
  const Map = vi.fn(function MapMock() {
    return instance;
  });
  return { instance, Map };
});

const mapEngineMock = vi.hoisted(() => ({
  createBaseMap: vi.fn(() => mapboxMock.instance),
}));

vi.stubGlobal('ResizeObserver', class {
  observe() {}
  disconnect() {}
});

vi.mock('@/api/scene', () => ({
  getScene: vi.fn(),
}));

vi.mock('@/config/public-env', () => ({
  mapboxToken: '',
}));

vi.mock('@/hooks/useSceneRuntime', () => ({
  useSceneRuntime: vi.fn(() => ({
    status: 'ready',
    error: null,
    currentTimeMs: 0,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    replay: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('mapbox-gl', () => ({
  default: {
    accessToken: '',
    Map: mapboxMock.Map,
  },
}));

vi.mock('@/lib/mapEngine', () => mapEngineMock);

vi.mock('./RuntimeCatalogCalibrationViewport', () => ({
  RuntimeCatalogCalibrationViewport: ({
    onModelLoaded,
  }: {
    onModelLoaded: () => void;
  }) => (
    <button type="button" onClick={onModelLoaded}>
      Mark model loaded
    </button>
  ),
}));

function scene(config: unknown): SceneItem {
  return {
    id: 'persisted-scene',
    title: 'Persisted replay',
    ownerType: 'PERSON',
    type: 'PRIVATE',
    config,
    userId: 'user-1',
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
  };
}

function renderHarness(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/runtime-harness${search}`]}>
      <RuntimeHarness />
    </MemoryRouter>,
  );
}

function expectRuntimeConfig(config: unknown) {
  expect(vi.mocked(useSceneRuntime)).toHaveBeenCalledWith(
    expect.objectContaining({ config }),
  );
}

describe('RuntimeHarness source selection', () => {
  beforeEach(() => {
    vi.mocked(getScene).mockReset();
    vi.mocked(useSceneRuntime).mockClear();
    mapboxMock.Map.mockClear();
    mapEngineMock.createBaseMap.mockClear();
  });

  it('loads sceneId before a fixture and passes its valid config to the runtime', async () => {
    vi.mocked(getScene).mockResolvedValue({
      data: scene(RUNTIME_MAIN_CONFIG),
    } as never);

    renderHarness('?fixture=runtime-catalog&sceneId=scene%2Falpha');

    await waitFor(() => expect(getScene).toHaveBeenCalledWith('scene/alpha'));
    await waitFor(() => expectRuntimeConfig(RUNTIME_MAIN_CONFIG));
  });

  it('renders an alert for an invalid persisted scene config', async () => {
    vi.mocked(getScene).mockResolvedValue({
      data: scene({ broken: true }),
    } as never);

    renderHarness('?sceneId=invalid-scene');

    expect(await screen.findByRole('alert')).toBeVisible();
    expect(getScene).toHaveBeenCalledWith('invalid-scene');
  });

  it('blocks an empty sceneId instead of falling back to a fixture', () => {
    renderHarness('?sceneId=&fixture=runtime-main');

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Invalid persisted scene ID.',
    );
    expect(getScene).not.toHaveBeenCalled();
    expect(useSceneRuntime).not.toHaveBeenCalled();
  });

  it('uses runtime-main without calling the scene API', () => {
    renderHarness('?fixture=runtime-main');

    expect(getScene).not.toHaveBeenCalled();
    expectRuntimeConfig(RUNTIME_MAIN_CONFIG);
    expect(mapEngineMock.createBaseMap).toHaveBeenCalledWith(
      expect.objectContaining({
        center: [76.8165, 30.412],
        preserveDrawingBuffer: true,
      }),
    );
  });

  it('exposes a runtime load error without adding visible diagnostic UI', () => {
    vi.mocked(useSceneRuntime).mockReturnValue({
      runtime: null,
      status: 'error',
      error: new Error('Model asset failed to load'),
      currentTimeMs: 0,
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      replay: vi.fn().mockResolvedValue(undefined),
      seek: vi.fn().mockResolvedValue(undefined),
    });

    renderHarness('?fixture=runtime-main');

    expect(screen.getByTestId('runtime-status')).toHaveAttribute(
      'data-error-message',
      'Model asset failed to load',
    );
    expect(screen.queryByText('Model asset failed to load')).not.toBeInTheDocument();
  });

  it('isolates runtime-catalog calibration from the normal runtime controller', () => {
    renderHarness('?fixture=runtime-catalog&calibration=1');

    expect(screen.getByTestId('runtime-catalog-calibration')).toBeVisible();
    expect(useSceneRuntime).not.toHaveBeenCalled();
  });

  it('retains calibration records in the runtime-catalog route session', () => {
    renderHarness('?fixture=runtime-catalog&calibration=1');

    fireEvent.change(screen.getByLabelText('Model GLB'), {
      target: {
        files: [new File(['glTF'], 'J-10.glb', { type: 'model/gltf-binary' })],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Mark model loaded' }));
    fireEvent.change(screen.getByLabelText('Scale'), { target: { value: '2.5' } });
    fireEvent.change(screen.getByLabelText('Rotation X'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Rotation Y'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('Rotation Z'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Altitude'), { target: { value: '40' } });
    for (const name of [
      'Model visible',
      'Model upright',
      'Nose aligned',
      'Reference altitude matched',
    ]) {
      fireEvent.click(screen.getByRole('checkbox', { name }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Record calibration' }));

    expect(screen.getByTestId('calibration-progress')).toHaveTextContent('1 / 6');
    expect(JSON.parse(screen.getByTestId('calibration-records').textContent ?? '')).toEqual({
      'model:j10': {
        scale: 2.5,
        rotationOffsetDeg: [10, 20, 30],
        altitudeOffsetM: 40,
        entityTypes: ['aircraft'],
      },
    });
  });
});
