const AGENT_BASE_URL = (import.meta as any).env?.AGENT_BASE || '/SceneAgent';

export async function* agentChatStream(query: string): AsyncGenerator<string> {
  const url = `${AGENT_BASE_URL}/api/agent/run_graph`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query })
  });

  if (!resp.ok || !resp.body) {
    throw new Error(`Agent request failed: ${resp.status}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    if (value) {
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // The last line might be incomplete, keep it in buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);

          if (data.error) {
            console.error('Agent error:', data.error);
            // Optionally yield error message or throw
            continue;
          }

          if (data.status === 'completed') {
            continue;
          }

          // Extract content from messages
          if (data.messages && Array.isArray(data.messages)) {
            for (const msg of data.messages) {
              // We only care about content from AI or relevant nodes
              // The backend sends all messages in state_update.
              // Assuming we want to display all content returned.
              if (msg.content) {
                yield msg.content;
              }
            }
          }
        } catch (e) {
          console.warn('Failed to parse agent chunk:', line, e);
        }
      }
    }
  }

  // Process remaining buffer if any
  if (buffer.trim()) {
    try {
      const data = JSON.parse(buffer);
      if (data.messages && Array.isArray(data.messages)) {
        for (const msg of data.messages) {
          if (msg.content) {
            yield msg.content;
          }
        }
      }
    } catch (e) {
      // ignore incomplete json at very end
    }
  }
}
