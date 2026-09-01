import type {
  GraphCardNode,
  GraphContainsEdge,
  GraphEdge,
  GraphSnapshot,
} from "./graph-contract.ts";
import { endpointElementId, nodeElementId } from "./graph-contract.ts";

/** Default node box width (request-header, assistant-message, tool-call). */
const NODE_WIDTH = 220;
/** `tool-result` nodes share the default width so a call and its result align. */
const TOOL_RESULT_NODE_WIDTH = 220;
/** Fixed node box height; every card renders its label rows inside it. */
const NODE_HEIGHT = 64;
/** Timeline steps stacked vertically before a run wraps into the next column block. */
const ROWS_PER_COLUMN = 10;
/** Vertical gap between two stacked timeline steps, leaving room for the connecting arrow. */
const ROW_GAP = 56;
/** Horizontal gap between two column blocks. */
const COLUMN_GAP = 72;
/** Horizontal gap between parallel sibling nodes sharing one timeline step. */
const SIBLING_GAP = 32;
/** Radius of a merge-junction dot, used only to size the canvas around it. */
const JUNCTION_RADIUS = 7;

/**
 * One positioned business node ready for React Flow placement. `x`/`y` are the
 * node box's top-left corner (React Flow's `position` convention), not its
 * center.
 */
export interface PositionedGraphNode {
  /** Whole-node element id (`kind:id`), the React Flow node id and edge endpoint. */
  readonly id: string;
  readonly node: GraphCardNode;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One positioned edge reduced to its React Flow source/target node ids. */
export interface PositionedGraphEdge {
  /** Never `contains`: turn-group membership is expressed by which turn is shown, not a drawn connector. */
  readonly edge: Exclude<GraphEdge, GraphContainsEdge>;
  /** Source node element id, matching a {@link PositionedGraphNode.id}. */
  readonly source: string;
  /** Target node element id, matching a {@link PositionedGraphNode.id}. */
  readonly target: string;
  /** Draw as a right-angle (step) connector rather than the default curve (merge-junction edges). */
  readonly orthogonal?: boolean;
}

/**
 * A synthesized merge point: when a column's last row holds several nodes that
 * all feed one node at the start of the next column, their connectors converge
 * on this small junction, which then bends into that next-column node. Purely a
 * layout artifact — it carries no business data and is drawn as a small dot.
 */
export interface GraphJunction {
  /** Junction element id (`junction:<targetId>`), usable as an edge endpoint. */
  readonly id: string;
  /** Center x of the dot. */
  readonly x: number;
  /** Center y of the dot. */
  readonly y: number;
}

/** Laid-out graph ready for React Flow, plus the canvas size it occupies. */
export interface GraphLayout {
  readonly nodes: readonly PositionedGraphNode[];
  readonly edges: readonly PositionedGraphEdge[];
  readonly junctions: readonly GraphJunction[];
  readonly width: number;
  readonly height: number;
}

const EMPTY_LAYOUT: GraphLayout = {
  nodes: [],
  edges: [],
  junctions: [],
  width: 0,
  height: 0,
};

/** Append `value` to the array stored at `key`, creating the array on first use. */
function pushToBucket<K, V>(bucket: Map<K, V[]>, key: K, value: V): void {
  const existing = bucket.get(key);
  if (existing === undefined) bucket.set(key, [value]);
  else existing.push(value);
}

function nodeWidth(node: GraphCardNode): number {
  return node.kind === "tool-result" ? TOOL_RESULT_NODE_WIDTH : NODE_WIDTH;
}

/** Horizontal sort key placing earlier events left of later ones within a timeline step. */
function horizontalOrder(node: GraphCardNode): number {
  return node.seq;
}

/**
 * Longest-path rank (0-based timeline step) for each node over the causal edge
 * set (`sequence` ∪ `triggers` ∪ `resolves`; `contains` is layout-irrelevant).
 * A node's rank is one past the deepest predecessor, so an assistant message's
 * parallel tool calls share a rank (all triggered from the same message) and
 * the next step that consumes their results ranks one below the deepest result
 * — the fan-out/fan-in shape the snapshot builder's edges already describe.
 *
 * @param nodes - Placed business nodes (turn-group already excluded).
 * @param snapshot - Snapshot supplying the edges between them.
 * @returns Each node's element id mapped to its rank.
 */
function computeRanks(
  nodes: readonly GraphCardNode[],
  snapshot: GraphSnapshot,
): ReadonlyMap<string, number> {
  const ids = new Set(nodes.map(nodeElementId));
  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>(
    nodes.map((node) => [nodeElementId(node), 0]),
  );
  for (const edge of snapshot.edges) {
    if (edge.kind === "contains") continue;
    const source = endpointElementId(edge.from);
    const target = endpointElementId(edge.to);
    if (!ids.has(source) || !ids.has(target)) continue;
    pushToBucket(outgoing, source, target);
    // `target` is in `ids`, so it was seeded in `indegree` above.
    indegree.set(target, (indegree.get(target) as number) + 1);
  }

  // Every node id is seeded in `rank` and `pending`, so their `.get` never misses.
  const rank = new Map<string, number>(
    nodes.map((node) => [nodeElementId(node), 0]),
  );
  const pending = new Map(indegree);
  const queue = [...pending.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([id]) => id);
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head] as string;
    for (const target of outgoing.get(current) ?? []) {
      rank.set(
        target,
        Math.max(rank.get(target) as number, (rank.get(current) as number) + 1),
      );
      const remaining = (pending.get(target) as number) - 1;
      pending.set(target, remaining);
      if (remaining === 0) queue.push(target);
    }
  }
  return rank;
}

