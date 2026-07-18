# Interaction-First Runtime Architecture

## 1. 背景与问题

当前 DOCX 到场景的链路已经能生成字幕、模型、媒体和基础 engagement，但交互结果仍不可靠。根因不是单条轨迹缺失，而是当前编译顺序把字幕窗口当成了物理时间轴：先把实体压进字幕窗口，再尝试让轨迹交互。

这会造成三类错误：

- 两枚导弹在同一时刻结束，但终点坐标不同，视觉上不可能相撞。
- 一个导弹先被绑定到目标飞机，随后又被另一个 engagement 当作目标，前后两次空间变换没有传播。
- 交互镜头、隐藏、坠毁和字幕分别计算，彼此没有引用同一个交互结果。

本设计把交互关系和物理/轨迹约束提升为编译主线，字幕和媒体降级为表现层约束。

## 2. 目标与非目标

### 目标

- 支持任意 `launcher -> weapon -> target -> outcome` 关系，不针对具体剧本写特判。
- 保留 DOCX 中明确的数量、先后、目标和时间事实。
- 让同一 interaction 统一驱动轨迹终点、镜头、效果、状态和隐藏。
- 支持一个 weapon 成为另一个 interaction 的 target，并传播已求解的几何结果。
- 当事实或轨迹无法满足约束时输出 `unresolved`，不伪造命中。
- 保持原始轨迹的相对形状和时间关系，允许在仿真时间轴上做受约束的变换。

### 非目标

- 不在本阶段实现真实空气动力学、制导算法或碰撞物理模拟。
- 不要求所有场景都有精确现实坐标；缺少坐标时允许使用轨迹/事件约束推断。
- 不改变现有桌面端 UI 布局，不新增移动端验收范围。
- 不用媒体视频替代三维交互语义；媒体只是补充表现。

## 3. 核心概念

### 3.1 三个时间轴

```text
Source Time
  原始轨迹或报告时间，用于保持源时间关系

Simulation Time
  场景实体实际运动和交互的时间

Narrative Time
  字幕、旁白、媒体和镜头的时间
```

映射方向固定为：

```text
source route -> simulation event -> presentation cue
```

字幕不再直接决定导弹的物理终点。字幕窗口只提供叙事范围、视觉提前量和镜头优先级。

### 3.2 EngagementGraph

在 `SceneBlueprint` 与 `ChoreographyPlan` 之间增加交互图概念。每个节点引用一个实体或实体组，每条边表达一个交互：

```json
{
  "engagementId": "engagement:sub-004:intercept",
  "launcherRef": "actor:pakistan-jf17-minhas:leader",
  "weaponRef": "actor:weapon-eu-004:leader",
  "targetRef": "actor:weapon-eu-003:leader",
  "outcome": "interception",
  "evidenceRefs": ["ev-..."],
  "sceneBeatRefs": ["scene-beat:sub-004"]
}
```

同一 `weaponRef` 只允许一个连续生命周期。模型如果把同一交互拆到多个相邻 scene beat，编译器必须归并关系并合并证据，而不是重复生成命令。

### 3.3 RouteSegment

实体不再只有一条覆盖全部生命周期的 `follow_path`。每个实体由一个或多个段组成：

```text
pre-interaction
terminal-approach
interaction
post-interaction
```

每个段拥有：

- source trajectory asset
- source time range
- simulation time range
- start/end spatial constraints
- optional interaction reference
- resolution status

导弹被另一个 engagement 拦截时，其 terminal segment 必须被下游 interaction 覆盖，不能继续使用原始终点。

## 4. 编译流水线

```text
DOCX
  -> DocumentIR / EvidenceIR
  -> EventPlan
  -> NarrativePlan / NarrationPlan
  -> SceneBlueprint
  -> EngagementGraph normalization
  -> RouteSegmentPlan
  -> InteractionSolver
  -> PresentationScheduler
  -> CanonicalRuntimePlan
  -> SceneProjectConfig
  -> Runtime
```

### 4.1 Engagement normalization

解析阶段负责从事实和语义中确定：

- launcher
- weapon
- target
- outcome
- 先后关系
- 事实证据和不确定性

解析允许推断，但每个推断必须带 `evidenceRefs` 和 `certainty`。同一 weapon 的重复 engagement 在这里归并。

### 4.2 交互求解顺序

交互按依赖图逆拓扑求解：

1. 先求解没有 weapon target 依赖的末端 interaction。
2. 产生 `interactionTime` 和 `interactionPoint`。
3. 将结果传播给把该 weapon 作为 target 的上游 interaction。
4. 计算 launcher 在 launch time 的位置。
5. 将 weapon route 变换到 launcher 起点和 interaction 终点。
6. 验证 weapon 与 target 在 interaction time 的距离不超过 tolerance。

对于“印度来袭导弹 -> 巴方拦截导弹 -> interception”的链：

```text
先确定拦截交互点
  -> 同时约束两枚导弹
  -> 再覆盖印度导弹前一个攻击 engagement 的 terminal segment
```

如果图存在环、目标缺失或约束冲突，返回 `unresolved`，并保留可播放的非命中轨迹，但不得输出命中/相撞结论。

### 4.3 InteractionResult

求解器输出统一结果：

```json
{
  "interactionId": "interaction:sub-004:intercept",
  "type": "interception",
  "participants": ["actor:weapon-eu-003:leader", "actor:weapon-eu-004:leader"],
  "timeMs": 48200,
  "point": [74.54, 30.95, 8800],
  "toleranceM": 500,
  "status": "resolved",
  "diagnostics": []
}
```

所有下游命令只引用 `interactionId`，不得重新计算交互坐标。

