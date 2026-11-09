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
  | "filter.loadMore"
  | "filter.loadEarlier"
  | "filter.loadingEarlier"
  | "detail.empty"
  | "detail.noPrompt"
  | "detail.payload"
  | "detail.command"
  | "detail.reasoning"
  | "detail.toolCalls"
  | "detail.assistantEmpty"
  | "controls.scrollTop"
  | "markdown.copyCode"
  | "markdown.copiedCode"
  | "markdown.footnotes"
  | "detail.copyMarkdown"
  | "detail.copied"
  | "detail.copyMarkdownDone"
  | "sidebar.resize"
  | "sidebar.close"
  | "export.png"
  | "fold.collapse"
  | "fold.expand"
  | "fold.collapsedCount"
  | "layout.singleColumn"
  | "layout.default"
  | "json.copyValue"
  | "json.copyJson"
  | "json.copyPath"
  | "json.copyPrettyJson"
  | "json.copyCompactJson"
  | "json.copied"
  | "json.copyFailed"
  | "json.collapseNode"
  | "json.expandNode"
  | "json.copyButtonTitle";

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
  "filter.loadMore": "加载更多（还剩 {{count}} 轮）",
  "filter.loadEarlier": "加载更早轮次",
  "filter.loadingEarlier": "正在加载更早轮次…",
  "detail.empty": "点击左侧节点查看详情",
  "detail.noPrompt": "该轮次暂无用户提问",
  "detail.payload": "原始参数",
  "detail.command": "命令",
  "detail.reasoning": "思考过程",
  "detail.toolCalls": "工具调用",
  "detail.assistantEmpty": "该回复没有可展示的文本",
  "controls.scrollTop": "回到顶部",
  "markdown.copyCode": "复制代码",
  "markdown.copiedCode": "已复制",
  "markdown.footnotes": "脚注",
  "detail.copyMarkdown": "复制 Markdown",
  "detail.copied": "已复制",
  "detail.copyMarkdownDone": "Markdown 内容复制成功",
  "sidebar.resize": "拖拽调整面板宽度",
  "sidebar.close": "关闭详情面板",
  "export.png": "保存为 PNG 图片",
  "fold.collapse": "收起本轮工具调用",
  "fold.expand": "展开本轮工具调用",
  "fold.collapsedCount": "已收起 {{count}} 个节点",
  "layout.singleColumn": "全部一列",
  "layout.default": "恢复默认",
  "json.copyValue": "复制值",
  "json.copyJson": "复制 JSON",
  "json.copyPath": "复制路径",
  "json.copyPrettyJson": "复制格式化 JSON",
  "json.copyCompactJson": "复制紧凑 JSON",
  "json.copied": "已复制",
  "json.copyFailed": "复制失败",
  "json.collapseNode": "折叠",
  "json.expandNode": "展开",
  "json.copyButtonTitle": "复制：{{action}}",
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
  "filter.loadMore": "Load more ({{count}} remaining)",
  "filter.loadEarlier": "Load earlier turns",
  "filter.loadingEarlier": "Loading earlier turns…",
  "detail.empty": "Select a node on the left to see its detail",
  "detail.noPrompt": "No user prompt captured yet for this turn",
  "detail.payload": "Payload",
  "detail.command": "Command",
  "detail.reasoning": "Reasoning",
  "detail.toolCalls": "Tool calls",
  "detail.assistantEmpty": "This reply has no text content",
  "controls.scrollTop": "Scroll to top",
  "markdown.copyCode": "Copy code",
  "markdown.copiedCode": "Copied",
  "markdown.footnotes": "Footnotes",
  "detail.copyMarkdown": "Copy Markdown",
  "detail.copied": "Copied",
  "detail.copyMarkdownDone": "Markdown copied to clipboard",
  "sidebar.resize": "Drag to resize the panel",
  "sidebar.close": "Close the detail panel",
  "export.png": "Save as PNG image",
  "fold.collapse": "Collapse this turn's tool calls",
  "fold.expand": "Expand this turn's tool calls",
  "fold.collapsedCount": "{{count}} nodes collapsed",
  "layout.singleColumn": "Single column",
  "layout.default": "Restore default",
  "json.copyValue": "Copy value",
  "json.copyJson": "Copy JSON",
  "json.copyPath": "Copy path",
  "json.copyPrettyJson": "Copy pretty JSON",
  "json.copyCompactJson": "Copy compact JSON",
  "json.copied": "Copied",
  "json.copyFailed": "Copy failed",
  "json.collapseNode": "Collapse",
  "json.expandNode": "Expand",
  "json.copyButtonTitle": "Copy: {{action}}",
};
