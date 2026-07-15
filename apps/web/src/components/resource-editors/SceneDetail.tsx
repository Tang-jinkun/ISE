import React from 'react';
import { EditorPanel, SectionTitle, FormItem, FormRow } from './EditorPanel';
import { Input } from '@/components/ui/input';

export interface SceneDetailProps {
  data: {
    description: string;
    creator: string;
    scene_type: string;
    create_time: string | number;
    update_time: string | number;
    stage_title: Array<{
      key: string;
      name: string;
      title: string;
    }>;
  };
  onUpdate: (data: Partial<SceneDetailProps['data']>) => void;
  onClose?: () => void;
}

const formatDate = (date: string | number) => {
  if (!date) return '';
  const d = new Date(date);
  return d.toLocaleDateString();
};

const Tag = ({ children, color }: { children: React.ReactNode; color: 'pink' | 'blue' | 'green' | 'red' | 'orange' }) => {
  const colorMap = {
    pink: 'bg-pink-100 text-pink-800 border-pink-200',
    blue: 'bg-blue-100 text-blue-800 border-blue-200',
    green: 'bg-green-100 text-green-800 border-green-200',
    red: 'bg-red-100 text-red-800 border-red-200',
    orange: 'bg-orange-100 text-orange-800 border-orange-200',
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${colorMap[color]}`}>
      {children}
    </span>
  );
};

export function SceneDetail({ data, onUpdate, onClose }: SceneDetailProps) {
  return (
    <EditorPanel title="场景信息" onClose={onClose}>
      <SectionTitle>基础</SectionTitle>

      <FormRow className="mb-4">
        <div className="col-span-4 text-xs text-muted-foreground">项目名称</div>
        <div className="col-span-8">
          <Input
            value={data.description}
            onChange={(e) => onUpdate({ description: e.target.value })}
            className="h-8 text-xs"
          />
        </div>
      </FormRow>

      <FormRow className="mb-4">
        <div className="col-span-4 text-xs text-muted-foreground">项目拥有者</div>
        <div className="col-span-8">
          <Tag color="pink">{data.creator}</Tag>
        </div>
      </FormRow>

      <FormRow className="mb-4">
        <div className="col-span-4 text-xs text-muted-foreground">项目类型</div>
        <div className="col-span-8">
          <Tag color="pink">{data.scene_type}</Tag>
        </div>
      </FormRow>

      <FormRow className="mb-4">
        <div className="col-span-4 text-xs text-muted-foreground">创建时间</div>
        <div className="col-span-8">
          <Tag color="blue">{formatDate(data.create_time)}</Tag>
        </div>
      </FormRow>

      <FormRow className="mb-4">
        <div className="col-span-4 text-xs text-muted-foreground">更新时间</div>
        <div className="col-span-8">
          <Tag color="blue">{formatDate(data.update_time)}</Tag>
        </div>
      </FormRow>

      <SectionTitle className="mt-6 border-t pt-4">阶段标题</SectionTitle>

      <div className="space-y-3">
        {data.stage_title.length === 0 ? (
          <div className="text-xs text-red-500">
            * 当前场景未设置阶段标题 请在左上角设置
          </div>
        ) : (
          <>
            <div className="text-xs text-muted-foreground mb-2">
              * 当前场景阶段标题 请在左上角修改设置
            </div>
            {data.stage_title.map((item, index) => (
              <div key={index} className="flex flex-wrap gap-2 p-2 border rounded-md bg-muted/20">
                <Tag color="green">{item.key}</Tag>
                <Tag color="red">{item.name}</Tag>
                <Tag color="orange">{item.title}</Tag>
              </div>
            ))}
          </>
        )}
      </div>
    </EditorPanel>
  );
}