## 5. 字幕与表现调度

字幕成为软约束，分三种强度：

- `explicit`: DOCX 明确给出时间或数量，作为硬约束。
- `ordered`: DOCX 只给出先后关系，只约束顺序。
- `narrative`: 仅提供叙事窗口，允许仿真过程跨越窗口。

表现调度在交互求解之后进行：

```text
interactionTime - terminalLead -> terminal camera
interactionTime -> impact/effect
interactionTime + aftermathHold -> hide/state
```

当字幕窗口不足时，字幕可以结束而场景继续，或者字幕保持在同一 narration beat 下，不能压缩仿真轨迹制造假交互。

## 6. Runtime 协议

`model.follow_path.timing` 增加交互元数据，或由独立的 `interaction.resolve` 命令表达：

```json
{
  "interactionId": "interaction:sub-004:intercept",
  "timeMs": 48200,
  "point": [74.54, 30.95, 8800],
  "toleranceM": 500,
  "status": "resolved"
}
```

运行时必须保证：

- interaction participants 在交互时刻同时可见；
- 交互效果先执行，隐藏/坠毁后执行；
- `unresolved` 不触发命中或击毁效果；
- camera 可以 `follow_interaction`，而不是只跟 subtitle 或 actor group。

三维效果可以先复用现有 impact asset，但语义必须来自 interaction，不得由视频是否存在决定“是否命中”。

## 7. 数据契约与兼容

- `ChoreographyPlan.weaponEngagements` 从单一 `sceneBeatRef` 扩展为 `sceneBeatRefs`，旧字段在读取时转换为单元素数组。
- `WeaponEngagement` 增加 `interactionRef`、`certainty`、`dependencyRefs`。
- `model.follow_path` 的 `timing` 增加可选 `interaction`，旧轨迹没有该字段时按 legacy route 播放。
- `SceneProjectConfig` 保留旧 camera/model 命令，新增 interaction-aware 命令不影响普通运动场景。
- 所有 artifact 继续带 source lineage 和 fingerprint，确保交互结果可追溯到 DOCX 证据。

## 8. 诊断与失败策略

必须区分以下诊断：

- `ENGAGEMENT_DUPLICATE_COLLAPSED`: 同一 weapon 的重复关系已归并。
- `INTERACTION_TARGET_CHAIN_RESOLVED`: 下游交互结果已传播到上游 weapon segment。
- `INTERACTION_GEOMETRY_CONFLICT`: 起点、终点、时间无法同时满足。
- `INTERACTION_SOURCE_TIME_CONFLICT`: 源时间关系与硬约束冲突。
- `INTERACTION_UNRESOLVED`: 交互无法确定，禁止命中效果。

诊断不能只被包装成泛化的 `AGENT_RUN_FAILED`。工具失败事件必须保留原始错误码、artifact、engagementId 和 stage。

## 9. 验收标准

### 编译器

- 同一 weapon 在多个 scene beat 中只生成一个生命周期。
- 链式 weapon target 交互按逆拓扑求解，终点约束可以传播。
- 两个 resolved participants 在 interaction time 的距离不超过 tolerance。
- subtitle duration 改变不会改变已确定的 source/interaction 几何，只改变 presentation cue。
- 约束冲突输出 unresolved，不生成命中/击毁。

### Runtime

- 两枚导弹在 interaction time 同时可见并位于同一点容差内。
- 拦截效果发生后才隐藏两枚导弹。
- 击毁效果发生后才进入 destroyed 状态并隐藏目标。
- 未解析交互不播放命中效果。

### 真实链路

- 使用真实 DOCX 重新生成 EventPlan、SceneBlueprint、ChoreographyPlan、CanonicalRuntimePlan 和 SceneProjectConfig。
- 导出 artifact 中可见 `interactionId/timeMs/point/status`。
- 仅进行一次 desktop-chromium 人工预览，核查第一轮导弹拦截和第二轮导弹击毁。

## 10. 实施阶段

1. 先改 contracts 和 EngagementGraph normalization，加入重复关系归并与诊断。
2. 实现逆拓扑 InteractionSolver 和 RouteSegmentPlan，替换当前独立终点绑定。
3. 把 interaction result 接入 CanonicalRuntimePlan、camera 和 hide/state 命令。
4. Runtime 增加 interaction-aware playback 和最小 3D effect 生命周期。
5. 使用真实 DOCX 重新导出，进行一次定向链路验收。

## 11. Review Decisions and First Implementation Boundary

The architecture review confirms the interaction-first direction, with the
following boundaries made explicit:

- `SceneBlueprint` remains the first stable semantic scene artifact. The
  compiler then normalizes `InteractionIntent` into a dependency graph. This
  keeps authored quantities and actor groups traceable to the source document
  while preventing the runtime compiler from inventing entities.
- The first solver domain is weapon launch, weapon interception, target hit,
  and destruction. Tracking and data-link interactions continue to use the
  same registry contract but are not required to block this vertical slice.
- Imported source timestamps are preserved when they share a source clock;
  otherwise they are soft constraints. A subtitle window may shape the
  presentation schedule but cannot move a resolved interaction point.
- Dependency cycles, ambiguous producers, missing geometry, and incompatible
  clocks produce `unresolved`. They never produce a synthetic impact or
  collision.
- The initial runtime implementation may retain existing actor identifiers.
  A new global entity-id namespace is deferred until the interaction registry
  has stabilized across the DOCX and editor contracts.

The first implementation therefore has one shared `InteractionSolver`, one
runtime interaction registry, and one presentation scheduler. Internal timing
strategies remain implementation details; callers do not select mutually
exclusive timing modes.
