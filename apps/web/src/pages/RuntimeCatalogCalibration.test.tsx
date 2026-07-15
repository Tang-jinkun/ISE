import { fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  RuntimeCatalogCalibration,
  type RuntimeCatalogCalibrationViewportProps,
} from './RuntimeCatalogCalibration';

function LoadedViewport({ modelFile, onModelLoaded }: RuntimeCatalogCalibrationViewportProps) {
  useEffect(() => {
    if (modelFile) onModelLoaded();
  }, [modelFile, onModelLoaded]);
  return <div data-testid="calibration-viewport" />;
}

describe('RuntimeCatalogCalibration', () => {
  it('records a finite model calibration only after every visual check passes', () => {
    const onRecord = vi.fn();
    render(
      <RuntimeCatalogCalibration
        Viewport={LoadedViewport}
        onRecord={onRecord}
      />,
    );

    expect(
      screen.getAllByRole('option').map((option) => option.getAttribute('value')),
    ).toEqual([
      'model:j10',
      'model:jf17',
      'model:mig29',
      'model:pl15e',
      'model:rafale',
      'model:su30mki',
    ]);

    fireEvent.change(screen.getByLabelText('Model GLB'), {
      target: {
        files: [new File(['glTF'], 'J-10.glb', { type: 'model/gltf-binary' })],
      },
    });
    fireEvent.change(screen.getByLabelText('Scale'), { target: { value: '2.5' } });
    fireEvent.change(screen.getByLabelText('Rotation X'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Rotation Y'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('Rotation Z'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Altitude'), { target: { value: '40' } });

    const record = screen.getByRole('button', { name: 'Record calibration' });
    expect(record).toBeDisabled();
    for (const name of [
      'Model visible',
      'Model upright',
      'Nose aligned',
      'Reference altitude matched',
    ]) {
      fireEvent.click(screen.getByRole('checkbox', { name }));
    }
    expect(record).toBeEnabled();

    fireEvent.click(record);

    expect(onRecord).toHaveBeenCalledWith('model:j10', {
      scale: 2.5,
      rotationOffsetDeg: [10, 20, 30],
      altitudeOffsetM: 40,
      entityTypes: ['aircraft'],
    });
  });
});
