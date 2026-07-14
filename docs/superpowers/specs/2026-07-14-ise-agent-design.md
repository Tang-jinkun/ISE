# ISE 战后复盘场景生成 Agent 设计

日期：2026-07-14

状态：已完成架构讨论，等待实现前审阅

## 1. 背景

ISE 已有一份空战战后复盘 DOCX、对应字幕、轨迹 JSON、GeoJSON、GLB 模型、图片和视频素材。今晚还会接入既有 Web 底座，该底座负责编辑器、地图播放和部分智能解析前端流程。

本阶段要在两天内把底座中的“假智能”替换为一个可运行的领域 Agent。目标不是构建通用自治系统，而是让同类空战复盘 DOCX 能在固定能力和资源范围内生成可追溯、可确认、可执行的场景计划。

Agent 必须作为独立底层服务存在。当前前端可以继续使用固定向导；Agent 内核按多轮会话设计，以便后续支持“删除第三个事件”“强化电子对抗部分”等自然语言修订。

## 2. 已确认决策

1. 支持同类空战复盘 DOCX，而不是只适配当前印巴案例。
2. Agent 输出一份完整 RuntimePlan JSON，底座只负责确定性播放。
3. 使用支持结构化输出或工具调用的云模型 API。
4. EventUnit 生成后暂停，允许用户确认或修改。
5. 至少使用 1 至 2 份额外同类 DOCX 验证泛化能力。
6. 采用一个根 Agent，不在两天版本中实现多 Agent 或 Coordinator。
7. 复制 GSMS 中稳定、通用的 Agent 基础包到 ISE，形成独立代码线。
8. 是否与 GSMS 回合并属于后续决策，不作为当前实现约束。

## 3. 目标与非目标

### 3.1 两天目标

系统应跑通以下链路：

```text
上传 DOCX
-> 解析章节和证据
-> 生成 5 至 10 个 EventUnit
-> 用户确认或修订 EventPlan
-> 生成字幕和场景表达需求
-> 匹配固定资源与场景模板
-> 确定性编译时间轴
-> 校验 RuntimePlan
-> 返回底座播放
```

系统应证明以下智能能力：

- EventUnit 数量、边界和顺序由文档内容决定，不固定为七段。
- EventUnit 和字幕具有原文引用。
- 系统能区分原文事实、模型推断和示意表达。
- 系统能根据底座能力与资源条件调整表达方式。
- 用户修改 EventPlan 后只重算下游产物。

### 3.2 非目标

两天版本不实现：

- 跨领域文档理解；
- 网络资源自动搜索或下载；
- 真实空战物理仿真；
- 真实战果核定；
- 自由生成底座代码；
- 多 Agent、子 Agent 或任务协调器；
- 完整 SceneRepo、分支、合并和远程同步；
- TTS、词级时间戳或高精度口型同步；
- 复杂三维特效自动生成。

## 4. GSMS 复用基线

复制来源：

```text
Repository: E:\Github\GSMS
Commit: 6f62a067a0c2a490634583483950f7f162ba5e52
Captured: 2026-07-14
```

### 4.1 直接复制

```text
GSMS/packages/agent-core
-> ISE/packages/agent-core

GSMS/packages/skills-core
-> ISE/packages/skills-core
```

复制时保留源目录结构与测试，并将包名调整为：

```text
@ise/agent-core
@ise/skills-core
```

复用能力包括：

- `AgentRuntime`；
- `ToolRegistry`；
- `StreamingToolExecutor`；
- `ToolExecutionHost`；
- `OpenAICompatibleAdapter`；
- `FakeModelAdapter`；
- `ArtifactStore`；
- `DomainStateStore`；
- `PermissionManager`；
- `AgentProfile`；
- Skill 加载、注册、渐进披露和执行；
- Transcript、事件审计、循环检测和轮次限制。

### 4.2 最小解耦

GSMS `agent-core` 仅为 `TurnOutcome` 和 `TurnOutcomeStatus` 类型依赖 `@gsms/context-core`。ISE 将这两个运行结果类型内收进 `@ise/agent-core`，不复制完整 `context-core`。

ISE 当前不需要 GSMS 的 TaskFrame、slot resolution、dependency event 或 semantic turn 系统。会话连续性由消息、Artifact ledger 和明确的用户确认承担。

