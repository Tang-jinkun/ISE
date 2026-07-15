import { mapboxToken } from '@/config/public-env';
import mapboxgl from 'mapbox-gl';
import type { MutableRefObject } from 'react';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { RuntimeCatalogCalibrationViewportProps } from './RuntimeCatalogCalibration';

const center: [number, number] = [0, 0];
const metersPerDegree = 111_319.49079327358;
const degrees = (meters: number) => meters / metersPerDegree;

const blankStyle: mapboxgl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    {
      id: 'calibration-background',
      type: 'background',
      paint: { 'background-color': '#09111f' },
    },
  ],
};

const referenceLines: GeoJSON.FeatureCollection<GeoJSON.LineString> = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { kind: 'axis-x' },
      geometry: {
        type: 'LineString',
        coordinates: [[-degrees(20), 0], [degrees(20), 0]],
      },
    },
    {
      type: 'Feature',
      properties: { kind: 'axis-y' },
      geometry: {
        type: 'LineString',
        coordinates: [[0, -degrees(20)], [0, degrees(20)]],
      },
    },
    {
      type: 'Feature',
      properties: { kind: 'heading' },
      geometry: {
        type: 'LineString',
        coordinates: [[0, 0], [0, degrees(100)]],
      },
    },
    {
      type: 'Feature',
      properties: { kind: 'reference' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, -degrees(30)],
          [degrees(100), -degrees(30)],
        ],
      },
    },
  ],
};

type GeometryEvidence = {
  nativeSize: [number, number, number];
  physicalSize: [number, number, number];
  physicalMinimumAltitudeM: number;
  groundAltitudeSuggestionM: number;
};

