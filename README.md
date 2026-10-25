# dsh-savvy-progress

DeepSeek Harness（dsh）插件：**多 Agent 实时进度 + 成本可视化**。对标 Claude Code 的 [Savvy Progress](https://github.com/JohnnyVizz/claude-kit/tree/main/plugins/savvy-progress)，按 dsh 的 Cordis 插件体系与事件/投影架构重新实现。

在 dsh 的 Web / Desktop 界面上提供：

1. **顶部进度条（Progress Band）**——输入框上方，显示编排任务标题/阶段/任务数、运行中的子代理数、总耗时与预估成本；点击打开代理面板。
2. **右侧 Agents 面板**——右栏新标签页「代理进度」，实时列出每个子代理的状态、模型、运行时长、token 用量与成本估算，支持分组、过滤、展开详情、跳转子代理会话。

多 Agent 并行工作时不再只有一个 spinner。

- 版本：`0.1.0`
- 适用宿主：DeepSeek Harness ≥ `0.2.0-rc.2`（针对 `0.2.1-rc.3` API 开发验证）
- 许可证：MIT

---

## 功能

### 只读观察（默认，零侵入）

无需任何编排 skill 配合，插件从 dsh runtime 只读观察：

- 子代理生命周期：`agent/created` / `agent/status` / `agent/disposed` / `subagent/start` / `subagent/end`
- 发现与血缘：父会话的 `subagent/catalog` 事件、子会话的 `subagent/descriptor`（label、一次性/可持续模式、模型）
- 用量与路由：`request/context`（模型/上下文窗口）、`assistant/message` 的 `usage`（输入/输出/缓存 token）
- 每代理：轮数、工具调用数、累计 token、USD 成本估算（按模型单价表）、最近错误

面板在任何多代理任务（AgentTeams、自定义编排、手动 spawn）下都能工作。

### 可选主动上报工具（v0.2 功能，已内置）

| 工具 | 调用者 | 作用 |
|------|--------|------|
| `savvy_progress` | 仅主会话（编排者） | 上报 flow：标题、阶段、任务列表、done/total、finished。子代理调用会被忽略（不报错） |
| `savvy_step` | 任意代理 | 上报自己的步骤进度：done/total/note |

上报写入各自会话的持久化 plugin record，重启/恢复后仍可回放。

### 界面

```
┌──────────────────────────────────────────────────────────────┐
│ ● 重构认证模块 · 阶段: delegate    3/7 任务  2 运行中  ≈ $0.42  2m 18s │   ← Band
├──────────────────────────────────────────────────────────────┤
│ Agents                                                       │
│ ● 运行中 (2)                                                 │
│   ├ worker-auth    deepseek-chat · 1m 12s · 步骤 2/5 · ≈ $0.18 │
│   └ worker-test    deepseek-reasoner · 48s · ≈ $0.06          │
│ ○ 已完成 (1)  ▾                                              │
│   └ research       …                                         │
│ 合计成本 ≈ $0.42 · 总耗时 2m 18s                              │   ← Panel（右栏）
└──────────────────────────────────────────────────────────────┘
```

- 面板按 运行中 / 失败 / 已完成 分组，已完成可折叠，支持「仅显示运行中」过滤
- 行点击展开详情：轮数、工具调用、token 明细（含缓存读写）、step note、错误、会话 id
- 可持续（continuable）且已完成的子代理可一键「打开会话」在主视图查看
- 中英双语（跟随 dsh 语言设置）

## 架构

```
Host (Node, Cordis 插件)                     Client (Web, dsh-client)
┌────────────────────────────┐               ┌──────────────────────────┐
│ observer.ts  ← agent/* 等  │               │ Band.tsx                 │
│   store.ts   内存态+节流    │  session log  │  conversation.input.dock │
│   ↓ appendPluginRecord     │ ───────────▶  │ Panel.tsx                │
│ projection.ts savvy-agents │  (plugin:     │  sidebar.right.pane.tab  │
│   /savvy-flow/savvy-step   │   record)     │  useProjection(...)      │
│ tools.ts  savvy_progress   │               │                          │
│           savvy_step       │               │                          │
└────────────────────────────┘               └──────────────────────────┘
```

- 快照（`plugin:savvy-progress/agents`）以**节流间隔**（默认 1s，内容变化时才写）追加到根会话日志，作为 ignorable plugin record 持久化——旧版本宿主读取会安全跳过，不会破坏会话。
- 三个投影单元（`savvy-agents` / `savvy-flow` / `savvy-step`）把 record 折叠成 wire 值，Web 端 `useProjection` 直接读取，客户端零领域代码，重启后自动回放。
- 事件数据模型见 `src/types.ts`（`SavvyAgentRow` / `SavvyAgentsView` / `SavvyFlowView` / `SavvyStepView`）。

## 安装

### 方式一：加入 profile patch（推荐）

在 dsh profile（如 `~/.dsh/profiles/web/cordis.patch.yml` 或 desktop 对应文件）追加：

```yaml
- insert:
    - id: savvy-progress
      name: dsh-savvy-progress
      config:
        tools: true
        showCost: true
        snapshotIntervalMs: 1000
        maxFinishedAgents: 50
        costRates: {}
```

并在 profile 目录安装本包：

```bash
cd ~/.dsh/profiles/web
pnpm add /path/to/dsh-savvy-progress
```

重启 dsh（或热加载）后生效。

### 方式二：通过插件管理器

```bash
dsh plugin add /path/to/dsh-savvy-progress
```

## 配置项

| 键 | 类型 | 默认 | 说明 |
|----|------|------|------|
| `tools` | boolean | `true` | 注册 `savvy_progress` / `savvy_step` 工具 |
| `showCost` | boolean | `true` | 显示并估算成本 |
| `snapshotIntervalMs` | number | `1000` | 快照发射节流（200–10000ms） |
| `maxFinishedAgents` | number | `50` | 每个根会话保留的已完成行数 |
| `costRates` | object | 内置表 | 按模型 id 前缀覆盖单价（USD/1M tokens），如 `{"deepseek-chat": {"input": 0.28, "output": 1.1}}` |

内置单价表覆盖 `deepseek-chat` / `deepseek-reasoner` / `deepseek-v3` / `deepseek-r1`；未匹配模型使用保守默认值。**成本为粗略估算**（未建模缓存折扣），界面均标注 `≈`。

## 开发

```bash
npm install
npm run check    # 类型检查
npm run build    # 构建 lib/（host ESM + client ModuleLoader bundle + d.ts）
npm run smoke    # host 侧集成冒烟测试（真 cordis + 真 Session）
```

源码结构：

```
src/
├── index.ts          # host 入口：apply + Config
├── types.ts          # 共享 wire 类型 + 事件/投影/record 声明合并
├── observer.ts       # 只读观察 agent/subagent/session 事件
├── store.ts          # 内存状态 + 节流快照发布
├── projection.ts     # session-projection 三个单元
├── cost.ts           # 成本估算
├── tools.ts          # savvy_progress / savvy_step
└── client/           # Web 半边（打包为 window.__ModuleLoader__ 注册 bundle）
    ├── index.tsx     # 注册 locale / Band / Panel
    ├── Band.tsx      # conversation.input.dock 槽位
    ├── Panel.tsx     # sidebar.right.pane.tab 槽位（savvy-agents 标签页）
    ├── locales.ts    # zh / en 词典
    ├── format.ts     # 纯格式化
    └── types.ts      # type-only 槽位契约引用
```

## 已知限制

- 成本为估算值：按 token 数 × 单价表线性累加，不含缓存命中折扣与阶梯计费。
- 上下文占用百分比暂未展示（runtime 尚无对应事件），字段已预留。
- dsh 快速迭代中，本插件针对 `0.2.1-rc.3` 的事件面验证；宿主升级后如事件名变化需同步适配。

## 致谢

- 设计对标：[JohnnyVizz/claude-kit · savvy-progress](https://github.com/JohnnyVizz/claude-kit/tree/main/plugins/savvy-progress)
- 需求文档：`dsh-savvy-progress.md`

## License

MIT
