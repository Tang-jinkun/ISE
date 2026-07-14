import type {
  AgentMessage,
  ModelAdapter,
  ModelRequest,
  ModelResponse,
  StreamChunk,
  ToolCall,
} from '../types.ts'

export interface OpenAICompatibleOptions {
  apiKey: string
  model: string
  baseUrl?: string
  responseFormat?: 'json_schema' | 'json_object'
  headers?: Record<string, string>
}

export class OpenAICompatibleAdapter implements ModelAdapter {
  readonly #baseUrl: string

  constructor(readonly options: OpenAICompatibleOptions) {
    this.#baseUrl = options.baseUrl ?? 'https://api.openai.com/v1'
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const response = await this.#postChatCompletion(request)

    const json = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null
          tool_calls?: Array<{
            id: string
            function: { name: string; arguments: string }
          }>
        }
      }>
    }
    const message = json.choices?.[0]?.message
    if (!message) throw new Error('Model response did not contain a message')

    return {
      content: message.content ?? '',
      toolCalls: message.tool_calls?.map(
        (call): ToolCall => ({
          id: call.id,
          name: call.function.name,
          input: parseArguments(call.function.arguments),
        }),
      ),
    }
  }

  async *completeStreaming(request: ModelRequest): AsyncIterable<StreamChunk> {
    const response = await fetch(`${this.#baseUrl}/chat/completions`, {
      method: 'POST',
      signal: request.signal,
      headers: {
        ...this.options.headers,
        authorization: `Bearer ${this.options.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        ...chatCompletionBody(this.options.model, request, undefined, this.options.responseFormat),
        stream: true,
      }),
    })
    if (!response.ok) {
      throw new Error(`Model request failed: ${response.status} ${await response.text()}`)
    }

    const body = response.body
    if (!body) throw new Error('Response body is null')

    const decoder = new TextDecoder()
    let buffer = ''
    const activeToolCalls = new Map<number, { id: string; name: string }>()

    for await (const chunk of body) {
      buffer += decoder.decode(chunk, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue
        const data = trimmed.slice(6)
        if (data === '[DONE]') {
          yield { type: 'done' }
          return
        }

        let parsed: StreamingChunk
        try {
          parsed = JSON.parse(data) as StreamingChunk
        } catch {
          continue
        }

        const delta = parsed.choices?.[0]?.delta
        if (!delta) continue

        if (delta.content) {
          yield { type: 'text', text: delta.content }
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const index = tc.index ?? 0
            if (tc.id && tc.function?.name) {
              activeToolCalls.set(index, { id: tc.id, name: tc.function.name })
              yield { type: 'tool_call_start', id: tc.id, name: tc.function.name }
            }
            if (tc.function?.arguments) {
              const active = activeToolCalls.get(index)
              if (active) {
                yield { type: 'tool_call_delta', id: active.id, argumentsDelta: tc.function.arguments }
              }
            }
          }
        }
      }
    }
  }

  async #postChatCompletion(request: ModelRequest): Promise<Response> {
    const response = await this.#postChatCompletionBody(
      chatCompletionBody(this.options.model, request, undefined, this.options.responseFormat),
      request.signal,
    )
    if (response.ok) return response

    const text = await response.text()
    if (request.responseFormat?.type === 'json_schema' && responseFormatUnavailable(response.status, text)) {
      const fallback = await this.#postChatCompletionBody(chatCompletionBody(this.options.model, request, {
        type: 'json_object',
      }), request.signal)
      if (fallback.ok) return fallback
      throw new Error(`Model request failed: ${fallback.status} ${await fallback.text()}`)
    }

    throw new Error(`Model request failed: ${response.status} ${text}`)
  }

  async #postChatCompletionBody(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    return fetch(`${this.#baseUrl}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        ...this.options.headers,
        authorization: `Bearer ${this.options.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  }
}

function chatCompletionBody(
  model: string,
  request: ModelRequest,
  responseFormatOverride?: Record<string, unknown>,
  preferredResponseFormat?: OpenAICompatibleOptions['responseFormat'],
): Record<string, unknown> {
  const responseFormat = responseFormatOverride ??
    (request.responseFormat ? toOpenAIResponseFormat(request.responseFormat, preferredResponseFormat) : undefined)
  return {
    model,
    messages: request.messages.map(toOpenAIMessage),
    tools: request.tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    })),
    tool_choice: 'auto',
    ...(responseFormat ? { response_format: responseFormat } : {}),
  }
}

function toOpenAIMessage(message: AgentMessage): Record<string, unknown> {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      content: message.content,
      tool_call_id: message.toolCallId,
    }
  }
  if (message.role === 'assistant' && message.toolCalls?.length) {
    return {
      role: 'assistant',
      content: message.content || null,
      tool_calls: message.toolCalls.map(call => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.input) },
      })),
    }
  }
  return { role: message.role, content: message.content }
}

function responseFormatUnavailable(status: number, text: string): boolean {
  return (status === 400 || status === 422 || status === 502) &&
    /response_format|json_schema|unavailable/i.test(text)
}

function toOpenAIResponseFormat(
  format: ModelRequest['responseFormat'],
  preferredResponseFormat?: OpenAICompatibleOptions['responseFormat'],
): Record<string, unknown> {
  if (!format || format.type === 'text') return { type: 'text' }
  if (preferredResponseFormat === 'json_object') return { type: 'json_object' }
  return {
    type: 'json_schema',
    json_schema: {
      name: format.jsonSchema.name,
      schema: format.jsonSchema.schema,
      strict: format.jsonSchema.strict ?? true,
    },
  }
}

function parseArguments(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return {}
  }
}

interface StreamingChunk {
  choices?: Array<{
    delta?: {
      content?: string | null
      tool_calls?: Array<{
        index?: number
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
  }>
}