export function RuntimeCatalogCalibrationViewport({
  assetId,
  modelFile,
  scale,
  rotationOffsetDeg,
  altitudeOffsetM,
  onModelLoaded,
}: RuntimeCatalogCalibrationViewportProps) {
  const calibrationRootRef = useRef<HTMLDivElement | null>(null);
  const mapRootRef = useRef<HTMLDivElement | null>(null);
  const detailCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const sceneRef = useRef(new THREE.Scene());
  const cameraRef = useRef(new THREE.Camera());
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const modelRef = useRef<THREE.Group | null>(null);
  const nativeModelRef = useRef<THREE.Object3D | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [geometry, setGeometry] = useState<GeometryEvidence | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const scene = sceneRef.current;
    scene.add(new THREE.HemisphereLight(0xdbeafe, 0x172033, 2.2));
    const directional = new THREE.DirectionalLight(0xffffff, 2.8);
    directional.position.set(40, -30, 80);
    scene.add(directional);
    return () => {
      scene.remove(directional);
    };
  }, []);

  useEffect(() => {
    const root = mapRootRef.current;
    if (!root) return;
    mapboxgl.accessToken = mapboxToken;
    const map = new mapboxgl.Map({
      container: root,
      style: blankStyle,
      center,
      zoom: 18,
      pitch: 58,
      bearing: 0,
      attributionControl: false,
      antialias: true,
    });
    mapRef.current = map;

    const handleLoad = () => {
      map.addSource('calibration-reference-lines', {
        type: 'geojson',
        data: referenceLines,
      });
      for (const [kind, color, width] of [
        ['axis-x', '#ef4444', 4],
        ['axis-y', '#22c55e', 4],
        ['heading', '#22d3ee', 3],
        ['reference', '#facc15', 5],
      ] as const) {
        map.addLayer({
          id: `calibration-${kind}`,
          type: 'line',
          source: 'calibration-reference-lines',
          filter: ['==', ['get', 'kind'], kind],
          paint: {
            'line-color': color,
            'line-width': width,
          },
        });
      }
      map.addLayer({
        id: 'calibration-model',
        type: 'custom',
        renderingMode: '3d',
        onAdd: (_map, gl) => {
          rendererRef.current?.dispose();
          const renderer = new THREE.WebGLRenderer({
            canvas: map.getCanvas(),
            context: gl,
            antialias: true,
          });
          renderer.autoClear = false;
          rendererRef.current = renderer;
        },
        render: (_gl, matrix) => {
          cameraRef.current.projectionMatrix.fromArray(
            matrix as unknown as number[],
          );
          rendererRef.current?.resetState();
          rendererRef.current?.render(sceneRef.current, cameraRef.current);
          if (modelRef.current && !calibrationRootRef.current?.dataset.canvasContrast) {
            if (calibrationRootRef.current) {
              calibrationRootRef.current.dataset.canvasContrast = String(
                measureGlContrast(_gl),
              );
            }
          }
        },
        onRemove: () => {
          rendererRef.current?.dispose();
          rendererRef.current = null;
        },
      });
      setMapReady(true);
      map.resize();
    };
    map.on('load', handleLoad);
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(root);

    return () => {
      resizeObserver.disconnect();
      map.off('load', handleLoad);
      map.remove();
      mapRef.current = null;
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoadError(null);
    setGeometry(null);
    delete calibrationRootRef.current?.dataset.canvasContrast;
    removeCurrentModel(sceneRef.current, modelRef, nativeModelRef);
    if (!modelFile) return;

    const objectUrl = URL.createObjectURL(
      new Blob([modelFile], { type: 'model/gltf-binary' }),
    );
    void new GLTFLoader()
      .loadAsync(objectUrl)
      .then((gltf) => {
        if (!active) {
          disposeObject(gltf.scene);
          return;
        }
        const group = new THREE.Group();
        applyCalibrationVisibilityAid(assetId, gltf.scene);
        group.add(gltf.scene);
        nativeModelRef.current = gltf.scene;
        modelRef.current = group;
        sceneRef.current.add(group);
        setGeometry(measureGeometry(gltf.scene, scale, rotationOffsetDeg));
        applyCalibrationTransform(group, scale, rotationOffsetDeg, altitudeOffsetM);
        mapRef.current?.triggerRepaint();
        onModelLoaded();
      })
      .catch(() => {
        if (active) setLoadError(`Unable to load ${assetId}.`);
      })
      .finally(() => URL.revokeObjectURL(objectUrl));

    return () => {
      active = false;
    };
  }, [assetId, modelFile, onModelLoaded]);

  useEffect(() => {
    const model = modelRef.current;
    const nativeModel = nativeModelRef.current;
    if (!model || !nativeModel) return;
    applyCalibrationTransform(model, scale, rotationOffsetDeg, altitudeOffsetM);
    setGeometry(measureGeometry(nativeModel, scale, rotationOffsetDeg));
    delete calibrationRootRef.current?.dataset.canvasContrast;
    mapRef.current?.triggerRepaint();
  }, [altitudeOffsetM, rotationOffsetDeg, scale]);

  useEffect(() => {
    const canvas = detailCanvasRef.current;
    const nativeModel = nativeModelRef.current;
    if (assetId !== 'model:pl15e' || !canvas || !nativeModel || !geometry) return;

    const detailScene = new THREE.Scene();
    const detailModel = new THREE.Group();
    detailModel.add(nativeModel.clone(true));
    detailModel.scale.setScalar(scale);
    detailModel.rotation.set(
      THREE.MathUtils.degToRad(rotationOffsetDeg[0]),
      THREE.MathUtils.degToRad(rotationOffsetDeg[1]),
      THREE.MathUtils.degToRad(rotationOffsetDeg[2]),
      'XYZ',
    );
    detailModel.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(detailModel);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    detailModel.position.sub(center);
    detailModel.updateMatrixWorld(true);
    detailScene.add(detailModel);

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const aspect = width / height;
    const halfHeight =
      Math.max(size.y / 2, size.x / (2 * aspect), Number.EPSILON) * 1.25;
    const detailCamera = new THREE.OrthographicCamera(
      -halfHeight * aspect,
      halfHeight * aspect,
      halfHeight,
      -halfHeight,
      0.01,
      Math.max(size.z * 8, 100),
    );
    detailCamera.position.set(0, 0, Math.max(size.z * 4, 10));
    detailCamera.lookAt(0, 0, 0);
    detailCamera.updateProjectionMatrix();

    const detailRenderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    detailRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    detailRenderer.setSize(width, height, false);
    detailRenderer.setClearColor(0x000000, 0);
    detailRenderer.render(detailScene, detailCamera);

    return () => detailRenderer.dispose();
  }, [assetId, geometry, rotationOffsetDeg, scale]);

  useEffect(
    () => () => removeCurrentModel(sceneRef.current, modelRef, nativeModelRef),
    [],
  );

  return (
    <div
      ref={calibrationRootRef}
      className="absolute inset-0"
      data-testid="calibration-map"
      data-axes-ready={mapReady ? 'true' : 'false'}
      data-asset-id={assetId}
    >
      <div ref={mapRootRef} className="h-full w-full" />
      {assetId === 'model:pl15e' && geometry ? (
        <figure
          data-testid="calibration-detail"
          className="absolute left-3 top-3 z-40 w-72 border border-cyan-300/60 bg-[#09111f] shadow-xl"
        >
          <figcaption className="border-b border-cyan-300/30 px-3 py-2 text-xs font-medium text-white">
            PL-15E detail (inspection zoom)
          </figcaption>
          <div className="relative h-44 w-full overflow-hidden">
            <div className="absolute inset-y-3 left-1/2 w-px bg-cyan-300" />
            <canvas
              ref={detailCanvasRef}
              data-testid="calibration-detail-canvas"
              className="absolute inset-0 h-full w-full"
            />
          </div>
        </figure>
      ) : null}
      {geometry ? (
        <output
          data-testid="calibration-geometry"
          className="absolute bottom-3 left-3 z-40 max-w-[min(38rem,calc(100vw-1.5rem))] border border-border bg-card/90 px-3 py-2 text-xs tabular-nums text-foreground"
        >
          {JSON.stringify(geometry)}
        </output>
      ) : null}
      {loadError ? (
        <div role="alert" className="absolute bottom-3 left-3 z-50 bg-red-950 px-3 py-2 text-sm text-red-100">
          {loadError}
        </div>
      ) : null}
    </div>
  );
}

