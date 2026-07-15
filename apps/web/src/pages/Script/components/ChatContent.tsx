import { WarDataDisplay } from './WarDataDisplay';

// Helper functions for parsing payload
const isJsonString = (text: string) => {
  const t = text.trim();
  return (
    (t.startsWith('{') && t.endsWith('}')) ||
    (t.startsWith('[') && t.endsWith(']'))
  );
};

const parsePayload = (text: string): any => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export const ChatContent = ({
  content,
  onParse
}: {
  content: string;
  onParse?: () => void;
}) => {
  // Check if content is JSON
  if (isJsonString(content)) {
    const payload = parsePayload(content);

    if (payload) {
      // Case: Analysis Metadata + WarData
      if (payload._analysis_metadata) {
        const { _analysis_metadata, ...warData } = payload;
        return (
          <div className="space-y-4">
            <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-3 animate-in zoom-in-95 duration-500">
              <div className="flex items-center gap-2 mb-2 text-[11px] font-black text-cyan-600 dark:text-cyan-400 uppercase tracking-wider">
                <div className="h-1.5 w-1.5 rounded-full bg-cyan-500 animate-pulse" />
                解析元数据关联
              </div>
              <div className="grid grid-cols-1 gap-2">
                {[
                  {
                    label: '任务目标',
                    value: _analysis_metadata.task_goal,
                    stage: '任务规划'
                  },
                  {
                    label: '叙事模板',
                    value: _analysis_metadata.narrative_template,
                    stage: '叙事规划'
                  },
                  {
                    label: '资源路径',
                    value: _analysis_metadata.resource_uri,
                    stage: '资源匹配'
                  }
                ].map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between text-[10px] bg-background/50 p-2 rounded-lg border border-cyan-500/10 hover:border-cyan-500/30 transition-colors"
                  >
                    <div className="flex flex-col">
                      <span className="text-muted-foreground">
                        {item.label}
                      </span>
                      <span className="font-mono font-bold text-cyan-700 dark:text-cyan-300">
                        {item.value}
                      </span>
                    </div>
                    <span className="px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-600 text-[8px] font-black">
                      来自: {item.stage}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            {warData.war_name && warData.outline && (
              <WarDataDisplay data={warData} onParse={onParse} />
            )}
            <div className="mt-4">
              <div className="text-[10px] font-bold text-muted-foreground mb-1.5 uppercase tracking-tight">
                原始解析数据 (JSON)
              </div>
              <pre className="text-[10px] p-3 bg-muted rounded-xl overflow-x-auto border border-border font-mono leading-tight max-h-60 scrollbar-thin">
                <code className="text-cyan-700 dark:text-cyan-300">
                  {JSON.stringify(payload, null, 2)}
                </code>
              </pre>
            </div>
          </div>
        );
      }

      // Case: WarData (Mock data or standard WarData)
      // Check for signature fields of WarData
      if (payload.war_name && payload.outline) {
        return <WarDataDisplay data={payload} onParse={onParse} />;
      }
    }
  }

  // Regular text rendering
  return (
    <div className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
      {content}
    </div>
  );
};