### 4.3 暂不复制

- GSMS GeoAgent、InVEST、Matching 和 Data Hub 领域代码；
- `BusinessAgentProfile`；
- 完整 `TurnCoordinator`；
- 完整 FastAPI `agent.py`；
- 完整 SceneRepo 后端；
- GSMS 前端页面；
- GSMS 业务数据库模型。

今晚核对底座后，可以按实际缺口抽取以下通用模块：

- Agent Session 状态机；
- SSE event broker；
- Agent Session API client；
- React `useAgentEventSource`；
- 精确输入确认绑定。

不允许直接复制包含大量 GSMS 业务逻辑的整文件后再大规模删除。

### 4.4 来源记录

仓库增加 `provenance/GSMS-SNAPSHOT.md`，记录源 commit、复制路径、复制日期、机械改名和后续 ISE 修改。复制后的通用核心尽量保持小改动，以便未来比较和选择性同步。

## 5. 仓库结构

```text
ISE/
  packages/
    agent-core/
    skills-core/

  agent/
    src/
      runtime/
        IseAgentProfile.ts
        IseAgentHost.ts
      tools/
        documentTools.ts
        evidenceTools.ts
        eventPlanTools.ts
        assetTools.ts
        scenePlanTools.ts
        compilerTools.ts
      services/
        documentParser.ts
        assetRegistry.ts
        sceneCompiler.ts
        runtimeValidator.ts
      adapters/
        baseRuntimeAdapter.ts
      contracts/
        evidence.ts
        eventPlan.ts
        scenePlan.ts
        runtimePlan.ts
      session/
        sessionHost.ts
        eventSink.ts
    skills/
      generate-battle-replay/
        SKILL.md
        references/
        examples/
    test/

  docs/
  provenance/
```

`session/` 的具体实现取决于今晚底座是否已有会话、消息、暂停和事件流能力。Agent 内核、领域工具和中间表示不依赖该选择。

## 6. 架构边界

### 6.1 Agent Runtime

Agent Runtime 是领域无关的执行内核，负责：

- 组织模型与工具循环；
- 将工具 Schema 暴露给模型；
- 执行权限、超时、取消和轮次限制；
- 记录消息、工具调用、结果、Artifact 和诊断；
- 在无工具调用、循环调用或最终回答不合法时进行通用恢复。

Agent Runtime 不知道 DOCX、EventUnit、地图、飞机或 RuntimePlan。

### 6.2 ISE Agent Profile

`IseAgentProfile` 定义：

- 角色和领域范围；
- 证据优先规则；
- 事实、推断和示意内容的表达规则；
- 工具使用约束；
- 简体中文输出策略；
- 最终回答约束；
- 失败时不得伪造结果的恢复规则。

### 6.3 ISE Skill

`generate-battle-replay` Skill 描述领域工作方法，而不是硬编码固定工具序列。Skill 包含：

- 什么内容适合成为 EventUnit；
- 如何选择叙事重点；
- 如何压缩重复背景；
- 如何绑定证据；
- 如何判断需要用户澄清；
- 如何避免把推断写成事实；
- 场景需求与底座动作的职责边界；
- 当前印巴案例作为示例，而不是固定模板。

### 6.4 确定性领域服务

确定性服务负责：

- DOCX 结构解析；
- 稳定证据引用；
- 资源读取和规范化；
- Schema 校验；
- 模板展开；
- 时间计算；
- 资源存在性检查；
- 动作依赖与冲突检查；
- RuntimePlan 编译；
- 底座协议适配。

模型不能直接访问文件路径、生成底座代码或绕过这些服务。

## 7. 核心中间表示

所有中间表示使用 Zod 定义并生成 JSON Schema。每个产物包含 `schemaVersion`。

### 7.1 DocumentIR

```text
documentId
title
sections[]
paragraphs[]
tables[]
sourceHash
```

每个段落包含稳定 `sourceRef`，格式为：

```text
doc:<documentId>:paragraph:<index>
doc:<documentId>:table:<tableIndex>:row:<rowIndex>
```

稳定引用基于一次上传版本。DOCX 内容变化后生成新的 `documentId` 和 `sourceHash`。

### 7.2 EvidenceIR

```text
evidenceId
sourceRef
claim
kind: explicit_fact | deterministic_derivation | model_inference | illustrative
entities[]
timeExpression?
locationExpression?
confidence
ambiguities[]
```

