# 跨文档场景泛化与生成过程可观测设计

## 1. 背景

当前系统已经打通真实 DOCX 到可播放场景的纵向链路，并在印巴空中对抗报告上生成了具有编队、预警机、数据链、导弹拦截、命中和媒体叠加的有效场景。交互优先求解器也已把导弹拦截与命中的几何结果提升为运行时共享事实。

但当前成果仍有两个直接影响 Agent 属性的问题：

- 场景蓝图规划器直接包含苏-30MKI、阵风、JF-17、印巴预警机、基地和专用航迹映射。换一份题材不同的 DOCX，编译器很可能无法形成同等完整的演员和场景。
- 后端已经持久化模型流、工具活动、编译进度、产物创建和审核事件，但 UI 只显示模型摘要、工具和诊断；编译阶段与产物阶段在 Turn 投影时被过滤，完成后执行过程又自动折叠。

下一阶段的核心验收不再是继续提高单一印巴场景的表现力，而是证明：不修改编译器代码，输入第二份内容不同的 DOCX，也能生成基础可播放场景，并且用户能够看到从文档解析到场景产物的完整公开生成过程。

## 2. 目标

1. 将印巴实体、别名、阵营、基地、模型和航迹绑定从通用规划器迁入独立 `ScenarioPack`。
2. 通用规划器仅处理实体、阵营、角色、数量、位置、编队、生命周期和交互语义，不包含具体国家、机型或基地特判。
3. 已知场景通过数据包增强精确资产匹配；未知场景通过通用解析和明确降级生成基础场景。
4. 保留“DOCX 明确数量严格遵守，未明确数量采用可审计默认值”的现有规则。
5. 沿用 interaction-first 求解结果；缺失事实或几何冲突时输出 `unresolved`，不得伪造拦截、碰撞或命中。
6. 在新建剧本页展示公开生成时间线，包括文档解析、事件计划、审核、字幕、资产、调度、校验、适配和产物创建。
7. 用第二份不同内容的真实 DOCX 完成一次 EventPlan 到 SceneProjectConfig 的真实导出和桌面预览。

## 3. 非目标

- 不在本阶段实现真实空气动力学、制导算法或碰撞物理。
- 不要求未知场景自动获得精确的专用 GLB、视频或航迹；允许使用语义兼容的通用素材或静态地图表达。
- 不为第二份 DOCX 在通用编译器中增加新的题材、国家、机型或事件 ID 条件分支。
- 不允许根据字幕或视频效果反推“已经命中”；交互结论只能来自证据与 InteractionSolver。
- 不进行移动端开发和移动端验收。
- 不在功能阶段扩大全量回归、非阻塞重构或预防性加固。

## 4. 总体架构

```text
DOCX
  -> DocumentIR / EvidenceIR
  -> EventPlan
  -> Public Generation Timeline
  -> ScenarioPackRegistry
  -> SemanticActorPlanner
  -> AssetAndTrajectoryResolver
  -> SceneBlueprint
  -> ChoreographyPlan
  -> InteractionSolver
  -> PresentationScheduler
  -> CanonicalRuntimePlan
  -> SceneProjectConfig
  -> Runtime
```

通用语义与场景数据分离：

```text
SemanticActorPlanner
  负责：从证据和 EventUnit 形成演员、阵营、角色、数量和生命周期

ScenarioPack
  负责：为已知语义实体提供别名、地点、模型、航迹束和表现资源候选

AssetAndTrajectoryResolver
  负责：依据角色、实体别名、阵营、地点和资源能力做确定性匹配与降级

InteractionSolver
  负责：独立于具体场景包求解发射、拦截、命中和摧毁关系
```

`SceneBlueprintPlanner` 退化为编排器：先匹配场景包，再把场景包作为只读增强输入交给语义规划和资源解析，不再自己保存印巴实体表或专用行为分支。

## 5. ScenarioPack 契约

`ScenarioPack` 是只读数据契约，不包含编译回调和任意代码执行能力。

```ts
interface ScenarioPack {
  schemaVersion: 'ise-scenario-pack/v1'
  packId: string
  displayName: string
  matchRules: ScenarioMatchRule[]
  factions: FactionProfile[]
  entityProfiles: EntityProfile[]
  locationProfiles: LocationProfile[]
  routeBundles: RouteBundleProfile[]
  mediaProfiles: MediaProfile[]
}
```

`SceneBlueprint` 增加可选的来源字段：

```ts
scenarioPack?: {
  packId: string
  version: string
}
```

其中：

