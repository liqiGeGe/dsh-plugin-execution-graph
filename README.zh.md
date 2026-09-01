# dsh-plugin-execution-graph

[English](README.md) | 中文

一个 DeepSeek Harness（DSH）客户端插件，为会话视图新增一个**「执行图」**标签页。它把一个会话轮次的活动重建为 [React Flow](https://reactflow.dev) 画布上的纵向时间轴：该轮次的 `request-header`、`assistant-message`、`tool-call` 与 `tool-result` 节点被排入自上而下堆叠的时间步，并以带箭头的边从上一步指向下一步。`turn-group` 容器节点不再绘制——每次只展示一个轮次（默认当前会话的最后一轮），容器方框已属冗余。工具调用不会按名称合并——每次调用及其结果都是独立节点，通过 `resolves` 边配对；助手消息中的工具调用块通过 `triggers` 边连接到对应的 `tool-call` 节点；同一分组内的节点按事件发生顺序通过 `sequence` 边相连。由同一条助手消息触发的并行工具调用共享一个时间步并在水平方向铺开；单列最多十个时间步，超出后换到右侧下一列，并且当某列最后一行有多个并行节点汇入下一列时，它们的连线会先经过一个汇聚圆点再折入下一列。正在运行的工具调用（存在于共享 Session 窗口的运行中调用 id 集合、尚无已完结结果）会渲染为独立的虚线脉动边框，而不会虚构一个结果。`tool-call` 卡片把 `工具` 类型标签与工具名放在同一行，参数缩略预览放在第二行。选中节点会在右侧填充一个常驻详情侧栏——可拖拽调整宽度（320–600px，可折叠）——工具调用显示 `Payload` JSON 树，shell 命令显示按行拆分的命令块。画布上方的轮次选择框列出每个轮次并默认最后一轮；切换轮次会把画布以 scale 1 重新居中。画布左下角的下载按钮可将整张执行图导出为 PNG。该包不提供 service，也不声明 Context 合并；它会注册 target 专属 Conversation Event Definition、Graph 视图快照构建器，以及会话 `'conversation.view'` slot 环中的一个视图标签页。

## 插件声明与生命周期

这是一个纯消费型 Cordis 插件，包含两个入口面：

- **Node 半边**（`src/index.ts`）——一个空操作的 `apply()`；插件没有 host 侧行为。
- **Client 半边**（`src/client/index.ts`）——真正的插件。它导出 `inject` 与 `apply(ctx)`，遵循 DSH 函数插件约定（无默认导出）。

`apply(ctx)` 精确执行以下副作用，每一项都通过 Cordis 的 effect 系统可逆注册，卸载时完整逆转：

1. **语言词典**——`ctx.effect(() => ctx.locale.register('graph', { zh, en }))`；卸载时注销 `graph` 命名空间。
2. **React Flow 样式表**——`installGraphStyles(ctx)` 为内置的 React Flow 基础样式表注入一个带插件标记的 `<style>` 元素；effect 的 disposer 在卸载时移除该标签。
3. **会话事件定义**——`registerGraphNodeDefinitions(ctx)` 把 `request/header`、`assistant/message`、`user/message` 以及 `tool/call`→`tool/result` 事件折叠成图贡献。
4. **会话视图定义**——`registerGraphConversationView(ctx)` 注册 `graph` target 的快照构建器。
5. **UI 插槽**——`ctx.slots.inject('conversation.view', () => ctx.slots.register({ id: 'graph', … }, GraphView))`；`slots.register` 返回 disposer 并挂在 slot 服务的 effect 包装上，卸载时移除该标签页。

由于所有贡献都经由 `ctx.effect` / `ctx.on` 以及 `slots.register` 返回的 disposer，卸载插件（或 dispose 其 fiber）会移除标签页、语言词典与样式表，使系统恢复到加载前状态。插件不写入任何配置行，因此磁盘上无需清理。框架原生支持 HMR：禁用插件的配置变更会卸载这些副作用；除框架自身的重载外无需手动重启。

## 服务依赖与注入

`inject = ['slots', 'conversationEvents', 'conversationViews', 'locale']`。

这些是插件加载时所需的服务，均由基础 DSH 客户端栈（`@deepseek-ai/dsh-base` 与 web 表面）提供，并通过包的 `dsh.client.inject` 清单声明。插件不声明可选依赖，也不对可选服务调用 `ctx.get()`。因为声明了注入，Cordis 会在某个依赖服务被卸载时自动 dispose 该插件，并在服务恢复后重新挂载——插件自身无需感知依赖丢失。

## 配置与作用域

插件**没有用户可配置项**，不接受 `config:` 块；它的启停仅由是否出现在启动名册中决定。它运行在全局客户端作用域——贡献一个对所有会话都可见的会话视图标签页——且不持有任何按会话或按用户的状态；所有渲染状态都从会话自身的视图快照派生。

## 安装方式

用 `dsh plugin` 把插件安装到 profile，它会读取包的 `dsh.bundle` 清单：

```sh
dsh plugin --profile <name> add dsh-plugin-execution-graph
```

bundle 的 `cordis.patch.yml` 向客户端名册追加一行：

```yaml
- insert:
    - id: execution-graph
      name: dsh-plugin-execution-graph
```

由于插件没有配置项，用户无需自行编辑 `cordis.patch.yml`；禁用它的方式是 `dsh plugin --profile <name> remove dsh-plugin-execution-graph`。

### 前置要求

- 承载客户端 web 表面的 DSH 运行时（带 web 配置的 `dsh` CLI），且运行在 **`@next` 线**上——即 DSH 核心包（`@deepseek-ai/dsh-client-*`、`@deepseek-ai/dsh-*`）为 `^0.1.1-rc.2`、`@deepseek-ai/cordis` 为 `^4.0.1`，与本包 `peerDependencies` 声明完全一致。DSH 把这套版本发布在 npm 的 `next` dist-tag 下（`latest` 仍指向较旧的 `0.0.1-rc.1`），因此使用方 profile 需从 `@next` 安装 DSH 核心。
- `@deepseek-ai/dsh-client-ui-primitives` 与 `@deepseek-ai/dsh-client-ui-slots` **不是** peer 依赖：它们是 DSH host 共享进冻结模块表的 platform module，插件的 client bundle 以外部引用方式由 host 解析。
- 从源码构建需要 Node.js ≥ 22 与 pnpm。

## 扩展点与兼容性

插件只使用官方 DSH 扩展点，绝不 fork 或补丁核心代码：

- **会话事件定义**（`conversationEvents`）与**会话视图定义**（`conversationViews`）——与 Trajectory 相同的两层 fold/build 管线，把会话事件投影为 `GraphSnapshot`。
- **UI 插槽**——注入 `'conversation.view'` slot 环（id `graph`、order 20），与 Chat、Trajectory 并列。
- **Locale**——注册 `graph` 词典命名空间。

**契约测试。** 包内有一个 client-bundle 测试，通过 `window.__ModuleLoader__.load` 加载构建产物 `lib/client.js`，断言 handoff id 与 `apply`/`inject` 导出；还有一个视图测试，把插件挂载到真实 `SlotRegistry` 环上并断言标签页出现。另有一个**卸载测试**，dispose fiber 后断言视图标签页、会话事件注册与视图构建器注册全部被移除。

## 模型体验

无。图视图在浏览器中渲染会话数据；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **每次快照变化都会重新计算布局**——时间轴在每次渲染时都会从头重新布局，而不是只增量重新定位新节点，因此很长的会话在每次更新时都要承受不断增长的布局开销。目前没有分页或窗口化机制；视图始终渲染选中轮次的全部内容。
- **内置 React Flow 基础样式表**——功能性布局样式被复制到 `src/client/styles/reactflow-base.css`，并作为插件自有的 `<style>` 标签注入，因为客户端打包器按导入方相对路径解析 `.css` 导入，无法直接接受裸包 `@xyflow/react/dist/base.css` 导入。升级 `@xyflow/react` 依赖时需同步更新该副本。
