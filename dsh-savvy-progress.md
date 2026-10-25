# dsh-savvy-progress

> DeepSeek Harness 版「多 Agent 实时进度 + 成本可视化」插件  
> 对标 Claude Code 的 [Savvy Progress](https://github.com/JohnnyVizz/claude-kit/tree/main/plugins/savvy-progress)

**版本**：0.1.0-draft  
**状态**：设计文档 / 可直接落地实现  
**目标宿主**：DeepSeek Harness ≥ 0.2.0-rc.2  
**许可证建议**：MIT  

---

## 1. 一句话定位

在 dsh 的 Web / Desktop 界面上，提供：

1. **顶部进度条（Progress Band）**：显示当前编排任务的标题、阶段、已完成/总任务数。
2. **侧边 Agents 面板**：实时列出所有子 Agent 的状态、模型、进度、上下文占用、预估成本与运行时间。

让「多 Agent 并行工作时只看到一个 spinner」变成可视化的团队看板。

---

## 2. 为什么要做（与 Claude 版的差异）

| 维度 | Claude Savvy Progress | dsh 版目标 |
|------|-----------------------|------------|
| 数据来源 | 主要靠 MCP 工具主动上报 | **优先只读观察 runtime**，可选主动上报 |
| 子 Agent | Claude 的 subagent | dsh 原生 Agent / AgentTeams / 自定义子 Agent |
| UI 位置 | 顶部 band + `/agents-info` 面板 | 顶部 band + 右侧可折叠面板（符合 dsh Web UI 习惯） |
| 成本 | 估算 | 尽量用 dsh 已有 usage 数据，真实度更高 |
| 依赖 | 与 savvy-flow 强绑定（可选） | 先做成通用观察器，再可选对接编排 skill |

dsh 的事件系统和 Agent 生命周期已经比较完整，因此**最小可用版本可以几乎不改 Agent 行为**，只做观察 + 渲染。

---

## 3. 功能范围

### 3.1 必须有（MVP）

- [x] 顶部 Progress Band（有活跃子 Agent 或有 plan 时出现）
- [x] 右侧 Agents 面板（可折叠 / 可固定）
- [x] 实时显示每个子 Agent：
  - 名称 / 角色
  - 状态：`running` | `finished` | `failed` | `planned`
  - 使用的模型
  - 已运行时间
  - 上下文占用（如可获取）
  - 本 Agent 累计 token / 估算成本
- [x] 汇总：当前活跃数量、总预估成本、总耗时
- [x] 只读模式：不强制 Agent 上报任何东西，直接从 dsh runtime 拉状态

### 3.2 应该有（v0.2）

- [ ] 可选 Progress / Step 上报工具（对标 `mcp__savvy-progress__progress` 和 `__step`）
- [ ] 支持 orchestrator 上报 plan（标题、阶段、任务列表）
- [ ] 支持 worker 上报自己的 step（done / total / note）
- [ ] 面板内按状态分组 / 折叠已完成
- [ ] 语言：`zh` / `en`（跟随 dsh 语言或独立配置）

### 3.3 可以有（后续）

- [ ] 与 AgentTeams / 自定义编排 skill 深度联动
- [ ] 动画（可选，支持 `prefers-reduced-motion`）
- [ ] 成本阈值配置（不同模型单价）
- [ ] 历史回合回放（本 session 内）

---

## 4. 架构设计

### 4.1 插件形态

推荐拆成两个 Cordis 插件（可合并为一个包）：

```
dsh-savvy-progress/
├── package.json
├── cordis.patch.yml          # 或等价的插件清单
├── src/
│   ├── index.ts              # 主入口，注册服务与事件
│   ├── observer.ts           # 只读观察 Agent 生命周期
│   ├── store.ts              # 内存状态（flow + agents）
│   ├── tools.ts              # 可选：progress / step 工具
│   ├── ui/
│   │   ├── band.tsx          # 顶部进度条
│   │   └── panel.tsx         # 右侧 Agents 面板
│   └── types.ts
└── README.md
```

### 4.2 核心数据模型

```ts
/** 当前编排流（可选，有上报才有） */
interface Flow {
  title: string
  phase: 'plan' | 'design' | 'delegate' | 'review' | 'close' | string
  total: number
  done: number
  tasks: PlannedTask[]
  finished: boolean
  updatedAt: number
}

interface PlannedTask {
  id: string
  title: string
  tier?: string          // 可选分层标签
  after?: string[]       // 依赖的任务 id
  status: 'planned' | 'running' | 'finished' | 'failed'
}

/** 单个子 Agent 运行时快照 */
interface AgentSnapshot {
  id: string
  name: string
  role?: string
  model?: string
  status: 'running' | 'finished' | 'failed' | 'planned'
  startedAt?: number
  finishedAt?: number
  stepDone?: number
  stepTotal?: number
  stepNote?: string
  contextUsed?: number
  contextLimit?: number
  inputTokens?: number
  outputTokens?: number
  estimatedCost?: number   // 本币或 USD，按配置
  parentId?: string        // 主 session / 编排者
}
```

### 4.3 数据来源优先级

1. **Runtime 观察（默认）**  
   监听 dsh 的 `agent/*`、session event、usage 相关事件，自动维护 `AgentSnapshot[]`。

2. **主动上报（可选增强）**  
   - `progress` 工具：仅主 session / orchestrator 可调用，更新 `Flow`。
   - `step` 工具：worker 调用，更新自己的 `stepDone / stepTotal / stepNote`。

没有上报时，面板仍能显示「有哪些子 Agent 在跑、用什么模型、跑了多久、花了多少 token」。

### 4.4 事件与生命周期（示意）

```ts
// observer.ts 伪代码
ctx.on('agent/created', (agent) => store.upsertAgent(...))
ctx.on('agent/step', ...)          // 如有
ctx.on('agent/finished', ...)
ctx.on('agent/failed', ...)
ctx.on('session/event', (ev) => {
  // 从 usage / tool 结果里补充 token 与成本
})
```

具体事件名以当前 dsh 版本的实际 API 为准（参考官方事件表或 `dsh-plugin-handbook`）。

---

## 5. UI 设计

### 5.1 顶部 Progress Band

- 位置：输入框上方（与 dsh 其他 band 一致）
- 内容示例：

```
[委托中] 重构认证模块   3 / 7 任务完成    4 agents    ≈ $0.42    2m 18s
```

- 点击人数或「详情」打开右侧面板。
- 无活跃子 Agent 且无 Flow 时自动隐藏。

### 5.2 右侧 Agents 面板

建议分区：

```
Agents                          [折叠已完成]
────────────────────────────────────────
● running (3)
  ├─ worker-auth     opus · 1m 12s · 2/5 · $0.18
  ├─ worker-test     deepseek-v4 · 48s · 1/3 · $0.06
  └─ reviewer        ...

○ finished (2)
  ├─ research        ...
  └─ scaffold        ...

◇ planned (2)
  ├─ docs
  └─ polish
────────────────────────────────────────
合计成本 ≈ $0.42    总耗时 2m 18s
```

- 支持点击某行展开更细信息（完整 step note、上下文占用等）。
- 提供「仅显示 running」快速过滤。

### 5.3 交互命令（建议）

| 命令 | 作用 |
|------|------|
| `/agents-info` 或 `/savvy` | 开关右侧面板 |
| `/agents-info open` | 强制打开 |
| `/agents-info close` | 强制关闭 |

也可在设置里做成常驻开关。

---

## 6. 可选工具定义（v0.2）

### 6.1 progress（仅主 session）

```ts
{
  name: 'savvy_progress',
  description: '由编排者上报当前 flow 的标题、阶段与任务进度。子 Agent 调用会被忽略。',
  parameters: {
    title?: string
    phase?: string
    total?: number
    done?: number
    finished?: boolean
    tasks?: Array<{
      title: string
      tier?: string
      after?: number[]   // 1-based 或 id，实现时统一
    }>
  }
}
```

### 6.2 step（worker 用）

```ts
{
  name: 'savvy_step',
  description: 'Worker 上报自己的步骤进度。',
  parameters: {
    total?: number      // 首次调用建议带上
    done: number
    note?: string       // 简短说明当前在做什么
  }
}
```

实现时注意：

- 子 Agent 调用 `savvy_progress` 直接忽略或返回错误。
- `step` 只更新调用者自己的 snapshot。

---

## 7. 配置项

```yaml
# 示例 profile / 插件 config
dsh-savvy-progress:
  enabled: true
  language: auto          # auto | zh | en
  autoOpen: any           # none | savvy | any
                          # any = 任意子 Agent 启动时自动打开一次面板
  showCost: true
  showContext: true
  collapseFinishedByDefault: false
  costRates:              # 可选覆盖
    deepseek-v4: 0.000xx
    # ...
```

---

## 8. 安装与使用（预期）

### 安装

```bash
# 从本地或私有源（开发阶段）
dsh plugin --profile web add /path/to/dsh-savvy-progress

# 或将来发布到 npm / 社区市场后
dsh plugin --profile web add dsh-savvy-progress
```

重启或热加载后生效。

### 日常使用

1. 正常启动带有子 Agent 的任务（AgentTeams、自定义编排、手动 spawn 均可）。
2. 顶部出现 Progress Band。
3. 需要细节时打开右侧面板（命令或点击 band）。
4. （可选）在编排 skill 里调用 `savvy_progress` / `savvy_step` 获得更细进度。

---

## 9. 实现优先级建议

| 阶段 | 内容 | 预计工作量 |
|------|------|------------|
| **P0** | 只读观察 + 右侧面板列表 + 基础状态 | 1–2 天 |
| **P1** | 顶部 Band + 汇总成本/时间 | 0.5–1 天 |
| **P2** | progress / step 工具 + Flow 展示 | 1 天 |
| **P3** | 多语言、折叠、动画、配置完善 | 1 天 |

先做 P0+P1 就能解决「多 Agent 黑盒」的核心痛点。

---

## 10. 与现有 dsh 插件的关系

- **不冲突**：`dsh-watcher`、各种 monitor、AgentTeams 面板可以并存。本插件专注「通用子 Agent 进度与成本」。
- **可互补**：若用户已有 AgentTeams，可把本插件的面板做成更通用的「所有子 Agent 一览」，或提供适配层。
- **不依赖**特定编排 skill，但预留了与 savvy-flow 类 skill 的对接接口。

---

## 11. 风险与注意点

1. **事件 API 稳定性**：dsh 仍在快速迭代，观察逻辑需对事件名/字段做兼容或版本判断。
2. **成本估算准确性**：不同模型、缓存命中、子 Agent 计费方式可能不一致，界面上建议标注「估算」。
3. **性能**：大量短命子 Agent 时，注意 store 更新频率与 UI 渲染节流。
4. **权限**：只读观察版几乎无风险；若提供工具，注意只有主 session 能改 Flow。

---

## 12. 参考

- Claude 原版：https://github.com/JohnnyVizz/claude-kit/tree/main/plugins/savvy-progress
- 配套 skill：https://github.com/JohnnyVizz/claude-kit/tree/main/plugins/savvy-flow
- dsh 架构与事件：官方 docs + 社区 `dsh-plugin-handbook`

---

## 13. 下一步可执行清单

如果你准备动手写代码，建议按这个顺序：

1. 确认当前 dsh 版本下「子 Agent 创建 / 结束 / usage」相关事件与数据结构。
2. 实现 `store` + 只读 `observer`。
3. 先做右侧面板（纯展示），验证数据是否准确。
4. 再加顶部 Band。
5. 最后再考虑 progress/step 工具与编排 skill 联动。

---

**文档结束**

如需我继续输出：

- 更详细的 TypeScript 接口与伪代码  
- `package.json` + 最小可运行骨架  
- 或中英双语 README  

直接说即可。