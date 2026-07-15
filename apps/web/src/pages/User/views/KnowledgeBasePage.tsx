import { cn } from '@/lib/utils';
import { MultiGraph } from 'graphology';
import {
  Activity,
  ChevronRight,
  Clock,
  Layers,
  MapPin,
  Maximize2,
  Minimize2,
  Navigation,
  Search,
  Target,
  Users,
  X,
  Zap
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import Sigma from 'sigma';
import battleData from './battles-extended.json';

// Types and Interfaces
export interface BattleItem {
  id: string;
  name: {
    zh: string;
    en: string;
    fr: string;
  };
  category: '中国历代' | '解放军' | '外国经典';
  time: {
    start: string;
    end: string;
    duration: string;
  };
  location: {
    name: string;
    lat: number;
    lng: number;
  };
  belligerents: {
    sideA: { name: string; strength: string };
    sideB: { name: string; strength: string };
  };
  result: string;
  historicalSignificance: string;
  details?: {
    background: string;
    course: { phase: string; content: string }[];
    commanders: {
      name: string;
      role: string;
      decision: string;
      avatar?: string;
    }[];
    innovations: string;
    losses: { official: string; academic: string };
    impact: string;
    images: string[];
    resources: { label: string; url: string }[];
  };
}

// Knowledge Category System Refactor
const CATEGORY_CONFIG: Record<
  string,
  { color: string; icon: any; label: string }
> = {
  events: {
    color: '#ef4444',
    icon: <Target className="w-4 h-4" />,
    label: '战役事件'
  },
  personnel: {
    color: '#8b5cf6',
    icon: <Users className="w-4 h-4" />,
    label: '参战人员'
  },
  forces: {
    color: '#3b82f6',
    icon: <Zap className="w-4 h-4" />,
    label: '组织装备'
  },
  context: {
    color: '#10b981',
    icon: <MapPin className="w-4 h-4" />,
    label: '时空地理'
  },
  impacts: {
    color: '#6366f1',
    icon: <Layers className="w-4 h-4" />,
    label: '战果影响'
  }
};

// Data Migration Mapping
const MIGRATION_MAP: Record<string, string> = {
  campaign: 'events',
  event: 'events',
  character: 'personnel',
  unit: 'forces',
  weapon: 'forces',
  geo: 'context',
  background: 'context',
  impact: 'impacts'
};

/**
 * Migration Helper: Normalizes legacy category IDs to the new 5-tier system
 */
const migrateData = (data: { nodes: any[]; edges: any[] }) => ({
  ...data,
  nodes: data.nodes.map((node) => ({
    ...node,
    category: MIGRATION_MAP[node.category] || node.category
  }))
});

const UI_LABELS = {
  zh: {
    library: '史料库',
    searchPlaceholder: '快速检索战役...',
    belligerents: '交战双方',
    strength: '兵力',
    result: '战役结果',
    significance: '历史意义',
    background: '背景与导火索',
    course: '战役进程分解',
    commanders: '关键指挥官',
    maps: '作战示意图',
    losses: '伤亡与损失',
    official: '官方口径',
    academic: '学术口径',
    resources: '相关资源',
    graph: '史料知识图谱',
    graphSubtitle: '知识可视化',
    graphSearchPlaceholder: '搜索人物、地点、事件...',
    phases: {
      all: '全部进程',
      prep: '准备阶段',
      sneak: '先锋偷渡',
      main: '主力强渡'
    }
  }
};

const battles: BattleItem[] = (battleData.battles as any[]) || [];

// Components
const CampaignList = ({
  selected,
  onSelect,
  searchTerm = '',
  onSearchChange
}: {
  selected: string;
  onSelect: (id: string) => void;
  searchTerm: string;
  onSearchChange: (val: string) => void;
}) => {
  const labels = UI_LABELS.zh;
  const filteredBattles = useMemo(() => {
    if (!searchTerm) return battles;
    const lower = searchTerm.toLowerCase();
    return battles.filter(
      (b) =>
        b.name.zh.toLowerCase().includes(lower) ||
        b.result.toLowerCase().includes(lower) ||
        b.historicalSignificance.toLowerCase().includes(lower)
    );
  }, [searchTerm]);

  return (
    <div
      className="w-80 flex-shrink-0 bg-card border-r border-border flex flex-col z-10"
      role="listbox"
      aria-label={labels.library}
    >
      <div className="p-6 border-b border-border bg-card/50 backdrop-blur-md">
        <div className="flex items-center gap-2 mb-4">
          <Navigation className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-black tracking-tight">
            {labels.library}
          </h2>
          <span className="text-[10px] bg-primary/10 text-primary px-2 py-1 rounded-full font-black ml-auto">
            {filteredBattles.length}
          </span>
        </div>

        <div className="relative">
          <label htmlFor="battle-search" className="sr-only">
            {labels.searchPlaceholder}
          </label>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            id="battle-search"
            type="text"
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={labels.searchPlaceholder}
            className="w-full pl-9 pr-4 py-2 bg-muted/50 border border-border rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <Virtuoso
          style={{ height: '100%' }}
          data={filteredBattles}
          itemContent={(_index, campaign) => {
            const isSelected = selected === campaign.id;
            return (
              <div className="px-3 py-1">
                <button
                  className={cn(
                    'w-full group flex flex-col p-4 rounded-2xl text-left transition-all duration-300 relative overflow-hidden focus-visible:ring-2 focus-visible:ring-primary focus:outline-none',
                    isSelected
                      ? 'bg-primary text-primary-foreground shadow-xl shadow-primary/20'
                      : 'bg-card/40 border border-border/40 hover:bg-accent text-muted-foreground hover:text-foreground'
                  )}
                  onClick={() => onSelect(campaign.id)}
                  aria-selected={isSelected}
                  role="option"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(campaign.id);
                    }
                  }}
                >
                  <div className="flex items-center justify-between mb-2 w-full">
                    <span
                      className={cn(
                        'text-[9px] px-2 py-0.5 rounded-full font-black uppercase tracking-widest border',
                        isSelected
                          ? 'bg-white/20 border-white/30 text-white'
                          : 'bg-primary/5 border-primary/10 text-primary'
                      )}
                    >
                      {campaign.category}
                    </span>
                    <span className="text-[10px] font-mono opacity-60">
                      {campaign.time.start}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        'w-2 h-2 rounded-full shrink-0',
                        isSelected
                          ? 'bg-white'
                          : 'bg-muted-foreground/30 group-hover:bg-primary'
                      )}
                    />
                    <span className="font-bold text-sm tracking-tight truncate flex-1">
                      {campaign.name.zh}
                    </span>
                    <ChevronRight
                      className={cn(
                        'w-4 h-4 shrink-0 transition-transform',
                        isSelected ? 'rotate-90' : ''
                      )}
                    />
                  </div>

                  <div className="mt-2 text-[10px] opacity-70 line-clamp-1">
                    {campaign.result}
                  </div>
                </button>
              </div>
            );
          }}
          className="custom-scrollbar"
        />
      </div>
    </div>
  );
};