function applyCalibrationVisibilityAid(
  assetId: RuntimeCatalogCalibrationViewportProps['assetId'],
  object: THREE.Object3D,
) {
  if (assetId !== 'model:pl15e') return;
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const sourceMaterials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    const visibilityMaterials = sourceMaterials.map(
      () =>
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
    );
    child.material = Array.isArray(child.material)
      ? visibilityMaterials
      : visibilityMaterials[0]!;
    for (const material of sourceMaterials) material.dispose();
  });
}

function applyCalibrationTransform(
  group: THREE.Group,
  scale: number,
  rotationOffsetDeg: [number, number, number],
  altitudeOffsetM: number,
) {
  const mercator = mapboxgl.MercatorCoordinate.fromLngLat(center, altitudeOffsetM);
  const scaleFactor = mercator.meterInMercatorCoordinateUnits() * scale;
  group.position.set(mercator.x, mercator.y, mercator.z);
  group.scale.set(scaleFactor, -scaleFactor, scaleFactor);
  group.rotation.set(
    THREE.MathUtils.degToRad(rotationOffsetDeg[0]),
    THREE.MathUtils.degToRad(rotationOffsetDeg[1]),
    THREE.MathUtils.degToRad(rotationOffsetDeg[2]),
    'XYZ',
  );
  group.updateMatrixWorld(true);
}

function measureGeometry(
  nativeModel: THREE.Object3D,
  scale: number,
  rotationOffsetDeg: [number, number, number],
): GeometryEvidence {
  const nativeBox = new THREE.Box3().setFromObject(nativeModel);
  const nativeSize = nativeBox.getSize(new THREE.Vector3());
  const wrapper = new THREE.Group();
  wrapper.add(nativeModel.clone(true));
  wrapper.scale.set(scale, scale, scale);
  wrapper.rotation.set(
    THREE.MathUtils.degToRad(rotationOffsetDeg[0]),
    THREE.MathUtils.degToRad(rotationOffsetDeg[1]),
    THREE.MathUtils.degToRad(rotationOffsetDeg[2]),
    'XYZ',
  );
  wrapper.updateMatrixWorld(true);
  const physicalBox = new THREE.Box3().setFromObject(wrapper);
  const physicalSize = physicalBox.getSize(new THREE.Vector3());
  return {
    nativeSize: vectorTuple(nativeSize),
    physicalSize: vectorTuple(physicalSize),
    physicalMinimumAltitudeM: roundEvidence(physicalBox.min.z),
    groundAltitudeSuggestionM: roundEvidence(-physicalBox.min.z),
  };
}

function vectorTuple(vector: THREE.Vector3): [number, number, number] {
  return [
    roundEvidence(vector.x),
    roundEvidence(vector.y),
    roundEvidence(vector.z),
  ];
}

function roundEvidence(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function measureGlContrast(gl: WebGLRenderingContext | WebGL2RenderingContext) {
  const width = Math.min(192, gl.drawingBufferWidth);
  const height = Math.min(192, gl.drawingBufferHeight);
  if (width === 0 || height === 0) return 0;
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(
    Math.floor((gl.drawingBufferWidth - width) / 2),
    Math.floor((gl.drawingBufferHeight - height) / 2),
    width,
    height,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    pixels,
  );
  let minimum = 255;
  let maximum = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    minimum = Math.min(
      minimum,
      pixels[index]!,
      pixels[index + 1]!,
      pixels[index + 2]!,
    );
    maximum = Math.max(
      maximum,
      pixels[index]!,
      pixels[index + 1]!,
      pixels[index + 2]!,
    );
  }
  return maximum - minimum;
}

function removeCurrentModel(
  scene: THREE.Scene,
  modelRef: MutableRefObject<THREE.Group | null>,
  nativeModelRef: MutableRefObject<THREE.Object3D | null>,
) {
  if (modelRef.current) {
    scene.remove(modelRef.current);
    disposeObject(modelRef.current);
  }
  modelRef.current = null;
  nativeModelRef.current = null;
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) material.dispose();
  });
}
