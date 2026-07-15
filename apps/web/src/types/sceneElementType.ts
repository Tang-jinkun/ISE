export interface PictureDefaultSetting {
  left: number;
  top: number;
  pixelWidth: number;
  height: number;
  width: number;
  rotate: number;
  opacity: number;
  scale: number;
  zIndex: number;
  background: string;
  blur: string;
  animation_in: string;
  animation_out: string;
}

export interface AudioDefaultSetting {
  volume: number;
  fadeInTime: number;
  fadeOutTime: number;
  currentTime: number;
  muted: boolean;
  loop: boolean;
  speed: number;
}

export interface CameraalongDefaultSetting {
  cameraAltitude: number;
}

export interface CameraRotateDefaultSetting {
  lon: number;
  lat: number;
  zoom: number;
  pitch: number;
}

export interface DynamiclayerDefaultSetting {
  speed: number;
  keepLive: boolean;
  draw_finish: number;
  noteSwitch: boolean;
  paint: {
    line_width: number;
    line_blur: number;
    line_color: string;
    line_type: string;
    text_halo_color: string;
    text_halo_blur: number;
    text_halo_width: number;
  };
  layout: {
    line_cap: string;
    line_join: string;
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
  filter: {
    filter_operator: string;
    filter_key: string;
    filter_value: string;
  };
}

export interface GeojsonDefaultSetting {
  keepLive: boolean;
  type: string;
  noteSwitch: boolean;
  animation: string;
  paint: {
    line_width: number;
    line_blur: number;
    line_color: string;
    line_type: string;
    line_opacity: number;
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
    fill_opacity: number;
    fill_antialias: boolean;
    fill_color: string;
    fill_outline_color: string;
    fill_translate: [number, number];
    fill_translate_anchor: string;
    text_halo_color: string;
    text_halo_blur: number;
    text_halo_width: number;
  };
  layout: {
    line_cap: string;
    line_join: string;
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
  filter: {
    filter_operator: string;
    filter_key: string;
    filter_value: string;
  };
}

export interface ImageRasterDefaultSetting {
  keepLive: boolean;
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

export interface MapEaseDefaultSetting {
  lon: number;
  lat: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

export interface MarkerDefaultSetting {
  pixelWidth: number;
  height: number;
  backgroundSize: number;
  keepLive: boolean;
  file_id: string;
  features: string;
}

export interface TextDefaultSetting {
  content: string;
  purpose: string;
  animation_in: string;
  animation_out: string;
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

export interface VideoDefaultSetting {
  left: number;
  top: number;
  pixelWidth: number;
  height: number;
  zIndex: number;
  volume: number;
  fadeInTime: number;
  fadeOutTime: number;
  currentTime: number;
  muted: boolean;
  loop: boolean;
  control: boolean;
  speed: number;
}
