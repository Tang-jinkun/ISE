import type {
  AudioDefaultSetting,
  CameraRotateDefaultSetting,
  CameraalongDefaultSetting,
  DynamiclayerDefaultSetting,
  GeojsonDefaultSetting,
  ImageRasterDefaultSetting,
  MapEaseDefaultSetting,
  MarkerDefaultSetting,
  PictureDefaultSetting,
  TextDefaultSetting,
  VideoDefaultSetting
} from '@/types/sceneElementType';

// 场景实例基础配置 (exclude:start,finish,fileId)
export const pictureItemDefault: PictureDefaultSetting = {
  left: 50,
  top: 50,
  pixelWidth: 200,
  height: 200,
  rotate: 0,
  opacity: 1,
  scale: 1,
  zIndex: 1,
  width: 200,
  background: 'null',
  blur: '0px',
  animation_in: '',
  animation_out: ''
};

export const audioItemDefault: AudioDefaultSetting = {
  volume: 0.6,
  fadeInTime: 0,
  fadeOutTime: 0,
  currentTime: 0,
  muted: false,
  loop: false,
  speed: 1
};

export const cameraAlongItemDefault: CameraalongDefaultSetting = {
  cameraAltitude: 5000
};

export const cameraRotateItemDefault: CameraRotateDefaultSetting = {
  lon: 117.365,
  lat: 32.182,
  zoom: 7.08,
  pitch: 31.206280407732994
};

export const dynamicLayerItemDefault: DynamiclayerDefaultSetting = {
  // 基础属性
  speed: 130,
  keepLive: true,
  draw_finish: 3500,
  noteSwitch: false,
  //paint
  paint: {
    // line paint
    line_width: 2,
    line_blur: 0,
    line_color: '#000000',
    line_type: 'solid',
    // 注记 paint
    text_halo_color: '#FFD700',
    text_halo_blur: 0,
    text_halo_width: 0
  },
  layout: {
    // line layout
    line_cap: 'butt',
    line_join: 'miter',
    // 注记 layout
    text_field: '',
    text_font: 'Arial Unicode MS Regular',
    text_size: 16,
    text_color: '#000000',
    text_model: 'none',
    text_opacity: 0,
    text_anchor: 'center',
    text_justify: 'center',
    text_offset: [0, 0],
    text_rotate: 0
  },
  // filter
  filter: {
    filter_operator: '',
    filter_key: '',
    filter_value: ''
  }
};

export const geojsonItemDefault: GeojsonDefaultSetting = {
  // 基础属性
  keepLive: false,
  type: 'line',
  noteSwitch: false,
  animation: '',
  // paint
  paint: {
    //line
    line_width: 5,
    line_blur: 0,
    line_color: '#000000',
    line_type: 'solid',
    line_opacity: 1,
    // point
    circle_opacity: 1,
    circle_radius: 5,
    circle_color: '#000000',
    circle_blur: 0,
    circle_translate: [0, 0],
    circle_translate_anchor: 'map',
    circle_pitch_scale: 'map',
    circle_pitch_alignment: 'map',
    circle_stroke_width: 0,
    circle_stroke_color: '#000000',
    circle_stroke_opacity: 1,
    // fill
    fill_opacity: 1,
    fill_antialias: true,
    fill_color: '#000000',
    fill_outline_color: '#000000',
    fill_translate: [0, 0],
    fill_translate_anchor: 'map',
    // paint
    text_halo_color: '#FFD700',
    text_halo_blur: 0,
    text_halo_width: 0
  },
  // layout
  layout: {
    //line
    line_cap: 'butt',
    line_join: 'miter',
    // 注记
    text_field: '',
    text_font: 'Arial Unicode MS Regular',
    text_size: 16,
    text_color: '#000000',
    text_model: 'none',
    text_opacity: 1,
    text_anchor: 'center',
    text_justify: 'center',
    text_offset: [0, 0],
    text_rotate: 0
  },
  // filter
  filter: {
    filter_operator: '',
    filter_key: '',
    filter_value: ''
  }
};

export const imageRasterItemDefault: ImageRasterDefaultSetting = {
  keepLive: false,
  paint: {
    imageRasterOpacity: 1,
    imageRasterContrast: 0,
    imageRasterSaturation: 0,
    imagerasterRotate: 0,
    imagerasterMinBright: 0,
    imagerasterMaxBright: 1,
    imagerasterResamling: 'linear',
    imagerasterFadeDuration: 0
  }
};

export const mapEaseItemDefault: MapEaseDefaultSetting = {
  lon: 117.365,
  lat: 32.182,
  zoom: 7.08,
  pitch: 31.206280407732994,
  bearing: 21.5999999999996
};

export const markerItemDefault: MarkerDefaultSetting = {
  pixelWidth: 100,
  height: 100,
  backgroundSize: 100,
  keepLive: false,
  file_id: '',
  features: ''
  // features: [
  //   {
  //     type: "Feature",
  //     properties: {
  //       description: "平型关",
  //     },
  //     geometry: {
  //       type: "Point",
  //       coordinates: [113.90439, 39.30814],
  //     },
  //   },
  //   {
  //     type: "Feature",
  //     properties: {
  //       description: "太原",
  //     },
  //     geometry: {
  //       type: "Point",
  //       coordinates: [112.54209642380653, 37.83549216826424],
  //     },
  //   },
  // ],
};

export const textItemDefault: TextDefaultSetting = {
  // 基础属性
  content: '默认文本',
  purpose: 'text',
  //进阶设置
  animation_in: '',
  animation_out: '',
  // 字体样式
  font_style: {
    fontFamily: 'Microsoft Yahei',
    fontColor: '#000000',
    fontOpacity: 1,
    bold: false,
    italic: false,
    letterSpacing: 1,
    lineSpacing: 1,
    textalign: 'left',
    fontSize: 24
  },
  // 容器样式
  wrap_style: {
    left: 50,
    top: 50,
    width: 100,
    height: 20,
    rotate: 0,
    borderColor: '#000000',
    borderWidth: 0,
    bgOpacity: 1,
    bgColor: 'null',
    zIndex: 3
  }
};

export const videoItemDefault: VideoDefaultSetting = {
  left: 50,
  top: 50,
  pixelWidth: 500,
  height: 600,
  zIndex: 2,
  volume: 0.6,
  fadeInTime: 0,
  fadeOutTime: 0,
  currentTime: 0,
  muted: false,
  loop: false,
  control: false,
  //进阶设置
  speed: 1
};
