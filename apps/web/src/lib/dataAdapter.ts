import {
  type BattlExampleScene_DataStructureModel,
  type WarDescription,
  type WarOutline,
  type WarUnit
} from '@/mock/core.type';
import { type WarData } from '@/mock/types';

/**
 * 将 313mock (BattlExampleScene_DataStructureModel) 转换为 WarDataDisplay 所需的 WarData 格式
 * 这是一个适配器，用于让新版数据结构在旧版显示组件中正常工作
 */
export function adaptNewToOld(newData: BattlExampleScene_DataStructureModel): WarData {
  const outline: any[] = newData.outline.map((o: WarOutline) => ({
    title: o.title,
    descriptions: o.descriptions.map((d: WarDescription) => ({
      title: d.title,
      mini_scene: d.units.map((u: WarUnit) => ({
        core_content: u.core_content,
        timing: {
          start: u.time.start,
          finish: u.time.finish
        },
        subtitle: u.paths.text?.[0] || { content: '', start: u.time.start, finish: u.time.finish },
        entities: {
          time: `${u.time.start}ms - ${u.time.finish}ms`,
          space: u.entities.spaces || [],
          person: u.entities.persons || [],
          thing: u.entities.objects || [],
          event: u.entities.events?.[0] || ''
        },
        audio: u.paths.audio?.[0] || {
          file_id: '',
          volume: 1,
          fadeInTime: 0,
          fadeOutTime: 0,
          currentTime: 0,
          muted: false,
          loop: false,
          speed: 1,
          start: u.time.start,
          finish: u.time.finish
        },
        geojsons: u.paths.geojson || [],
        pictures: u.paths.picture || [],
        videos: u.paths.video || []
      }))
    }))
  }));

  return {
    war_name: newData.war_name,
    intro: newData.intro?.content || '',
    relevance: '', // 适配字段
    spatio_temporal_context: {
      location: newData.war_meta?.main_region || '',
      time: newData.war_meta?.time_range || '',
      timeline: newData.outline.map(o => ({
        stage: o.title,
        start_time: o.time.start.toString(),
        end_time: o.time.finish.toString()
      })),
      spatial_flow: [] // 适配字段
    },
    outline
  };
}