const BattleDetails = ({ campaignId }: { campaignId: string }) => {
  const campaign = battles.find((c) => c.id === campaignId);
  if (!campaign) return null;
  const labels = UI_LABELS.zh;

  return (
    <div className="flex-1 bg-background/50 backdrop-blur-sm p-8 flex flex-col min-w-0 border-r border-border overflow-y-auto custom-scrollbar">
      <div className="mb-10 space-y-4">
        <div className="flex items-center gap-4">
          <span className="bg-primary/10 text-primary px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border border-primary/20">
            {campaign.category}
          </span>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono font-bold">
            <Clock className="w-3.5 h-3.5" />
            {campaign.time.start} — {campaign.time.end} (
            {campaign.time.duration})
          </div>
        </div>

        <h1 className="text-5xl font-black tracking-tighter text-foreground leading-tight">
          {campaign.name.zh}
        </h1>

        <div className="flex items-center gap-6 pt-4">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-primary" />
            <span className="text-xs font-bold">{campaign.location.name}</span>
            <span className="text-[10px] font-mono opacity-50">
              ({campaign.location.lat}, {campaign.location.lng})
            </span>
          </div>
        </div>
      </div>

      {campaign.details && (
        <div className="space-y-12">
          <section className="space-y-6">
            <h2 className="text-2xl font-black tracking-tight flex items-center gap-3">
              <Activity className="w-6 h-6 text-primary" /> {labels.course}
            </h2>
            <div className="relative pl-8 space-y-8 before:absolute before:left-0 before:top-2 before:bottom-2 before:w-1 before:bg-gradient-to-b before:from-primary before:to-transparent">
              {campaign.details.course.map((phase, idx) => (
                <div key={idx} className="relative group">
                  <div className="absolute -left-[37px] top-1 w-4 h-4 rounded-full bg-background border-4 border-primary z-10" />
                  <div className="p-6 bg-card/20 border border-border/40 rounded-3xl hover:bg-card/40 transition-all">
                    <h3 className="font-black text-lg mb-2 text-primary">
                      {phase.phase}
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {phase.content}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

const SigmaContainer = ({
  graphData,
  onNodeClick,
  searchTerm,
  phaseFilter
}: {
  graphData: { nodes: any[]; edges: any[] };
  onNodeClick: (node: any) => void;
  searchTerm: string;
  phaseFilter: string;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);

  useEffect(() => {
    if (containerRef.current) {
      const graph = new MultiGraph();

      const filteredNodes = graphData.nodes.filter((node) => {
        if (!phaseFilter || phaseFilter === 'all') return true;
        if (!node.date) return true;

        const date = new Date(node.date);
        if (phaseFilter === 'prep') return date < new Date('1950-03-01');
        if (phaseFilter === 'sneak')
          return (
            date >= new Date('1950-03-01') && date < new Date('1950-04-16')
          );
        if (phaseFilter === 'main') return date >= new Date('1950-04-16');
        return true;
      });

      graphData.nodes.forEach((node) => {
        const config = CATEGORY_CONFIG[node.category] || { color: '#7f7f7f' };

        const isMatch =
          !searchTerm ||
          node.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (node.desc || '').toLowerCase().includes(searchTerm.toLowerCase());

        const isInPhase = filteredNodes.some((n) => n.id === node.id);

        graph.addNode(node.id, {
          x: node.x,
          y: node.y,
          label: node.label,
          size: node.size,
          color: isMatch && isInPhase ? config.color : `${config.color}15`,
          category: node.category,
          desc: node.desc,
          zIndex: isMatch && isInPhase ? 1 : 0,
          labelColor: isMatch && isInPhase ? '#333' : '#ccc'
        });
      });

      graphData.edges.forEach((edge) => {
        if (graph.hasNode(edge.from) && graph.hasNode(edge.to)) {
          const fromMatch =
            !searchTerm || graph.getNodeAttribute(edge.from, 'zIndex') === 1;
          const toMatch =
            !searchTerm || graph.getNodeAttribute(edge.to, 'zIndex') === 1;

          graph.addEdge(edge.from, edge.to, {
            label: edge.label,
            size: 2,
            color: fromMatch && toMatch ? '#94a3b8' : '#94a3b820',
            type: 'arrow'
          });
        }
      });

      const sigma = new Sigma(graph, containerRef.current, {
        renderEdgeLabels: true,
        defaultEdgeType: 'arrow',
        edgeLabelSize: 9,
        labelSize: 10,
        labelColor: { color: '#666' },
        labelWeight: 'bold',
        minCameraRatio: 0.1,
        maxCameraRatio: 3,
        enableEdgeEvents: true
      });

      sigmaRef.current = sigma;

      sigma.on('clickNode', ({ node }) => {
        const attrs = graph.getNodeAttributes(node);
        onNodeClick({ id: node, ...attrs });
      });

      return () => {
        sigma.kill();
        sigmaRef.current = null;
      };
    }
  }, [graphData, onNodeClick, searchTerm, phaseFilter]);

  return (
    <div className="w-full h-full relative group">
      <div ref={containerRef} className="w-full h-full" />
      <div className="absolute bottom-4 right-4 flex flex-col gap-1.5 opacity-40 hover:opacity-100 transition-opacity duration-300">
        <button
          onClick={() =>
            sigmaRef.current?.getCamera().animatedZoom({ duration: 300 })
          }
          className="p-1.5 bg-background/80 backdrop-blur-sm border border-border/40 rounded-lg shadow-sm hover:bg-accent transition-colors"
        >
          <Maximize2 className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
        <button
          onClick={() =>
            sigmaRef.current?.getCamera().animatedUnzoom({ duration: 300 })
          }
          className="p-1.5 bg-background/80 backdrop-blur-sm border border-border/40 rounded-lg shadow-sm hover:bg-accent transition-colors"
        >
          <Minimize2 className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
};

// ... mockGraphData definition here ...
const mockGraphData: Record<
  string,
  { nodes: any[]; edges: any[]; stats?: any }
> = {
  // Copy from previous version
  chibi: {
    nodes: [
      {
        id: 'c1',
        label: '赤壁之战',
        size: 30,
        category: 'campaign',
        x: 0,
        y: 0,
        desc: '公元208年孙刘联军击败曹操大军的决定性战役。'
      },
      {
        id: 'c2',
        label: '孙刘联军',
        size: 22,
        category: 'unit',
        x: -50,
        y: 30,
        desc: '由孙权和刘备组成的军事同盟，约5万人。'
      },
      {
        id: 'c3',
        label: '曹操大军',
        size: 25,
        category: 'unit',
        x: 50,
        y: -30,
        desc: '北方统一后的南下主力，号称80万，实则20余万。'
      },
      {
        id: 'c4',
        label: '周瑜',
        size: 18,
        category: 'character',
        x: -80,
        y: 60,
        desc: '东吴大都督，战役前线总指挥。'
      },
      {
        id: 'c5',
        label: '诸葛亮',
        size: 18,
        category: 'character',
        x: -90,
        y: 10,
        desc: '刘备军师，促成联盟并提供气象支持。'
      },
      {
        id: 'c6',
        label: '曹操',
        size: 18,
        category: 'character',
        x: 80,
        y: -60,
        desc: '汉丞相，战役指挥者，犯下轻敌错误。'
      },
      {
        id: 'c7',
        label: '刘备',
        size: 16,
        category: 'character',
        x: -60,
        y: -20,
        desc: '联军一方，在华容道等处设伏。'
      },
      {
        id: 'c8',
        label: '黄盖',
        size: 15,
        category: 'character',
        x: -40,
        y: 80,
        desc: '东吴老将，实施苦肉计并驾驶火船。'
      },
      {
        id: 'c9',
        label: '庞统',
        size: 14,
        category: 'character',
        x: 20,
        y: -80,
        desc: '献连环计，诱导曹操锁闭战船。'
      },
      {
        id: 'c10',
        label: '火攻赤壁',
        size: 20,
        category: 'event',
        x: 0,
        y: 100,
        desc: '战役高潮，利用东南风火烧曹营。'
      },
      {
        id: 'c11',
        label: '连环计',
        size: 16,
        category: 'event',
        x: 40,
        y: -70,
        desc: '将战船铁链锁死，克服士兵晕船。'
      },
      {
        id: 'c12',
        label: '反间计',
        size: 16,
        category: 'event',
        x: 60,
        y: -10,
        desc: '借刀杀人，除掉精通水战的蔡瑁、张允。'
      },
      {
        id: 'c13',
        label: '苦肉计',
        size: 16,
        category: 'event',
        x: -20,
        y: 60,
        desc: '黄盖受刑诈降，博取曹操信任。'
      },
      {
        id: 'c14',
        label: '乌林',
        size: 14,
        category: 'geo',
        x: 30,
        y: 40,
        desc: '曹操驻军北岸所在地。'
      },
      {
        id: 'c15',
        label: '赤壁',
        size: 14,
        category: 'geo',
        x: -30,
        y: 40,
        desc: '孙刘联军驻扎南岸所在地。'
      },
      {
        id: 'c16',
        label: '华容道',
        size: 14,
        category: 'geo',
        x: 100,
        y: 20,
        desc: '曹操战败后的逃亡路线。'
      },
      {
        id: 'c17',
        label: '连锁战船',
        size: 14,
        category: 'weapon',
        x: 70,
        y: 30,
        desc: '被铁链锁死的庞大舰队。'
      },
      {
        id: 'c18',
        label: '火船',
        size: 14,
        category: 'weapon',
        x: -10,
        y: 120,
        desc: '装满薪草膏油的自杀式攻击船。'
      },
      {
        id: 'c19',
        label: '荆州水军',
        size: 15,
        category: 'unit',
        x: 90,
        y: 10,
        desc: '曹操接收的降军，但不习北方气候。'
      },
      {
        id: 'c20',
        label: '江陵',
        size: 13,
        category: 'geo',
        x: 40,
        y: -100,
        desc: '曹操出发地，重要的军事据点。'
      },
      {
        id: 'c21',
        label: '楼船',
        size: 14,
        category: 'weapon',
        x: 60,
        y: 100,
        desc: '大型水战装备，曹操军力象征。'
      },
      {
        id: 'c22',
        label: '孙权',
        size: 18,
        category: 'character',
        x: -120,
        y: 40,
        desc: '江东之主，决策抗曹的关键人物。'
      },
      {
        id: 'c23',
        label: '舌战群儒',
        size: 16,
        category: 'event',
        x: -110,
        y: -30,
        desc: '诸葛亮游说江东，坚定联合抗曹。'
      },
      {
        id: 'c24',
        label: '鲁肃',
        size: 15,
        category: 'character',
        x: -100,
        y: 80,
        desc: '坚定的联合抗曹派，周瑜的好友。'
      }
    ],
    edges: [
      { from: 'c1', to: 'c2', label: '防守方' },
      { from: 'c1', to: 'c3', label: '进攻方' },
      { from: 'c2', to: 'c4', label: '总指挥' },
      { from: 'c2', to: 'c5', label: '外交与谋略' },
      { from: 'c3', to: 'c6', label: '主帅' },
      { from: 'c2', to: 'c7', label: '联盟方' },
      { from: 'c4', to: 'c8', label: '执行将领' },
      { from: 'c4', to: 'c9', label: '策应' },
      { from: 'c1', to: 'c10', label: '决定性事件' },
      { from: 'c10', to: 'c18', label: '使用武器' },
      { from: 'c3', to: 'c11', label: '战术决策' },
      { from: 'c11', to: 'c17', label: '产出物' },
      { from: 'c4', to: 'c12', label: '智略运用' },
      { from: 'c8', to: 'c13', label: '实施主体' },
      { from: 'c10', to: 'c14', label: '发生地' },
      { from: 'c10', to: 'c15', label: '发生地' },
      { from: 'c6', to: 'c16', label: '败退路径' },
      { from: 'c3', to: 'c19', label: '兵力组成' },
      { from: 'c6', to: 'c20', label: '出发地' },
      { from: 'c19', to: 'c21', label: '装备' },
      { from: 'c2', to: 'c22', label: '最高决策' },
      { from: 'c5', to: 'c23', label: '参与事件' },
      { from: 'c22', to: 'c24', label: '谋臣' }
    ]
  },
  normandy: {
    nodes: [
      {
        id: 'n1',
        label: '诺曼底登陆',
        size: 30,
        category: 'campaign',
        x: 0,
        y: 0,
        desc: '二战欧洲战场转折点，代号霸王行动。'
      },
      {
        id: 'n2',
        label: '盟军远征军',
        size: 25,
        category: 'unit',
        x: -60,
        y: -40,
        desc: '美、英、加、法等国联军，总兵力288万。'
      },
      {
        id: 'n3',
        label: '德军B集团军群',
        size: 22,
        category: 'unit',
        x: 60,
        y: 40,
        desc: '驻守西线的纳粹德军主力。'
      },
      {
        id: 'n4',
        label: '艾森豪威尔',
        size: 18,
        category: 'character',
        x: -100,
        y: -70,
        desc: '盟军最高统帅，最终决策者。'
      },
      {
        id: 'n5',
        label: '隆美尔',
        size: 18,
        category: 'character',
        x: 100,
        y: 70,
        desc: '德军前线指挥官，负责大西洋壁垒。'
      },
      {
        id: 'n6',
        label: '蒙哥马利',
        size: 16,
        category: 'character',
        x: -80,
        y: -30,
        desc: '盟军地面部队总指挥。'
      },
      {
        id: 'n7',
        label: '伦德施泰特',
        size: 16,
        category: 'character',
        x: 120,
        y: 20,
        desc: '德军西线总司令。'
      },
      {
        id: 'n8',
        label: '布莱德利',
        size: 15,
        category: 'character',
        x: -40,
        y: -90,
        desc: '美军第1集团军司令。'
      },
      {
        id: 'n9',
        label: 'D-Day',
        size: 20,
        category: 'event',
        x: 0,
        y: -100,
        desc: '1944年6月6日，登陆开始之日。'
      },
      {
        id: 'n10',
        label: '空降行动',
        size: 18,
        category: 'event',
        x: -30,
        y: 50,
        desc: '凌晨进行的敌后伞兵投送。'
      },
      {
        id: 'n11',
        label: '保镖行动',
        size: 16,
        category: 'event',
        x: -60,
        y: 80,
        desc: '极其成功的战略欺骗计划。'
      },
      {
        id: 'n12',
        label: '眼镜蛇行动',
        size: 18,
        category: 'event',
        x: 40,
        y: -120,
        desc: '战役后期的装甲突破行动。'
      },
      {
        id: 'n13',
        label: '奥马哈滩头',
        size: 15,
        category: 'geo',
        x: -20,
        y: 20,
        desc: '死伤最惨重的登陆点。'
      },
      {
        id: 'n14',
        label: '犹他滩头',
        size: 14,
        category: 'geo',
        x: -50,
        y: 10,
        desc: '美军登陆滩头之一。'
      },
      {
        id: 'n15',
        label: '卡昂',
        size: 14,
        category: 'geo',
        x: 30,
        y: 80,
        desc: '早期激战的关键城市。'
      },
      {
        id: 'n16',
        label: '巴黎',
        size: 16,
        category: 'geo',
        x: 100,
        y: -50,
        desc: '8月25日解放，标志战役结束。'
      },
      {
        id: 'n17',
        label: '大西洋壁垒',
        size: 16,
        category: 'background',
        x: 80,
        y: -10,
        desc: '德军修筑的漫长岸防工事。'
      },
      {
        id: 'n18',
        label: '桑树人工港',
        size: 14,
        category: 'weapon',
        x: -90,
        y: 20,
        desc: '预制件拼装的海运港口。'
      },
      {
        id: 'n19',
        label: '两栖坦克',
        size: 14,
        category: 'weapon',
        x: -20,
        y: -130,
        desc: 'DD坦克，支持抢滩作战。'
      },
      {
        id: 'n20',
        label: '第101空降师',
        size: 15,
        category: 'unit',
        x: -60,
        y: 110,
        desc: '著名的尖叫之鹰，美军精锐空降部队。'
      },
      {
        id: 'n21',
        label: '希特勒',
        size: 18,
        category: 'character',
        x: 140,
        y: -40,
        desc: '纳粹德国元首，干预指挥导致失误。'
      },
      {
        id: 'n22',
        label: '加莱',
        size: 14,
        category: 'geo',
        x: 90,
        y: -110,
        desc: '战略欺骗中虚构的盟军主攻方向。'
      },
      {
        id: 'n23',
        label: '雅尔塔会议',
        size: 16,
        category: 'impact',
        x: 120,
        y: -130,
        desc: '战后世界格局的讨论。'
      },
      {
        id: 'n24',
        label: '冥王星计划',
        size: 13,
        category: 'weapon',
        x: -110,
        y: 50,
        desc: '海底输油管，保障盟军燃料。'
      },
      {
        id: 'n25',
        label: '气象预测',
        size: 14,
        category: 'background',
        x: 30,
        y: -150,
        desc: '决定登陆日期的关键科学因素。'
      }
    ],
    edges: [
      { from: 'n1', to: 'n2', label: '发起方' },
      { from: 'n1', to: 'n3', label: '防御方' },
      { from: 'n2', to: 'n4', label: '最高统帅' },
      { from: 'n3', to: 'n5', label: '前线指挥' },
      { from: 'n2', to: 'n6', label: '地面指挥' },
      { from: 'n3', to: 'n7', label: '战区统帅' },
      { from: 'n1', to: 'n9', label: '关键日期' },
      { from: 'n1', to: 'n10', label: '战役序幕' },
      { from: 'n1', to: 'n11', label: '战前欺骗' },
      { from: 'n1', to: 'n12', label: '战略突围' },
      { from: 'n1', to: 'n13', label: '核心滩头' },
      { from: 'n1', to: 'n16', label: '战役终点' },
      { from: 'n3', to: 'n17', label: '防御依托' },
      { from: 'n2', to: 'n18', label: '后勤创新' },
      { from: 'n2', to: 'n19', label: '特种装备' },
      { from: 'n10', to: 'n20', label: '参与部队' },
      { from: 'n3', to: 'n21', label: '最高指挥' },
      { from: 'n11', to: 'n22', label: '欺骗目标' },
      { from: 'n1', to: 'n23', label: '战后影响' },
      { from: 'n2', to: 'n24', label: '能源补给' },
      { from: 'n9', to: 'n25', label: '决策依据' }
    ]
  },
  hainan: {
    nodes: [
      {
        id: 'h1',
        label: '海南岛战役',
        size: 30,
        category: 'campaign',
        x: 0,
        y: 0,
        desc: '1950年解放军渡海解放海南岛的重大战役。'
      },
      {
        id: 'h2',
        label: '第四野战军',
        size: 20,
        category: 'unit',
        x: -40,
        y: -30,
        desc: '主力进攻部队，由邓华统一指挥。'
      },
      {
        id: 'h3',
        label: '琼崖纵队',
        size: 18,
        category: 'unit',
        x: -20,
        y: 60,
        desc: '岛内接应力量，冯白驹指挥。'
      },
      {
        id: 'h4',
        label: '国军守军',
        size: 20,
        category: 'unit',
        x: 40,
        y: 30,
        desc: '防守方，约10万人。'
      },
      {
        id: 'h6',
        label: '韩先楚',
        size: 15,
        category: 'character',
        x: -70,
        y: -40,
        desc: '40军军长，亲自率部队强渡登陆。'
      },
      {
        id: 'h7',
        label: '冯白驹',
        size: 15,
        category: 'character',
        x: -40,
        y: 70,
        desc: '琼崖纵队司令员，坚持岛内斗争多年。'
      },
      {
        id: 'h8',
        label: '薛岳',
        size: 15,
        category: 'character',
        x: 60,
        y: 40,
        desc: '海南防卫总司令，构筑伯陵防线。'
      },
      {
        id: 'h5',
        label: '伯陵防线',
        size: 16,
        category: 'background',
        x: 70,
        y: 10,
        desc: '所谓的“铜墙铁壁”立体防线。'
      },
      {
        id: 'h-w1',
        label: '土炮艇',
        size: 14,
        category: 'weapon',
        x: -30,
        y: 10,
        desc: '木帆船加装火炮，创造“木船打兵舰”奇迹。'
      },
      {
        id: 'h-w2',
        label: 'B-25轰炸机',
        size: 12,
        category: 'weapon',
        x: 80,
        y: 50,
        desc: '国军空军主力装备之一。'
      },
      {
        id: 'h9',
        label: '美亭决战',
        size: 18,
        category: 'event',
        x: 20,
        y: 80,
        date: '1950-04-19',
        desc: '决定全岛命运的关键性会战。'
      },
      {
        id: 'h-e1',
        label: '先锋潜渡',
        size: 14,
        category: 'event',
        x: -80,
        y: 20,
        date: '1950-03-05',
        desc: '分批偷渡，打破海峡封锁。'
      },
      {
        id: 'h-g1',
        label: '雷州半岛',
        size: 14,
        category: 'geo',
        x: -100,
        y: -60,
        desc: '大军出发地及支前基地。'
      },
      {
        id: 'h-g2',
        label: '临高角',
        size: 14,
        category: 'geo',
        x: 0,
        y: 100,
        desc: '主力大举登陆的重要地点。'
      },
      {
        id: 'h-i1',
        label: '海南行政区',
        size: 16,
        category: 'impact',
        x: 100,
        y: -20,
        desc: '战后行政体制改革。'
      },
      {
        id: 'h-p1',
        label: '邓华',
        size: 18,
        category: 'character',
        x: -120,
        y: -20,
        desc: '第15兵团司令员，战役整体指挥者。'
      },
      {
        id: 'h-e2',
        label: '海口解放',
        size: 16,
        category: 'event',
        x: 20,
        y: -100,
        desc: '1950年4月23日，海南首府获得解放。'
      },
      {
        id: 'h-u1',
        label: '国民党残部',
        size: 15,
        category: 'unit',
        x: 110,
        y: 60,
        desc: '撤往台湾的败兵，防守计划破产。'
      },
      {
        id: 'h-w3',
        label: '木帆船',
        size: 14,
        category: 'weapon',
        x: -90,
        y: 80,
        desc: '解放军渡海的主要运输工具。'
      },
      {
        id: 'h-b1',
        label: '朝鲜战争爆发',
        size: 16,
        category: 'impact',
        x: 130,
        y: -80,
        desc: '外部局势突变，凸显海南解放紧迫性。'
      },
      {
        id: 'h-g3',
        label: '海口',
        size: 14,
        category: 'geo',
        x: 50,
        y: -120,
        desc: '战役战略目标之一。'
      }
    ],
    edges: [
      { from: 'h1', to: 'h2', label: '主要进攻方' },
      { from: 'h1', to: 'h3', label: '岛内策应' },
      { from: 'h1', to: 'h4', label: '防御方' },
      { from: 'h2', to: 'h6', label: '前线统帅' },
      { from: 'h3', to: 'h7', label: '最高统帅' },
      { from: 'h4', to: 'h8', label: '总指挥' },
      { from: 'h4', to: 'h5', label: '依托防线' },
      { from: 'h2', to: 'h-w1', label: '战术创新' },
      { from: 'h4', to: 'h-w2', label: '海空优势' },
      { from: 'h1', to: 'h9', label: '战役决战' },
      { from: 'h2', to: 'h-e1', label: '初期战术' },
      { from: 'h-e1', to: 'h3', label: '会师' },
      { from: 'h2', to: 'h-g1', label: '集结地' },
      { from: 'h9', to: 'h-g2', label: '地理关联' },
      { from: 'h1', to: 'h-i1', label: '最终结果' },
      { from: 'h2', to: 'h-p1', label: '上级指挥' },
      { from: 'h1', to: 'h-e2', label: '标志性进展' },
      { from: 'h4', to: 'h-u1', label: '最终走向' },
      { from: 'h2', to: 'h-w3', label: '渡海工具' },
      { from: 'h1', to: 'h-b1', label: '历史关联' },
      { from: 'h-e2', to: 'h-g3', label: '发生地' }
    ],
    stats: {
      forces: '约 10 万',
      losses: '约 3.3 万',
      duration: '14 天 (大规模作战)',
      result: '全岛解放'
    }
  },
  default: {
    nodes: [
      {
        id: 'default',
        label: '暂无数据',
        size: 15,
        color: '#7f7f7f',
        x: 0,
        y: 0
      }
    ],
    edges: []
  }
};

const KnowledgeGraph = ({ campaignId }: { campaignId: string }) => {
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [phaseFilter, setPhaseFilter] = useState('all');
  const labels = UI_LABELS.zh;

  const graphData = useMemo(
    () => migrateData(mockGraphData[campaignId] || mockGraphData.default),
    [campaignId]
  );

  return (
    <div className="w-[600px] bg-card flex flex-col relative overflow-hidden">
      <div className="p-6 border-b border-border bg-card/50 backdrop-blur-md z-10 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black tracking-tight flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary" />
              {labels.graph}
            </h2>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-0.5">
              {labels.graphSubtitle}
            </p>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder={labels.graphSearchPlaceholder}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-4 py-2 bg-muted/50 border border-border rounded-full text-xs font-bold focus:outline-none focus:ring-2 focus:ring-primary/20 w-48 transition-all focus:w-64"
            />
          </div>
        </div>

        {campaignId === 'hainan' && (
          <div className="flex items-center gap-2 p-1 bg-muted/30 rounded-2xl border border-border/50">
            {[
              { id: 'all', label: labels.phases.all },
              { id: 'prep', label: labels.phases.prep },
              { id: 'sneak', label: labels.phases.sneak },
              { id: 'main', label: labels.phases.main }
            ].map((phase) => (
              <button
                key={phase.id}
                onClick={() => setPhaseFilter(phase.id)}
                className={cn(
                  'flex-1 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all',
                  phaseFilter === phase.id
                    ? 'bg-primary text-primary-foreground shadow-sm scale-[1.02]'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                )}
              >
                {phase.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 relative bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:20px_20px]">
        <div className="absolute bottom-4 left-4 z-10 bg-background/60 backdrop-blur-sm p-1.5 rounded-xl border border-border/40 shadow-sm flex flex-col gap-1 pointer-events-none transition-all duration-300">
          {Object.entries(CATEGORY_CONFIG).map(([key, config]) => (
            <div
              key={key}
              className="flex items-center gap-1.5 pointer-events-auto hover:translate-x-0.5 transition-transform"
            >
              <div
                className="w-3.5 h-3.5 rounded-sm flex items-center justify-center text-white shrink-0 shadow-sm"
                style={{ backgroundColor: config.color }}
              >
                {React.cloneElement(config.icon, { className: 'w-2 h-2' })}
              </div>
              <span className="text-[7px] font-black text-foreground/50 uppercase tracking-tighter whitespace-nowrap">
                {config.label}
              </span>
            </div>
          ))}
        </div>

        <SigmaContainer
          graphData={graphData}
          onNodeClick={setSelectedNode}
          searchTerm={searchTerm}
          phaseFilter={phaseFilter}
        />

        {selectedNode && (
          <div className="absolute inset-0 z-20 flex items-center justify-center p-8 pointer-events-none">
            <div className="w-full max-w-sm bg-card border-2 border-primary/20 rounded-[2.5rem] shadow-2xl p-8 pointer-events-auto animate-in zoom-in-95 fade-in duration-300 relative overflow-hidden">
              <button
                onClick={() => setSelectedNode(null)}
                className="absolute top-6 right-6 p-2 hover:bg-muted rounded-full transition-colors"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
              <div className="space-y-6">
                <div className="flex items-center gap-4">
                  <div
                    className="w-16 h-16 rounded-[1.5rem] flex items-center justify-center text-white shadow-lg"
                    style={{
                      backgroundColor:
                        CATEGORY_CONFIG[selectedNode.category]?.color
                    }}
                  >
                    {React.cloneElement(
                      CATEGORY_CONFIG[selectedNode.category]?.icon,
                      { className: 'w-8 h-8' }
                    )}
                  </div>
                  <div>
                    <span className="text-[10px] font-black text-primary uppercase tracking-[0.2em]">
                      {CATEGORY_CONFIG[selectedNode.category]?.label ||
                        selectedNode.category}
                    </span>
                    <h3 className="text-2xl font-black tracking-tight text-foreground">
                      {selectedNode.label}
                    </h3>
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="p-4 bg-muted/30 rounded-3xl border border-border/50">
                    <p className="text-sm leading-relaxed text-muted-foreground font-medium">
                      {selectedNode.desc || '暂无详细史料描述。'}
                    </p>
                  </div>
                  <button className="flex items-center gap-2 text-[10px] font-black text-primary uppercase tracking-widest hover:gap-3 transition-all">
                    <span>查看更多关联</span>
                    <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default function KnowledgeBasePage() {
  const [selectedCampaign, setSelectedCampaign] = useState(
    battles[0]?.id || ''
  );
  const [searchTerm, setSearchTerm] = useState('');

  return (
    <div
      className="flex h-[calc(100vh-100px)] -m-8 bg-background overflow-hidden"
      role="main"
    >
      <CampaignList
        selected={selectedCampaign}
        onSelect={setSelectedCampaign}
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
      />
      <div className="flex-1 flex min-w-0">
        <BattleDetails campaignId={selectedCampaign} />
        <KnowledgeGraph campaignId={selectedCampaign} />
      </div>
    </div>
  );
}
