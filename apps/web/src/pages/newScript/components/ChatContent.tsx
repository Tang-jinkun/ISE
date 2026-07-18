import { WarDataDisplay } from './WarDataDisplay';
import MarkdownIt from 'markdown-it';

const markdown = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
  typographer: true,
});

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
      // Case: WarData (Mock data or standard WarData)
      // Check for signature fields of WarData
      if (payload.war_name && payload.outline) {
        return <WarDataDisplay data={payload} onParse={onParse} />;
      }
    }
  }

  // Markdown is rendered with raw HTML disabled so model output cannot inject markup.
  const rendered = markdown.render(content);

  return (
    <div
      className="chat-markdown text-sm leading-relaxed text-foreground/90"
      dangerouslySetInnerHTML={{ __html: rendered }}
    />
  );
};