- `matchRules` 只使用 EvidenceIR 中的显式实体、地点和事实做评分。
- `factions` 提供阵营别名和展示信息，不决定胜负或行为。
- `entityProfiles` 提供语义实体别名、平台类型、角色候选和资产别名。
- `routeBundles` 引用现有轨迹目录中的 asset ID，不生成新航迹。
- `mediaProfiles` 只提供表现资源候选，不改变事件事实。

匹配规则：

1. 只有一个数据包达到阈值时自动启用。
2. 多个数据包并列时输出 `SCENARIO_PACK_AMBIGUOUS`，转入通用模式，不猜测选择。
3. 没有数据包达到阈值时使用内建 `generic/v1` 空数据包。
4. 场景包只能增强资产解析，不能新增 EventPlan 中不存在的交互结论。

现有 `indoPakTrajectoryScenario` 的语义别名、基地和航迹束迁入 `indo-pak-air-combat/v1`。迁移后通用规划文件中不得出现 `india`、`pakistan`、`JF-17`、`Rafale`、`Su-30MKI`、`Minhas`、`Rafiki`、`Ambala` 或 `Adampur` 常量。

## 6. 通用演员规划

`SemanticActorPlanner` 从 EventPlan 和 EvidenceIR 生成 `ActorGroupIntent[]`：

```ts
interface ActorGroupIntent {
  groupId: string
  semanticEntityRef: string
  aliases: string[]
  factionRef: string
  platformKind: 'aircraft' | 'weapon' | 'sensor' | 'vehicle' | 'unknown'
  role: string
  locationRefs: string[]
  quantityDecision: QuantityDecision
  formationPolicy: 'single' | 'formation' | 'unknown'
  lifecycle: 'scene-persistent' | `event-scoped:${string}`
  evidenceRefs: string[]
}
```

解析顺序：

1. 从 EventUnit 的参与者、状态变化和引用证据中收集实体。
2. 通过显式所属、动作主语和对立关系形成稳定的 `factionRef`；无法确定时使用 `faction:unknown`。
3. 根据发射、预警、跟踪、运输、救援、撤离等证据确定角色，不依据实体名称写特判。
4. 数量优先级固定为：显式证据 > 用户值 > ScenarioPack 角色默认值 > 全局角色默认值。
5. 单机动作或战果数量不得覆盖编队总数，现有数量解析规则继续生效。
6. 同一语义实体在多个相邻 EventUnit 中通过实体、阵营、地点和证据交集归并；无法唯一归并时保留独立演员并输出诊断。

武器仍是事件范围演员。武器的 launcher、target 和 outcome 由 engagement normalization 处理，演员规划器不自行创建命中关系。

## 7. 资产与航迹解析

解析器输入 `ActorGroupIntent`、已选 ScenarioPack 和 AssetRegistry，输出候选解析结果：

```ts
interface ActorAssetResolution {
  actorGroupId: string
  modelAssetId?: string
  trajectoryAssetIds: string[]
  mediaAssetIds: string[]
  status: 'exact' | 'compatible' | 'static-fallback' | 'unresolved'
  diagnostics: Diagnostic[]
}
```

确定性优先级：

1. ScenarioPack 中实体与地点完全匹配的资产。
2. AssetRegistry 中实体别名、平台类型和角色兼容的唯一资产。
3. 平台类型兼容的通用模型和现有航迹束。
4. 无可靠航迹时使用已知地点或证据坐标的静态模型/标记，不自动绘制虚构航迹。
5. 无模型但有位置时使用地图标记。
6. 无位置且无资产时保留字幕和诊断，不创建伪造演员。

交互参与者只有在可靠位置与时间约束齐备时才进入 InteractionSolver。静态降级不能被视为已经满足命中或碰撞几何。

## 8. 公开生成时间线

生成时间线复用现有持久化事件，不暴露模型隐藏推理、系统提示词、工具输入、模型 ID 或密钥。

`AgentTurnActivity` 增加公开活动类型：

- `thinking`：模型公开说明。
- `tool`：工具启动、进度、完成和失败。
- `stage`：`compile.progress` 对应的解析、字幕、资产、调度、校验和适配阶段。
- `artifact`：EventPlan、NarrationPlan、SceneBlueprint、CanonicalRuntimePlan 和 SceneProjectConfig 的创建。
- `review`：审核请求与审核结果。
- `diagnostic`：可公开的失败或降级信息。

后端历史投影与前端实时投影必须共享相同的纯函数语义，保证刷新前后看到的步骤一致。连续模型 token 合并为公开说明，不逐 token 渲染成数百行。

UI 行为：

- 当前运行 Turn 默认展开并持续更新。
- 最新 Turn 完成后保持展开，直到用户主动折叠或开始下一轮 Turn。
- 更早的历史 Turn 默认折叠，但可重新展开查看完整过程。
- 编译阶段显示阶段名与百分比；产物显示用户可理解的名称，不显示内部指纹全文。
- 失败时定位到失败阶段，保留已经完成的步骤与已创建产物。

