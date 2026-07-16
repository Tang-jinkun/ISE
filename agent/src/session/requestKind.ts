export type SessionRequestKind = 'answer' | 'generate'

const MUTATION_PATTERN = /(?:生成|创建|制作|修改|调整|改成|新增|添加|删除|移除|替换|重新|编译|延后|提前|移动|加入|导入|上传|播放)/
const QUESTION_PATTERN = /[?？]\s*$|^(?:请问|能否|是否|有没有|有多少|多少|什么|为什么|怎么|如何|哪里|哪一|当前|这个|场景)/

export function classifyRequestKind(content: string, hasSceneArtifacts: boolean): SessionRequestKind {
  if (!hasSceneArtifacts) return 'generate'
  const normalized = content.trim()
  if (!normalized || MUTATION_PATTERN.test(normalized)) return 'generate'
  return QUESTION_PATTERN.test(normalized) ? 'answer' : 'generate'
}
