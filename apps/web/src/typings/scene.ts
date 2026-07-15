export type pathType =
  | 'picture'
  | 'video'
  | 'audio'
  | 'text'
  | 'subtitle'
  | 'camera_rotate'
  | 'mapEase'
  | 'dynamicLine'
  | 'geojson'
  | 'raster'
  | 'marker'
  | 'camera_along';

export interface InstanceInterface {
  id: string;
  start: number;
  finish: number;
  visual: boolean;
  path_type: pathType;
  fileId?: string;
  noteSwitch?: boolean;
  [key: string]: any;
}

export interface PictureInterface extends InstanceInterface {}
export interface VideoInterface extends InstanceInterface {}
export interface AudioInterface extends InstanceInterface {}
export interface TextInterface extends InstanceInterface {}
export interface SubtitleInterface extends InstanceInterface {}
export interface CameraRotateInterface extends InstanceInterface {}
export interface MapEaseInterface extends InstanceInterface {}
export interface DynamicLayerInterface extends InstanceInterface {
  draw_finish: number;
}
export interface GeojsonInterface extends InstanceInterface {
  type: string;
}
export interface RasterInterface extends InstanceInterface {}
export interface MarkerInterface extends InstanceInterface {
  bgSrc: string;
  width: number;
  height: number;
  backgroundSize: number;
}
export interface CameraAlongInterface extends InstanceInterface {
  cameraAltitude: number;
}
export interface TargetInterface extends InstanceInterface {}
export interface FlightInterface extends InstanceInterface {}
export interface MissileInterface extends InstanceInterface {}

export interface pathInterface extends InstanceInterface {}

export interface SceneContentInterface {
  id: string;
  visual: boolean;
  path_type: string;
  element_array: InstanceInterface[];
  [key: string]: any;
}
