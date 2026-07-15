export interface DynamicLine {
  // 基础属性
  uuid?: string;
  speed: number;
  keepLive: boolean;
  draw_finish: number;
  start: number;
  finish: number;
  noteSwitch: boolean;
  //paint
  paint: {
    // line paint
    line_width: number;
    line_blur: number;
    line_color: string;
    line_type: string;
    // 注记 paint
    text_halo_color: string;
    text_halo_blur: number;
    text_halo_width: number;
  };
  layout: {
    // line layout
    line_cap: string;
    line_join: string;
    // 注记 layout
    text_field: string;
    text_font: string;
    text_size: number;
    text_color: string;
    text_model: string;
    text_opacity: number;
    text_anchor: string;
    text_justify: string;
    text_offset: [number, number];
    text_rotate: number;
  };
  // filter
  filter: {
    filter_operator: string;
    filter_key: string;
    filter_value: string;
  };
}
export interface Marker {
  // 基础属性
  uuid?: string;
  width: number;
  height: number;
  backgroundSize: number;
  keepLive: boolean;
  start: number;
  finish: number;
  features: string;
  file_id: string;
}
export interface CameraRotate {
  // 基础属性
  uuid?: string;
  lon: number;
  lat: number;
  zoom: number;
  pitch: number;
  start: number;
  finish: number;
}
export interface ImageRaster {
  // 基础属性
  uuid?: string;
  keepLive: boolean;
  start: number;
  finish: number;
  // 进阶属性 paint
  paint: {
    imageRasterOpacity: number;
    imageRasterContrast: number;
    imageRasterSaturation: number;
    imagerasterRotate: number;
    imagerasterMinBright: number;
    imagerasterMaxBright: number;
    imagerasterResamling: string;
    imagerasterFadeDuration: number;
  };
}
export interface CameraAlong {
  // 基础属性
  uuid?: string;
  cameraAltitude: number;
  start: number;
  finish: number;
}
export interface Audio {
  // 基础设置
  uuid?: string;
  volume: number;
  fadeInTime: number;
  fadeOutTime: number;
  currentTime: number;
  muted: boolean;
  loop: boolean;
  start: number;
  finish: number;
  //进阶设置
  speed: number;
}
export interface Video {
  // 基础设置
  uuid?: string;
  left: number;
  top: number;
  width: number;
  height: number;
  zIndex: number;
  volume: number;
  fadeInTime: number;
  fadeOutTime: number;
  currentTime: number;
  muted: boolean;
  loop: boolean;
  start: number;
  finish: number;
  control: boolean;
  //进阶设置
  speed: number;
}
export interface GeoJson {
  // 基础属性
  uuid?: string;
  start: number;
  finish: number;
  keepLive: boolean;
  type: 'line' | 'circle' | 'fill';
  noteSwitch: boolean;
  animation: string;
  // paint
  paint: {
    //line
    line_width: number;
    line_blur: number;
    line_color: string;
    line_type: string;
    line_opacity: number;
    // point
    circle_opacity: number;
    circle_radius: number;
    circle_color: string;
    circle_blur: number;
    circle_translate: [number, number];
    circle_translate_anchor: string;
    circle_pitch_scale: string;
    circle_pitch_alignment: string;
    circle_stroke_width: number;
    circle_stroke_color: string;
    circle_stroke_opacity: number;
    // fill
    fill_opacity: number;
    fill_antialias: boolean;
    fill_color: string;
    fill_outline_color: string;
    fill_translate: [number, number];
    fill_translate_anchor: string;
    // paint
    text_halo_color: string;
    text_halo_blur: number;
    text_halo_width: number;
  };
  // layout
  layout: {
    //line
    line_cap: string;
    line_join: string;
    // 注记
    text_field: string;
    text_font: string;
    text_size: number;
    text_color: string;
    text_model: string;
    text_opacity: number;
    text_anchor: string;
    text_justify: string;
    text_offset: [number, number];
    text_rotate: number;
  };
  // filter
  filter: {
    filter_operator: string;
    filter_key: string;
    filter_value: string;
  };
}
export interface Text {
  // 基础属性
  uuid?: string;
  start: number;
  finish: number;
  purpose: 'text' | 'subtitle';
  content: string;
  //进阶设置
  animation_in: string;
  animation_out: string;
  // 字体样式
  font_style: {
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
  // 容器样式
  wrap_style: {
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
export interface ViewChange {
  uuid?: string;
  lon: number;
  lat: number;
  zoom: number;
  pitch: number;
  bearing: number;
  start: number;
  finish: number;
}
export interface Picture {
  //基础设置
  uuid?: string;
  left: number;
  top: number;
  width: number;
  height: number;
  rotate: number;
  opacity: number;
  scale: number;
  background: string;
  zIndex: number;
  blur: string;
  animation_in: string;
  animation_out: string;
  start: number;
  finish: number;
}
export interface PlotSymbol {
  uuid?: string;
  start: number;
  finish: number;
  symbol_id: string;
  points: [number, number][];
  properties?: any;
}
export interface GeoJSON {
  type: 'FeatureCollection' | 'Feature' | 'Geometry';
  features?: any[];
  geometry?: any;
  properties?: any;
}
