/** `graph` namespace dictionary (view tab label + node/edge legend strings). */

/** Dictionary namespace owned by this plugin. */
export const NS = "graph";

/** The graph dictionary key set (the source of truth for both locales). */
export type GraphKey =
  | "view.graph"
  | "legend.aria"
  | "node.turnGroup"
  | "node.userMessage"
  | "node.requestHeader"
  | "node.assistantMessage"
  | "node.tool"
  | "node.toolResult"
  | "node.toolError"
  | "node.fileRead"
  | "empty"
  | "filter.ariaLabel"
  | "filter.turnOption"
  | "detail.empty"
  | "detail.noPrompt"
  | "detail.payload"
  | "detail.command"
  | "sidebar.resize"
  | "sidebar.close"
  | "export.png"
  | "fold.collapse"
  | "fold.expand"
  | "fold.collapsedCount";

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    /** The graph view tab label and node/edge legend strings. */
    graph: GraphKey;
  }
}

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh: Record<GraphKey, string> = {
  "view.graph": "执行图",
  "legend.aria": "会话活动执行图",
  "node.turnGroup": "第 {{turn}} 轮",
  "node.userMessage": "用户提问",
  "node.requestHeader": "请求",
  "node.assistantMessage": "模型回复",
  "node.tool": "工具",
  "node.toolResult": "工具结果",
  "node.toolError": "出错",
  "node.fileRead": "文件读取",
  empty: "当前会话暂无活动",
  "filter.ariaLabel": "选择轮次",
  "filter.turnOption": "第 {{turn}} 轮 · {{preview}}",
  "detail.empty": "点击左侧节点查看详情",
  "detail.noPrompt": "该轮次暂无用户提问",
  "detail.payload": "原始参数",
  "detail.command": "命令",
  "sidebar.resize": "拖拽调整面板宽度",
  "sidebar.close": "关闭详情面板",
  "export.png": "保存为 PNG 图片",
  "fold.collapse": "收起本轮工具调用",
  "fold.expand": "展开本轮工具调用",
  "fold.collapsedCount": "已收起 {{count}} 个节点",
};

/** English dictionary. */
export const en: Record<GraphKey, string> = {
  "view.graph": "Execution graph",
  "legend.aria": "Session activity execution graph",
  "node.turnGroup": "Turn {{turn}}",
  "node.userMessage": "User prompt",
  "node.requestHeader": "Request",
  "node.assistantMessage": "Assistant message",
  "node.tool": "Tool",
  "node.toolResult": "Tool result",
  "node.toolError": "Error",
  "node.fileRead": "File read",
  empty: "No activity yet in this session",
  "filter.ariaLabel": "Select turn",
  "filter.turnOption": "Turn {{turn}} · {{preview}}",
  "detail.empty": "Select a node on the left to see its detail",
  "detail.noPrompt": "No user prompt captured yet for this turn",
  "detail.payload": "Payload",
  "detail.command": "Command",
  "sidebar.resize": "Drag to resize the panel",
  "sidebar.close": "Close the detail panel",
  "export.png": "Save as PNG image",
  "fold.collapse": "Collapse this turn's tool calls",
  "fold.expand": "Expand this turn's tool calls",
  "fold.collapsedCount": "{{count}} nodes collapsed",
};