第一版的 `confidence` 只用于提示用户关注，不作为真实性概率。

### 7.3 EventPlan

```text
planId
documentId
version
eventUnits[]
omittedEvidence[]
warnings[]
```

每个 EventUnit 包含：

```text
eventUnitId
title
worldStateChange
participants[]
locationRefs[]
realWorldTime?
evidenceRefs[]
inferenceRefs[]
uncertainties[]
narrativePurpose
importance
```

约束：

- 默认 5 至 10 个 EventUnit；
- 至少一个 `evidenceRef`；
- 事实和推断引用分开；
- 不允许把未核定数量改写成确定数量；
- `worldStateChange` 必须描述状态变化，而不是镜头命令。

### 7.4 NarrativePlan

```text
narrativePlanId
eventPlanId
targetDurationMs
subtitles[]
sceneRequirements[]
```

字幕包含：

```text
subtitleId
eventUnitId
text
evidenceRefs[]
importance
```

场景需求包含：

```text
requirementId
eventUnitId
focusEntities[]
spatialRelations[]
stateChanges[]
motionRequirements[]
attentionRequirements[]
requiredFacts[]
forbiddenClaims[]
preferredTemplate?
```

NarrativePlan 不包含底座动作和精确播放时间。

### 7.5 AssetRegistry

每个资源使用稳定 ID，不让模型使用裸文件路径：

```text
assetId
kind
displayName
aliases[]
entityTypes[]
uri
format
availability
geoMetadata?
timeMetadata?
renderMetadata?
fallbackAssetIds[]
fingerprint
```

现有资源导入时必须执行以下检查：

- JSON 是 GeoJSON 还是轨迹数组；
- 时间是否单调；
- 时间范围是否落在演示范围；
- 重复时间戳数量；
- 经纬度和高度范围；
- GLB header、版本和声明长度；
- 图片尺寸和格式；
- 报告实体名、轨迹名和模型名是否一致。

已知异常必须进入注册表诊断，包括：

- 报告使用 JF-17，但部分轨迹命名为 J-10CE；
- `AMBALA Su-30MKI-1` 时间落在 5 至 8 分钟且存在倒序；
- 雷达文字范围与范围面文件命名不完全一致；
- SRT 包含原文未支持的对白和确定性战果表述。

### 7.6 CanonicalRuntimePlan

```text
schemaVersion
planId
sourceDocumentId
eventPlanId
narrativePlanId
capabilityManifestVersion
assetRegistryVersion
totalDurationMs
entities[]
subtitles[]
commands[]
informationCards[]
lineage[]
diagnostics[]
```

每条 command 包含：

```text
commandId
eventUnitId
type
targetId
startMs
durationMs
params
dependsOn[]
onFailure
evidenceRefs[]
```

模型不生成 CanonicalRuntimePlan。`sceneCompiler` 根据 NarrativePlan、CapabilityManifest、AssetRegistry 和模板确定性生成。

## 8. Agent 工具

### 8.1 `parse_battle_report`

- 风险：`derive`
- 输入：上传文件 ID
- 输出：DocumentIR、EvidenceIR、解析诊断
- 实现：确定性 DOCX 解析与基础规则抽取

### 8.2 `inspect_report_evidence`

- 风险：`read`
- 输入：章节、实体、关键词或 evidence ID
- 输出：有界证据片段
- 大结果保存为 Artifact，只向模型返回摘要和引用

### 8.3 `propose_event_plan`

- 风险：`derive`
- 输入：结构化 EventPlan
- 输出：Schema 校验后的 draft EventPlan artifact
- 无证据事件直接拒绝

### 8.4 `accept_event_plan`

- 风险：`write`
- 输入：精确的 draft artifact ID、版本和 fingerprint
- 输出：accepted EventPlan artifact
- 必须经过用户确认

### 8.5 `inspect_replay_assets`

- 风险：`read`
- 输入：实体类型、动作需求或 asset IDs
- 输出：可用资源、降级路径和诊断

### 8.6 `propose_scene_plan`

- 风险：`derive`
- 输入：NarrativePlan
- 输出：校验后的 NarrativePlan artifact

### 8.7 `compile_replay_runtime`

