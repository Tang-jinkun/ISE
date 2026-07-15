export interface TimelineStage {
  stage: string;
  start_time: string;
  end_time: string;
}

export interface SpatialFlow {
  from: string;
  to: string;
  purpose: string;
  lon?: number;
  lat?: number;
  zoom?: number;
  pitch?: number;
  bearing?: number;
  timing?: {
    start: number;
    finish: number;
  };
}

export interface SpatioTemporalContext {
  location: string;
  time: string;
  timeline: TimelineStage[];
  spatial_flow: SpatialFlow[];
}

export interface ScriptItemBase {
  start: number;
  finish: number;
}

export interface AudioScriptItem extends ScriptItemBase {
  file_id: string;
  volume: number;
  fadeInTime: number;
  fadeOutTime: number;
  currentTime: number;
  muted: boolean;
  loop: boolean;
  speed: number;
  src?: string;
}

export interface SubtitleScriptItem extends ScriptItemBase {
  content: string;
  purpose?: string;
  animation_in?: string;
  animation_out?: string;
  font_style?: {
    fontFamily: string;
    fontColor: string;
    fontOpacity: number;
    bold: boolean;
    italic: boolean;
    letterSpacing: number;
    lineSpacing: number;
    textalign: string;
    fontSize: number;
  };
  wrap_style?: {
    left: number;
    top: number;
    width: number;
    height: number;
    rotate: number;
    borderColor: string;
    borderWidth: number;
    bgOpacity: number;
    bgColor: string;
    zIndex: number;
  };
}

export interface GeojsonScriptItem extends ScriptItemBase {
  id?: string;
  file_id?: string;
  file_path?: string;
  keepLive?: boolean;
  type?: string;
  noteSwitch?: boolean;
  animation?: string;
  paint?: any;
  layout?: any;
  filter?: any;
  layerConfig?: any;
  data?: any; // The GeoJSON data itself
  [key: string]: any;
}

export interface PictureScriptItem extends ScriptItemBase {
  file_id: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  rotate?: number;
  opacity?: number;
  scale?: number;
  background?: string;
  blur?: string;
  zIndex?: number;
  animation_in?: string;
  animation_out?: string;
  src?: string;
}

export interface VideoScriptItem extends ScriptItemBase {
  file_id: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  zIndex?: number;
  volume?: number;
  fadeInTime?: number;
  fadeOutTime?: number;
  currentTime?: number;
  muted?: boolean;
  loop?: boolean;
  control?: boolean;
  speed?: number;
}

export interface Entity {
  time: string;
  space: string[];
  person: string[];
  thing: string[];
  event: string;
}

export interface MiniScene {
  core_content: string;
  subtitle: SubtitleScriptItem;
  entities: Entity;
  timing: {
    start: number;
    finish: number;
  };
  audio: AudioScriptItem;
  geojsons?: GeojsonScriptItem[];
  pictures?: PictureScriptItem[];
  videos?: VideoScriptItem[];
}

export interface Description {
  title: string;
  mini_scene: MiniScene[];
}

export interface OutlineItem {
  title: string;
  descriptions: Description[];
}

export interface WarData {
  war_name: string;
  intro: string;
  spatio_temporal_context: SpatioTemporalContext;
  relevance: string;
  outline: OutlineItem[];
}
