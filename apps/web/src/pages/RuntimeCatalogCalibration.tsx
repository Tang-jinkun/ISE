import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ComponentType } from 'react';
import { useCallback, useState } from 'react';

export const RUNTIME_CATALOG_MODELS = [
  { assetId: 'model:j10', label: 'J-10', entityType: 'aircraft' },
  { assetId: 'model:jf17', label: 'JF-17', entityType: 'aircraft' },
  { assetId: 'model:mig29', label: 'MiG-29', entityType: 'aircraft' },
  { assetId: 'model:pl15e', label: 'PL-15E', entityType: 'missile' },
  { assetId: 'model:rafale', label: 'Rafale', entityType: 'aircraft' },
  { assetId: 'model:su30mki', label: 'Su-30MKI', entityType: 'aircraft' },
] as const;

export type RuntimeCatalogModelId = (typeof RUNTIME_CATALOG_MODELS)[number]['assetId'];

export type RuntimeModelCalibration = {
  scale: number;
  rotationOffsetDeg: [number, number, number];
  altitudeOffsetM: number;
  entityTypes: ['aircraft'] | ['missile'];
};

export type RuntimeCatalogCalibrationViewportProps = {
  assetId: RuntimeCatalogModelId;
  modelFile: File | null;
  scale: number;
  rotationOffsetDeg: [number, number, number];
  altitudeOffsetM: number;
  onModelLoaded: () => void;
};

type RuntimeCatalogCalibrationProps = {
  Viewport: ComponentType<RuntimeCatalogCalibrationViewportProps>;
  onRecord: (assetId: RuntimeCatalogModelId, calibration: RuntimeModelCalibration) => void;
};

const initialValues = {
  scale: 1,
  rotationOffsetDeg: [0, 0, 0] as [number, number, number],
  altitudeOffsetM: 0,
};

export function RuntimeCatalogCalibration({
  Viewport,
  onRecord,
}: RuntimeCatalogCalibrationProps) {
  const [assetId, setAssetId] = useState<RuntimeCatalogModelId>('model:j10');
  const [modelFile, setModelFile] = useState<File | null>(null);
  const [values, setValues] = useState(initialValues);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [checks, setChecks] = useState([false, false, false, false]);

  const resetEvidence = () => {
    setChecks([false, false, false, false]);
  };
  const handleModelLoaded = useCallback(() => setModelLoaded(true), []);
  const finiteValues =
    Number.isFinite(values.scale) &&
    values.scale > 0 &&
    values.rotationOffsetDeg.every(Number.isFinite) &&
    Number.isFinite(values.altitudeOffsetM);
  const canRecord = modelLoaded && finiteValues && checks.every(Boolean);
  const entityType = RUNTIME_CATALOG_MODELS.find((model) => model.assetId === assetId)!
    .entityType;

  const updateRotation = (index: number, value: number) => {
    const rotationOffsetDeg = [...values.rotationOffsetDeg] as [number, number, number];
    rotationOffsetDeg[index] = value;
    setValues((current) => ({ ...current, rotationOffsetDeg }));
    resetEvidence();
  };

  return (
    <div className="fixed inset-0 bg-background" data-testid="runtime-catalog-calibration">
      <Viewport
        assetId={assetId}
        modelFile={modelFile}
        scale={values.scale}
        rotationOffsetDeg={values.rotationOffsetDeg}
        altitudeOffsetM={values.altitudeOffsetM}
        onModelLoaded={handleModelLoaded}
      />
      <div className="absolute right-3 top-3 z-50 w-[min(22rem,calc(100vw-1.5rem))] border border-border bg-card/95 p-3 shadow-xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h1 className="text-sm font-semibold">Runtime model calibration</h1>
          <output className="text-xs text-muted-foreground" data-testid="calibration-load-status">
            {modelLoaded ? 'loaded' : 'waiting'}
          </output>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="col-span-2 text-xs text-muted-foreground">
            Model
            <select
              aria-label="Model"
              value={assetId}
              className="mt-1 h-8 w-full border border-input bg-background px-2 text-sm text-foreground"
              onChange={(event) => {
                setAssetId(event.target.value as RuntimeCatalogModelId);
                setModelFile(null);
                setModelLoaded(false);
                setValues(initialValues);
                resetEvidence();
              }}
            >
              {RUNTIME_CATALOG_MODELS.map((model) => (
                <option key={model.assetId} value={model.assetId}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-2 text-xs text-muted-foreground">
            Model GLB
            <Input
              key={assetId}
              type="file"
              accept=".glb,model/gltf-binary"
              aria-label="Model GLB"
              className="mt-1 h-8 py-1 text-xs"
              onChange={(event) => {
                setModelFile(event.target.files?.[0] ?? null);
                setModelLoaded(false);
                resetEvidence();
              }}
            />
          </label>
          <CalibrationNumber
            label="Scale"
            value={values.scale}
            min={0.000001}
            step="any"
            onChange={(scale) => {
              setValues((current) => ({ ...current, scale }));
              resetEvidence();
            }}
          />
          <CalibrationNumber
            label="Altitude"
            value={values.altitudeOffsetM}
            step="any"
            onChange={(altitudeOffsetM) => {
              setValues((current) => ({ ...current, altitudeOffsetM }));
              resetEvidence();
            }}
          />
          {(['Rotation X', 'Rotation Y', 'Rotation Z'] as const).map((label, index) => (
            <CalibrationNumber
              key={label}
              label={label}
              value={values.rotationOffsetDeg[index]}
              step="any"
              onChange={(value) => updateRotation(index, value)}
            />
          ))}
        </div>

        <fieldset className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-3">
          <legend className="sr-only">Calibration evidence</legend>
          {[
            'Model visible',
            'Model upright',
            'Nose aligned',
            'Reference altitude matched',
          ].map((label, index) => (
            <label key={label} className="flex items-start gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={checks[index]}
                onChange={(event) => {
                  setChecks((current) =>
                    current.map((checked, checkIndex) =>
                      checkIndex === index ? event.target.checked : checked,
                    ),
                  );
                }}
              />
              {label}
            </label>
          ))}
        </fieldset>

        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-2 text-[11px] text-muted-foreground">
          <span className="text-red-400">X axis</span>
          <span className="text-green-400">Y axis</span>
          <span className="text-cyan-300">Heading</span>
          <span className="text-yellow-300">100m reference</span>
        </div>

        <Button
          type="button"
          size="sm"
          className="mt-3 w-full"
          disabled={!canRecord}
          onClick={() =>
            onRecord(assetId, {
              ...values,
              entityTypes: [entityType],
            })
          }
        >
          Record calibration
        </Button>
      </div>
    </div>
  );
}

function CalibrationNumber({
  label,
  value,
  min,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  step: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="text-xs text-muted-foreground">
      {label}
      <Input
        type="number"
        aria-label={label}
        value={value}
        min={min}
        step={step}
        className="mt-1 h-8 text-xs tabular-nums"
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