- 风险：`derive`
- 输入：accepted EventPlan ID、NarrativePlan ID、能力和资源版本
- 输出：CanonicalRuntimePlan artifact
- 实现：确定性模板展开和时间调度

### 8.8 `validate_replay_runtime`

- 风险：`read`
- 输入：CanonicalRuntimePlan ID
- 输出：验证报告与底座适配结果
- 验证失败时不给出可播放状态

## 9. 用户确认与修改

EventPlan 草案生成后，Session 进入 `awaiting_review`。前端展示 EventUnit 列表、来源、推断和警告。

用户操作规则：

- 直接批准：对 draft ID、version 和 fingerprint 进行精确确认；
- 修改文本或顺序：创建新版 draft，旧版被 supersede；
- 删除事件：创建不含该事件的新版 draft；
- 拒绝：保留草案，但不进入下游编译；
- 自然语言修改：作为同一 Session 的新消息，由 Agent 生成新版 draft。

确认记录不能原地改写已绑定的 `effectiveInput`。任何内容变化都必须产生新版 artifact，再重新确认。

## 10. 编译与时间调度

第一版使用受限模板，而不是自由动作生成。模板集合包括：

```text
deployment
attack_chain
interception
electronic_warfare
counterattack
withdrawal
return_and_summary
generic_movement
status_explanation
```

模板只是可选表现能力，不要求 EventPlan 固定为七个事件。

时间规则：

- 中文基准语速为每秒约 4 个汉字；
- 每条字幕至少 4 秒；
- 重要字幕增加 1 至 2 秒观察时间；
- EventUnit 之间增加过渡时间；
- 动作必须满足 CapabilityManifest 中的最短时长；
- 相机动作默认不重叠；
- 同一对象的互斥状态变化不得重叠；
- 总时长超限时先压缩低优先级字幕和观察缓冲；
- 仍然超限则返回规划层，要求减少低优先级内容。

轨迹中的现实时间与演示播放时间必须分开。现有轨迹统一转换为相对时间后再映射到 EventUnit 的播放窗口。

## 11. 底座适配

Agent 内部只认 `CanonicalRuntimePlan`。今晚接入底座时，由 `baseRuntimeAdapter` 完成最终协议转换。

必须核对：

1. 底座动作类型和参数；
2. 对象创建、更新、隐藏和销毁语义；
3. 资源 URL 或 asset ID 引用方式；
4. 时间单位与时间轴起点；
5. 相机动作和并发规则；
6. 字幕与信息卡协议；
7. 播放、暂停、拖动和重播时的状态恢复；
8. RuntimePlan 的错误返回格式；
9. 文件上传和生成结果保存接口；
10. 前端是否已有 Session、SSE 和确认能力。

若底座协议不完整，默认适配目标为版本化 JSON：毫秒时间、稳定对象 ID、显式 create/update/hide 命令和可重复执行的初始化状态。

## 12. Session 与事件流

若底座已有会话能力，Agent 通过适配接口复用。若没有，则实现最小 Session API：

```text
POST /sessions
POST /sessions/{id}/attachments
POST /sessions/{id}/messages
GET  /sessions/{id}
GET  /sessions/{id}/events
GET  /sessions/{id}/artifacts
POST /sessions/{id}/reviews/{reviewId}/approve
POST /sessions/{id}/reviews/{reviewId}/reject
POST /sessions/{id}/interrupt
```

状态：

```text
idle
-> queued
-> running
-> awaiting_review
-> queued
-> running
-> completed | failed | cancelled
```

事件流至少包含：

```text
run.started
model.streaming
tool.started
tool.progress
tool.completed
artifact.created
review.requested
review.resolved
run.completed
run.failed
```

事件只记录可见活动和结构化结果，不记录隐藏推理链。

## 13. 失败处理与恢复

### 13.1 文档解析失败

- 拒绝损坏或加密 DOCX；
- 返回缺失标题样式、空章节或表格解析警告；
- 保留已解析的 DocumentIR，允许用户补充信息后继续。

### 13.2 模型输出不合法

- 工具 Schema 拒绝非法结构；
- 将具体校验错误返回模型；
- 最多进行两次结构修复；
- 仍失败则暂停并展示错误，不生成伪造计划。

### 13.3 证据不足

- 无 `evidenceRefs` 的 EventUnit 不得接受；
- 推断必须进入 `inferenceRefs` 或 `uncertainties`；
- 未核定战果不得转换成确定数字或确定击毁结论。

