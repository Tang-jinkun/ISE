import {
  ViewChange,
  CameraRotate,
  CameraAlong,
  Video,
  Picture,
  Audio,
  Text,
  GeoJson,
  ImageRaster,
  Marker,
  DynamicLine,
  PlotSymbol,
  GeoJSON
} from './default_data.type';

/* =========================
 * 战例场景智能化编排数据组织结构
 * BattlExampleScene_DataStructureModel
 * ========================= */
export interface BattlExampleScene_DataStructureModel {
  war_name: string; // 战役名称
  intro: {
    content: string; // 战役简介内容
    source_cite: string[]; // 战役简介来源引用条目
  };
  /* 作战序列 Order Of Battle */
  OOB: {
    blue_force: {
      name: string; // 蓝方名称
      commander?: string; // 指挥官
      troop_strength?: number; // 兵力规模
      main_units?: string[]; // 主要作战单位
    };
    red_force: {
      name: string; // 红方名称
      commander?: string; // 指挥官
      troop_strength?: number; // 兵力规模
      main_units?: string[]; // 主要作战单位
    };
  };
  /* 全局人物&地点实体注册表 */
  entity_registry: {
    persons: {
      id: string; // 人物唯一UUID
      name: string; // 人物名称
      camp: 'blue' | 'red' | 'neutral'; // 所属阵营
      role?: string; // 角色/身份（如：主帅、谋士）
    }[];
    spaces: {
      id: string; // 空间唯一UUID
      name: string; // 地点名称
      geo?: GeoJSON; // 地理空间对象
    }[];
  };
  outline: WarOutline[]; // 叙事阶段划分
  war_meta: {
    time_range: string; //战役时间范围描述
    main_region: string; // 主要作战区域
    type: '解放军经典战役' | '古代经典战役' | '外国经典战役'; // 战役类型
  };
  tags: {
    battle_style: string; // 战役主题:火攻|水战|以少胜多
    strategic_significance: string; // 战略意义
  };
  target_duration: number; // 推荐整体展示时长(ms)
}
/* =========================
 * 战例场景叙事大纲（outline）
 * ========================= */
export interface WarOutline {
  id: string; // UUID 唯一标识
  title: string; //阶段标题
  life_cycle: '战前背景态势阶段' | '战中动态演进阶段' | '战后损益评价阶段'; // 生命周期阶段
  descriptions: WarDescription[]; // 微场景序列
  time: {
    start: number; //开始时间
    finish: number; // 结束时间
  };
  outline_meta: {
    phase: '战前' | '对峙' | '决战' | '追击' | '战后'; // 战役阶段类型
    narrative_role: '铺垫' | '发展' | '高潮' | '收束'; // 叙事功能
    strategic_focus: string; // 本阶段核心战略问题
  };
}
/* =========================
 * 战例场景微场景描述（description）
 * ========================= */
export interface WarDescription {
  id: string; // UUID 唯一标识
  title: string; //阶段标题
  summary?: string; // 场景概述
  units: WarUnit[]; // 分镜单元序列
  time: {
    start: number; //开始时间
    finish: number; // 结束时间
  };
  description_meta?: {
    location?: string; // 场景主要地点
    time_hint?: string; // 场景时间提示
    importance?: number; // 场景重要度
  };
}

/* =========================
 * 战例场景分镜单元（unit）
 * ========================= */
export interface WarUnit {
  id: string; // UUID 唯一标识
  core_content: string; // 场景核心叙述文本
  view_bbox: [
    [number, number],
    [number, number],
    [number, number],
    [number, number]
  ]; // 视角核心范围（四角经纬度坐标：左上→右上→右下→左下）
  time: {
    start: number; //单元开始时间
    finish: number; // 单元结束时间
  };
  entities: {
    times: string[]; // 时间实体（如：208年冬）
    spaces: string[]; // 空间实体（如：赤壁江面）
    persons: string[]; // 人物实体（如：周瑜、曹操）
    objects: string[]; //	事物实体（船只、火攻器具）
    events: string[]; // 事件实体（火攻、突袭）
  };
  logic_causal: {
    role?: 'cause' | 'decision' | 'action' | 'result'; // 在因果链中的角色
    description?: string; // 因果关系解释说明
    depends_on?: string[]; // 依赖的其他 Unit ID
  };
  relation: {
    id: string; // UUID 唯一标识
    entity: {
      type: 'time' | 'space' | 'person' | 'object' | 'event'; // 实体类型
      id: string; // 实体UUID
    };
    material_uuid: string; // UUID 唯一标识
  }[];
  paths: {
    viewchange?: ViewChange[]; // 视角转移轨道
    camera_rotate?: CameraRotate[]; // 视角旋转轨道
    camera_along?: CameraAlong[]; // 视角跟随轨道
    video?: Video[]; // 视频轨道
    picture?: Picture[]; // 图片轨道
    audio?: Audio[]; // 音频轨道
    text?: Text[]; // 文本/字幕轨道
    geojson?: GeoJson[]; // 矢量数据轨道
    image_raster?: ImageRaster[]; // 地理影像轨道
    marker?: Marker[]; // 地图图标轨道
    dynamic_line?: DynamicLine[]; // 动态绘制线轨道
    plot_symbol?: PlotSymbol[]; // 军事标绘轨道
    // 其他扩展轨道
  };
}
