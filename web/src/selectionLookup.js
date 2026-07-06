const MAX_SELECTION_LENGTH = 12;

// nodes: [{ id, name, aliases }] → { exactMap, entries }
export function buildLookup(nodes) {
  const exactMap = new Map();
  const entries = [];
  for (const node of nodes || []) {
    const names = [node.name, ...(Array.isArray(node.aliases) ? node.aliases : [])].filter(Boolean);
    for (const name of names) {
      exactMap.set(name, node);
      entries.push({ name, node });
    }
  }
  return { exactMap, entries };
}

// 返回 { ...node, exact } 或 null
export function matchSelection(rawText, lookup) {
  const text = (rawText || "").trim();
  if (!text || text.length > MAX_SELECTION_LENGTH) return null;

  const exactHit = lookup.exactMap.get(text);
  if (exactHit) return { ...exactHit, exact: true };

  const candidates = [];
  const seenIds = new Set();
  for (const { name, node } of lookup.entries) {
    if (name.includes(text) && !seenIds.has(node.id)) {
      seenIds.add(node.id);
      candidates.push(node);
    }
  }
  if (candidates.length === 1) return { ...candidates[0], exact: false };
  return null;
}
