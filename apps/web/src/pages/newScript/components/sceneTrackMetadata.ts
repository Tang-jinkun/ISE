export const SCENE_TRACK_TYPES = [
  'subtitle',
  'image',
  'video',
  'marker',
  'geojson',
  'camera',
  'model'
] as const;

export type SceneTrackType = (typeof SCENE_TRACK_TYPES)[number];

export const SCENE_TRACK_LABELS: Record<SceneTrackType, string> = {
  subtitle: '字幕轨',
  image: '图片轨',
  video: '视频轨',
  marker: '标注轨',
  geojson: '地理轨',
  camera: '镜头轨',
  model: '模型轨'
};

export const isSceneTrackType = (value: string): value is SceneTrackType =>
  SCENE_TRACK_TYPES.includes(value as SceneTrackType);