### 13.4 资源不可用

按注册表降级：

```text
专用三维模型
-> 通用三维模型
-> 专题图标
-> 普通 Marker
-> 文字信息卡
```

没有合法降级方案时，保留字幕和信息卡，省略相关动画并产生 warning。

### 13.5 编译或底座校验失败

- 返回 command ID、EventUnit ID、错误码和修复建议；
- 资源错误只重做资源解析与编译；
- 时间冲突只重做调度；
- EventPlan 不因下游错误重新生成；
- 最后一个通过校验的 RuntimePlan 继续保留。

## 14. 测试策略

### 14.1 复制基线

- `agent-core` 原测试全部通过；
- `skills-core` 原测试全部通过；
- 包名和 TurnOutcome 解耦后再次运行全部测试；
- 新增来源快照检查，避免复制不完整。

### 14.2 单元测试

- DOCX 标题、段落、列表和表格解析；
- sourceRef 稳定性；
- EvidenceIR 和 EventPlan Schema；
- 无证据 EventUnit 拒绝；
- Artifact supersede；
- 资产类型识别和异常诊断；
- 字幕时长计算；
- 模板展开；
- 时间冲突检测；
- RuntimePlan 确定性；
- 底座适配器映射。

### 14.3 Agent 合约测试

使用 `FakeModelAdapter` 覆盖：

- 正常生成 EventPlan；
- 第一次输出非法、第二次修复成功；
- 生成无证据事件被拒绝；
- EventPlan 等待确认；
- 修改后生成新版本；
- 资源不足时选择降级；
- 工具调用循环被终止；
- RuntimePlan 校验失败时不宣称完成。

### 14.4 验收测试

至少三份同类报告：

1. 当前印巴复盘报告；
2. 结构和标题不同的空战复盘报告；
3. 信息缺失或包含歧义的空战复盘报告。

验收指标：

- 三份 DOCX 均能完成结构解析；
- 关键事件人工覆盖率达到可演示水平；
- 所有 EventUnit 均有来源或显式推断标记；
- 不出现原文未支持的数量、对白或确定性战果；
- EventPlan 可修改并生成新版本；
- RuntimePlan 100% 通过 JSON Schema；
- 所有 asset ID 可解析或有明确降级；
- 底座可以播放、暂停、拖动和重播；
- 当前印巴案例可完整播放约 180 秒。

## 15. 两天实施范围

### 第一天上午

- 复制并验证 `agent-core`、`skills-core`；
- 建立 ISE Agent 工程、Profile 和 Skill；
- 定义 DocumentIR、EvidenceIR、EventPlan；
- 实现 DOCX 解析和证据引用；
- 完成现有资产注册表生成与诊断。

### 第一天下午

- 接入模型；
- 实现 EventPlan 工具和确认前产物；
- 跑通上传 DOCX 到 EventPlan 预览；
- 根据今晚底座确定 Session 和事件流适配方式；
- 定义 CapabilityManifest 和底座 RuntimePlan 映射。

第一天结束验收：

```text
上传 DOCX
-> 生成带证据 EventPlan
-> 用户可以批准或要求修改
```

### 第二天上午

- 实现 NarrativePlan；
- 实现 AssetRegistry 查询；
- 实现场景模板、时间调度和 RuntimePlan 编译；
- 接入底座并播放主要场景。

### 第二天下午

- 完成验证、错误显示和降级；
- 使用额外 DOCX 做泛化测试；
- 修复集成问题；
- 调整字幕、相机和动作时间；
- 冻结功能并录制演示。

第二天下午不增加新功能。

## 16. 完成标准

实现完成必须同时满足：

1. ISE 不依赖本机 GSMS 路径即可安装和运行；
2. 复制核心测试与 ISE 新测试通过；
3. 当前报告和额外报告能生成不同 EventPlan；
4. 用户确认的是精确版本的 EventPlan；
5. 字幕和事件具有可查看的证据来源；
6. RuntimePlan 由确定性编译器生成；
7. RuntimePlan 经 Schema、资源、时间和底座能力校验；
8. 底座能够完整播放当前案例；
9. 失败时系统显示真实错误，不回退到伪造成功；
10. 仓库记录 GSMS 复制来源与 ISE 修改。