## 9. 第二文档挑战

仓库新增一份与印巴战例不同的真实 DOCX 验收夹具。内容必须满足：

- 包含至少两个阵营或协作方、明确地点、至少一个编队数量和多个有先后关系的事件。
- 不使用印巴国家、现有机型、基地或当前 EventUnit ID。
- 至少包含一种非导弹事件，例如搜索、护航、运输、救援或撤离。
- 可以包含一个交互事件，但缺少可靠命中事实时必须输出 `unresolved`，不得为展示效果补写命中。

验收链路必须从 DOCX 开始，经真实 Agent 产生并可见导出：

- `event-plan.json`
- `canonical-runtime-plan.json`
- `scene-project.json`

验收不要求该场景达到印巴演示的素材精度，但必须具备字幕、至少一个可见演员或标记、非空时间轴、可播放相机和清晰诊断。

## 10. 诊断与降级

新增并保留以下稳定诊断：

- `SCENARIO_PACK_AMBIGUOUS`
- `SCENARIO_PACK_NOT_MATCHED`
- `ACTOR_IDENTITY_AMBIGUOUS`
- `ACTOR_FACTION_UNRESOLVED`
- `ACTOR_MODEL_UNRESOLVED`
- `ACTOR_TRAJECTORY_STATIC_FALLBACK`
- `INTERACTION_PARTICIPANT_UNRESOLVED`
- `INTERACTION_UNRESOLVED`

诊断必须携带 actor、eventUnit、interaction 或 stage 范围，不能全部包装为泛化的 `AGENT_RUN_FAILED`。

降级原则：

- 表现能力不足时保留事实和字幕。
- 轨迹不足时降级为静态位置，不造航迹。
- 交互约束不足时保留接近或跟踪语义，不造命中。
- 单个媒体缺失不阻断场景编译。
- SceneProjectConfig 契约无效才阻断最终预览。

## 11. 数据流与兼容性

- EventPlan、NarrationPlan、SceneBlueprint、ChoreographyPlan 和运行时产物继续保留 source lineage 与 fingerprint。
- ScenarioPack 的 `packId` 和版本写入 SceneBlueprint 的 `scenarioPack` 字段，并随 lineage 进入 ResolvedScenePlan 元数据，以便复现同一解析结果。
- 旧的印巴 EventPlan 和已导出 SceneProjectConfig 继续可播放。
- 旧轨迹 asset ID 保持不变；迁移只改变配置所有权，不改写素材文件。
- Runtime 不感知 ScenarioPack；它只消费最终实体、轨道、交互和诊断。

## 12. 验收与验证策略

### 定向单元验证

- ScenarioPack 匹配唯一、无匹配和歧义分支。
- 通用演员规划不依赖印巴实体名称。
- 显式数量、单机战果和默认编队数量优先级。
- 精确资产、兼容资产、静态降级和 unresolved 分支。
- compile/artifact/review 活动在实时与历史投影中一致。
- 最新完成 Turn 保持展开，旧 Turn 默认折叠。

### 真实链路验证

1. 用现有印巴 DOCX 跑一次回归导出，确认已解决 interaction 和现有场景表现未倒退。
2. 用第二份 DOCX 跑一次真实 Agent 导出，不修改编译器代码。
3. 只进行一次 desktop-chromium 或人工桌面预览，确认场景非空、时间轴可播放、字幕可见、演员/标记存在。
4. 功能阶段不运行移动端验收和全量测试；阶段末统一处理完整回归和容器重建。

当前分支基线保留主分支已有失败：Agent 编译器存在 3 个历史拦截时间/镜头断言失败；Web store 存在 4 个因 `interactions: []` schema 默认值产生的历史期望差异。它们不应被误归因于本阶段改动；若真实链路被其阻断，再在对应任务中修复。

## 13. 实施边界

按以下顺序交付：

1. 先扩展公开 Turn 活动投影与生成时间线，使第二文档运行过程可观察。
2. 定义 ScenarioPack 契约和注册表，将印巴配置数据化迁移，保持现有场景输出。
3. 实现通用 SemanticActorPlanner，删除通用规划器内的印巴实体常量。
4. 实现资产/航迹解析与静态降级，保持 interaction-first 约束。
5. 新增第二 DOCX 夹具并跑通真实导出。
6. 只修复真实导出中暴露的通用阻断问题；不继续对单一场景追加硬编码表现特判。

阶段完成的判断标准是“第二份不同 DOCX 无需修改编译器代码即可生成基础场景”，而不是“第二份场景达到第一份演示的全部视觉质量”。