/**
 * Position one session-turn's activity as a vertical timeline for React Flow.
 * Turn-group nodes are dropped: only one turn is shown at a time, so its
 * container box would be redundant chrome. Every other node is ranked by
 * {@link computeRanks} into timeline steps stacked top-to-bottom; a step's
 * parallel siblings spread horizontally, and after {@link ROWS_PER_COLUMN}
 * steps the timeline wraps into the next column block to the right. `x`/`y`
 * are top-left corners; edges carry React Flow source/target ids.
 *
 * @param snapshot - Graph snapshot to lay out (already narrowed to one turn).
 * @returns Positioned nodes/edges and the overall canvas size.
 */
export function layoutGraphSnapshot(snapshot: GraphSnapshot): GraphLayout {
  const placed = snapshot.nodes.filter((node) => node.kind !== "turn-group");
  if (placed.length === 0) return EMPTY_LAYOUT;

  const rank = computeRanks(placed, snapshot);
  const rows = new Map<number, GraphCardNode[]>();
  for (const node of placed) {
    // Every placed node was seeded in `rank` by computeRanks.
    pushToBucket(rows, rank.get(nodeElementId(node)) as number, node);
  }

  const rowWidth = (members: readonly GraphCardNode[]): number =>
    members.reduce((sum, member) => sum + nodeWidth(member), 0) +
    SIBLING_GAP * (members.length - 1);
  const columnStride =
    Math.max(...[...rows.values()].map(rowWidth)) + COLUMN_GAP;
  const maxRowWidth = columnStride - COLUMN_GAP;

  const positioned: PositionedGraphNode[] = [];
  let maxX = 0;
  let maxY = 0;
  for (const [nodeRank, members] of rows) {
    const columnBlock = Math.floor(nodeRank / ROWS_PER_COLUMN);
    const rowInColumn = nodeRank % ROWS_PER_COLUMN;
    const y = rowInColumn * (NODE_HEIGHT + ROW_GAP);
    const blockCenterX = columnBlock * columnStride + maxRowWidth / 2;
    const ordered = [...members].sort(
      (left, right) => horizontalOrder(left) - horizontalOrder(right),
    );
    let cursorX = blockCenterX - rowWidth(ordered) / 2;
    for (const node of ordered) {
      const width = nodeWidth(node);
      positioned.push({
        id: nodeElementId(node),
        node,
        x: cursorX,
        y,
        width,
        height: NODE_HEIGHT,
      });
      maxX = Math.max(maxX, cursorX + width);
      maxY = Math.max(maxY, y + NODE_HEIGHT);
      cursorX += width + SIBLING_GAP;
    }
  }

  const ids = new Set(positioned.map((entry) => entry.id));
  const positionById = new Map(positioned.map((entry) => [entry.id, entry]));
  const rankById = rank;
  const kindById = new Map(positioned.map((entry) => [entry.id, entry.node.kind]));

  // Consecutive assistant-message ("模型回复") nodes are chained by a `sequence`
  // edge only to convey ordering; drawing that connector clutters the timeline,
  // so it is dropped from rendering (ranking already used it, via computeRanks).
  const isAssistantToAssistantSequence = (
    edge: Exclude<GraphEdge, GraphContainsEdge>,
  ): boolean =>
    edge.kind === "sequence" &&
    kindById.get(endpointElementId(edge.from)) === "assistant-message" &&
    kindById.get(endpointElementId(edge.to)) === "assistant-message";

  const causalEdges = snapshot.edges.filter(
    (edge): edge is Exclude<GraphEdge, GraphContainsEdge> =>
      edge.kind !== "contains" &&
      ids.has(endpointElementId(edge.from)) &&
      ids.has(endpointElementId(edge.to)) &&
      !isAssistantToAssistantSequence(edge),
  );

  // A rank is a column's last row when it is the deepest row of its block.
  const isColumnTail = (nodeRank: number): boolean =>
    nodeRank % ROWS_PER_COLUMN === ROWS_PER_COLUMN - 1;

  // Nodes by rank, to find a column-tail row holding several parallel nodes.
  const nodesByRank = new Map<number, string[]>();
  for (const entry of positioned) {
    pushToBucket(nodesByRank, rankById.get(entry.id) as number, entry.id);
  }

  const junctions: GraphJunction[] = [];
  // Cross-column edges (tail-row node → next-column node) rerouted via a junction,
  // keyed by the edge's source→target ids so we skip drawing them straight later.
  const reroutedEdgeKeys = new Set<string>();
  const edges: PositionedGraphEdge[] = [];

  for (const [tailRank, tailIds] of nodesByRank) {
    if (!isColumnTail(tailRank) || tailIds.length < 2) continue;
    // Cross-column edges leaving this tail row: source in the tail, target in the
    // next column (rank one deeper, which wraps to the next block's first row).
    const crossing = causalEdges.filter((edge) => {
      const source = endpointElementId(edge.from);
      const target = endpointElementId(edge.to);
      return (
        tailIds.includes(source) &&
        (rankById.get(target) as number) === tailRank + 1
      );
    });
    // Need at least two tail nodes actually feeding the next column to merge.
    const feedingSources = new Set(crossing.map((edge) => endpointElementId(edge.from)));
    if (feedingSources.size < 2) continue;

    // One junction for the whole tail row, centered under its feeding nodes and
    // sitting just below the row, so the parallel outputs visually converge first.
    const sourceNodes = [...feedingSources].map(
      (id) => positionById.get(id) as PositionedGraphNode,
    );
    const sourceBottom = Math.max(
      ...sourceNodes.map((entry) => entry.y + entry.height),
    );
    const junctionX =
      sourceNodes.reduce((sum, entry) => sum + entry.x + entry.width / 2, 0) /
      sourceNodes.length;
    const junctionId = `junction:col${tailRank}`;
    junctions.push({ id: junctionId, x: junctionX, y: sourceBottom + ROW_GAP });

    // Each feeding tail node → junction (right-angle), then junction → every
    // next-column target (right-angle), so the merge fans back out cleanly.
    for (const source of feedingSources) {
      const anyEdge = crossing.find((edge) => endpointElementId(edge.from) === source);
      edges.push({
        edge: anyEdge as Exclude<GraphEdge, GraphContainsEdge>,
        source,
        target: junctionId,
        orthogonal: true,
      });
    }
    for (const edge of crossing) {
      reroutedEdgeKeys.add(
        `${endpointElementId(edge.from)}->${endpointElementId(edge.to)}`,
      );
      edges.push({
        edge,
        source: junctionId,
        target: endpointElementId(edge.to),
        orthogonal: true,
      });
    }
  }

  for (const edge of causalEdges) {
    const source = endpointElementId(edge.from);
    const target = endpointElementId(edge.to);
    if (reroutedEdgeKeys.has(`${source}->${target}`)) continue;
    edges.push({ edge, source, target });
  }

  // Junctions sit below their column-tail row, so extend the canvas extent to
  // include them; otherwise the PNG export (sized from width/height) clips them.
  let extentX = maxX;
  let extentY = maxY;
  for (const junction of junctions) {
    extentX = Math.max(extentX, junction.x + JUNCTION_RADIUS);
    extentY = Math.max(extentY, junction.y + JUNCTION_RADIUS);
  }

  return { nodes: positioned, edges, junctions, width: extentX, height: extentY };
}
