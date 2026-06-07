import { useEffect, useRef } from "react";

const edgeColors = {
  冲突: "#9c241d",
  敌对: "#9c241d",
  怀疑: "#b0342a",
  调查: "#a8552a",
  亲属: "#9a7b45",
  同事: "#9a7b45",
  朋友: "#7e6a3a"
};

const CARD_W = 134;
const CARD_H = 86;
const SAFE_PAD_X = 18;
const SAFE_PAD_TOP = 30;

const themes = {
  light: {
    corkA: "#caa869",
    corkB: "#b8924f",
    speck: "rgba(90, 60, 24, 0.16)",
    vignette: "rgba(60, 40, 14, 0.34)",
    cardFill: "#fbf6ea",
    cardFillB: "#f1e7d0",
    cardBorder: "#d7c39c",
    cardText: "#2a2017",
    cardMuted: "#8a7763",
    red: "#a3302a",
    amber: "#b5731f",
    pin: "#b0342a",
    string: "#b0342a",
    label: "#fbf6ea",
    labelText: "#3a2c20",
    panelBg: "rgba(251, 246, 234, 0.92)",
    panelBorder: "rgba(140, 110, 60, 0.5)",
    text: "#2a2017",
    muted: "#7a6748"
  },
  dark: {
    corkA: "#2a2016",
    corkB: "#1a140d",
    speck: "rgba(220, 190, 130, 0.12)",
    vignette: "rgba(0, 0, 0, 0.55)",
    cardFill: "#f3ead0",
    cardFillB: "#e4d6b6",
    cardBorder: "#a98f63",
    cardText: "#241c12",
    cardMuted: "#7c6a4c",
    red: "#d4564a",
    amber: "#d89441",
    pin: "#d4564a",
    string: "#c4413a",
    label: "#2a2219",
    labelText: "#ece2cd",
    panelBg: "rgba(34, 27, 18, 0.9)",
    panelBorder: "rgba(120, 92, 50, 0.6)",
    text: "#ece2cd",
    muted: "#b6a384"
  }
};

const EMPTY_GRAPH = { nodes: [], edges: [] };

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getPoint(event, element) {
  const rect = element.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function safeBounds(width, height) {
  const mobile = width < 520;
  return {
    minX: CARD_W / 2 + SAFE_PAD_X,
    maxX: Math.max(CARD_W / 2 + SAFE_PAD_X, width - CARD_W / 2 - SAFE_PAD_X),
    minY: CARD_H / 2 + SAFE_PAD_TOP,
    maxY: Math.max(CARD_H / 2 + SAFE_PAD_TOP, height - CARD_H / 2 - (mobile ? 86 : 62))
  };
}

function clampNode(node, width, height) {
  const bounds = safeBounds(width, height);
  node.x = clamp(node.x, bounds.minX, bounds.maxX);
  node.y = clamp(node.y, bounds.minY, bounds.maxY);
}

function wrapText(ctx, text, maxWidth, maxLines = 2) {
  const chars = Array.from(text || "");
  const lines = [];
  let line = "";
  chars.forEach((char) => {
    const next = `${line}${char}`;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = char;
    } else {
      line = next;
    }
  });
  if (line) lines.push(line);
  return lines.slice(0, maxLines);
}

function createSpecks(width, height) {
  const count = Math.min(220, Math.max(80, Math.floor((width * height) / 5200)));
  return Array.from({ length: count }, (_, index) => {
    const seed = hashString(`speck-${index}-${width}-${height}`);
    return {
      x: ((seed % 1000) / 1000) * width,
      y: (((seed / 1000) % 1000) / 1000) * height,
      r: 0.5 + ((seed / 7) % 100) / 90,
      a: 0.3 + ((seed / 13) % 100) / 200
    };
  });
}

function pairKey(edge) {
  return [edge.source.id, edge.target.id].sort().join("::");
}

function assignParallelOffsets(edges) {
  const groups = new Map();
  edges.forEach((edge) => {
    const key = pairKey(edge);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(edge);
  });

  groups.forEach((group) => {
    group.forEach((edge, index) => {
      const middle = (group.length - 1) / 2;
      const direction = edge.source.id <= edge.target.id ? 1 : -1;
      edge.pairIndex = index;
      edge.pairCount = group.length;
      edge.curveOffset = (index - middle) * 24 * direction;
    });
  });
}

function buildGraphState(graph, previousState, width, height, currentChapter, revealedKeys, reducedMotion) {
  const graphNodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const graphEdges = Array.isArray(graph?.edges) ? graph.edges : [];
  const previousNodes = new Map((previousState?.nodes || []).map((node) => [node.id, node]));
  const centerX = width / 2 || 360;
  const centerY = height / 2 || 280;

  const nodes = graphNodes.map((node, index) => {
    const id = String(node.id);
    const previous = previousNodes.get(id);
    const seed = hashString(`${id}-${node.name}`);
    const spiralAngle = index * 2.39996323;
    const spiralR = Math.min(170, 42 * Math.sqrt(index));
    const nextNode = {
      id,
      rawId: node.id,
      name: node.name,
      identity: node.identity,
      firstSeenChapter: node.first_seen_chapter,
      newlyRevealed: node.first_seen_chapter === currentChapter,
      x: previous?.x ?? centerX + Math.cos(spiralAngle) * spiralR,
      y: previous?.y ?? centerY + Math.sin(spiralAngle) * spiralR,
      vx: previous?.vx ?? 0,
      vy: previous?.vy ?? 0,
      tilt: ((seed % 100) / 100 - 0.5) * 0.13,
      seed,
      dragging: false
    };
    clampNode(nextNode, width, height);
    return nextNode;
  });

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges = graphEdges
    .map((edge) => {
      const source = nodeById.get(String(edge.source));
      const target = nodeById.get(String(edge.target));
      if (!source || !target) return null;
      return {
        id: String(edge.id),
        source,
        target,
        sourceName: source.name,
        targetName: target.name,
        type: edge.type,
        description: edge.description,
        revealChapter: edge.reveal_chapter,
        newlyRevealed: edge.reveal_chapter === currentChapter,
        color: edgeColors[edge.type] || "#b0342a",
        pairIndex: 0,
        pairCount: 1,
        curveOffset: 0
      };
    })
    .filter(Boolean);

  assignParallelOffsets(edges);

  const state = {
    width,
    height,
    nodes,
    edges,
    particles: previousState?.particles || [],
    specks: createSpecks(width, height),
    hoverNodeId: null,
    hoverEdgeId: null,
    hoverEdgePoint: null,
    draggingNode: null,
    pointerDown: null,
    layoutTicks: reducedMotion ? 84 : 0,
    lastTime: performance.now()
  };

  nodes.forEach((node) => {
    const revealKey = `node:${node.id}:${currentChapter}`;
    if (!reducedMotion && node.newlyRevealed && !revealedKeys.has(revealKey)) {
      revealedKeys.add(revealKey);
      pushBurst(state, node.x, node.y - CARD_H / 2, "#b5731f", 16);
    }
  });

  edges.forEach((edge) => {
    const revealKey = `edge:${edge.id}:${currentChapter}`;
    if (!reducedMotion && edge.newlyRevealed && !revealedKeys.has(revealKey)) {
      revealedKeys.add(revealKey);
      const mid = curvePoint(edge, 0.5);
      pushBurst(state, mid.x, mid.y, edge.color, 10);
    }
  });

  return state;
}

function pushBurst(state, x, y, color, count) {
  for (let index = 0; index < count; index += 1) {
    const angle = (Math.PI * 2 * index) / count + (index % 3) * 0.17;
    const speed = 1.1 + (index % 5) * 0.22;
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 42 + (index % 12),
      maxLife: 54,
      size: 1.5 + (index % 4) * 0.35,
      color
    });
  }
}

function hitNode(state, point) {
  for (let index = state.nodes.length - 1; index >= 0; index -= 1) {
    const node = state.nodes[index];
    if (Math.abs(point.x - node.x) <= CARD_W / 2 + 8 && Math.abs(point.y - node.y) <= CARD_H / 2 + 8) {
      return node;
    }
  }
  return null;
}

function curveControl(edge) {
  const sx = edge.source.x;
  const sy = edge.source.y;
  const tx = edge.target.x;
  const ty = edge.target.y;
  const dx = tx - sx;
  const dy = ty - sy;
  const length = Math.max(1, Math.hypot(dx, dy));
  const nx = -dy / length;
  const ny = dx / length;
  const sag = Math.min(34, length * 0.06);
  return {
    x: (sx + tx) / 2 + nx * edge.curveOffset,
    y: (sy + ty) / 2 + ny * edge.curveOffset + sag
  };
}

function curvePoint(edge, t) {
  const c = curveControl(edge);
  const mt = 1 - t;
  return {
    x: mt * mt * edge.source.x + 2 * mt * t * c.x + t * t * edge.target.x,
    y: mt * mt * edge.source.y + 2 * mt * t * c.y + t * t * edge.target.y
  };
}

function curveTangent(edge, t) {
  const c = curveControl(edge);
  return {
    x: 2 * (1 - t) * (c.x - edge.source.x) + 2 * t * (edge.target.x - c.x),
    y: 2 * (1 - t) * (c.y - edge.source.y) + 2 * t * (edge.target.y - c.y)
  };
}

function pointToQuadraticDistance(edge, point) {
  let best = null;
  let previous = curvePoint(edge, 0);
  for (let step = 1; step <= 28; step += 1) {
    const t = step / 28;
    const current = curvePoint(edge, t);
    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    const lengthSquared = dx * dx + dy * dy || 1;
    const localT = clamp(((point.x - previous.x) * dx + (point.y - previous.y) * dy) / lengthSquared, 0, 1);
    const x = previous.x + dx * localT;
    const y = previous.y + dy * localT;
    const distance = Math.hypot(point.x - x, point.y - y);
    const globalT = (step - 1 + localT) / 28;
    if (!best || distance < best.distance) best = { distance, t: globalT, x, y };
    previous = current;
  }
  return best;
}

function hitEdge(state, point) {
  let best = null;
  state.edges.forEach((edge) => {
    const hit = pointToQuadraticDistance(edge, point);
    if (hit.distance <= 12 && (!best || hit.distance < best.distance)) {
      best = { edge, ...hit };
    }
  });
  return best;
}

function isConnected(edge, nodeId) {
  return edge.source.id === nodeId || edge.target.id === nodeId;
}

function applyNodeForces(state, dt, reducedMotion) {
  const centerX = state.width / 2;
  const centerY = state.height / 2;
  const fixed = (node) => node.dragging;

  for (let aIndex = 0; aIndex < state.nodes.length; aIndex += 1) {
    const a = state.nodes[aIndex];
    for (let bIndex = aIndex + 1; bIndex < state.nodes.length; bIndex += 1) {
      const b = state.nodes[bIndex];
      const dx = b.x - a.x || 0.01;
      const dy = b.y - a.y || 0.01;
      const distanceSquared = Math.max(2400, dx * dx + dy * dy);
      const force = 1700 / distanceSquared;
      const fx = dx * force;
      const fy = dy * force;
      if (!fixed(a)) {
        a.vx -= fx * dt;
        a.vy -= fy * dt;
      }
      if (!fixed(b)) {
        b.vx += fx * dt;
        b.vy += fy * dt;
      }

      const overlapX = CARD_W + 20 - Math.abs(dx);
      const overlapY = CARD_H + 22 - Math.abs(dy);
      if (overlapX > 0 && overlapY > 0) {
        const signX = dx >= 0 ? 1 : -1;
        const signY = dy >= 0 ? 1 : -1;
        if (overlapX < overlapY) {
          const push = overlapX * 0.055 * dt;
          if (!fixed(a)) a.vx -= signX * push;
          if (!fixed(b)) b.vx += signX * push;
        } else {
          const push = overlapY * 0.055 * dt;
          if (!fixed(a)) a.vy -= signY * push;
          if (!fixed(b)) b.vy += signY * push;
        }
      }
    }
  }

  state.edges.forEach((edge) => {
    const source = edge.source;
    const target = edge.target;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const desired = clamp(118 + edge.pairCount * 8, 118, 150);
    const force = (distance - desired) * 0.014;
    const fx = (dx / distance) * force;
    const fy = (dy / distance) * force;
    if (!fixed(source)) {
      source.vx += fx * dt;
      source.vy += fy * dt;
    }
    if (!fixed(target)) {
      target.vx -= fx * dt;
      target.vy -= fy * dt;
    }
  });

  state.nodes.forEach((node) => {
    if (!fixed(node)) {
      const centerPull = reducedMotion ? 0.052 : 0.044;
      node.vx += (centerX - node.x) * centerPull * dt;
      node.vy += (centerY - node.y) * centerPull * dt;
      node.vx *= reducedMotion ? 0.7 : 0.82;
      node.vy *= reducedMotion ? 0.7 : 0.82;
      node.vx = clamp(node.vx, -6, 6);
      node.vy = clamp(node.vy, -6, 6);
      node.x += node.vx * dt;
      node.y += node.vy * dt;
    }
    clampNode(node, state.width, state.height);
  });
}

function simulate(state, delta, reducedMotion) {
  const dt = reducedMotion ? 1 : clamp(delta / 16.67, 0.25, 1.8);

  if (reducedMotion) {
    state.particles = [];
    if (state.layoutTicks > 0) {
      applyNodeForces(state, dt, true);
      state.layoutTicks -= 1;
    } else {
      state.nodes.forEach((node) => clampNode(node, state.width, state.height));
    }
    return;
  }

  applyNodeForces(state, dt, false);
  state.particles = state.particles
    .map((particle) => ({
      ...particle,
      x: particle.x + particle.vx * dt,
      y: particle.y + particle.vy * dt,
      vx: particle.vx * 0.96,
      vy: particle.vy * 0.96,
      life: particle.life - dt
    }))
    .filter((particle) => particle.life > 0)
    .slice(-160);
}

function drawRoundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawPin(ctx, x, y, color) {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 2;
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  const grad = ctx.createRadialGradient(x - 2, y - 2.4, 0.6, x, y, 6);
  grad.addColorStop(0, "#ffd0cb");
  grad.addColorStop(0.5, color);
  grad.addColorStop(1, "#742019");
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();
}

function drawArrow(ctx, edge, color, alpha) {
  const point = curvePoint(edge, 0.64);
  const tangent = curveTangent(edge, 0.64);
  const angle = Math.atan2(tangent.y, tangent.x);

  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.rotate(angle);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(8, 0);
  ctx.lineTo(-5, -4);
  ctx.lineTo(-3, 0);
  ctx.lineTo(-5, 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawString(ctx, edge, theme, active, hovered, reducedMotion, time) {
  const c = curveControl(edge);
  const strong = active || hovered;
  const newly = edge.newlyRevealed;
  const baseWidth = strong ? 3 : newly ? 2.5 : 1.65;

  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(60, 30, 18, 0.28)";
  ctx.globalAlpha = strong ? 0.86 : 0.46;
  ctx.lineWidth = baseWidth + 1.4;
  ctx.beginPath();
  ctx.moveTo(edge.source.x, edge.source.y);
  ctx.quadraticCurveTo(c.x, c.y, edge.target.x, edge.target.y);
  ctx.stroke();

  ctx.strokeStyle = strong || newly ? edge.color : theme.string;
  ctx.globalAlpha = strong ? 1 : newly ? 0.94 : 0.68;
  ctx.lineWidth = baseWidth;
  ctx.beginPath();
  ctx.moveTo(edge.source.x, edge.source.y);
  ctx.quadraticCurveTo(c.x, c.y, edge.target.x, edge.target.y);
  ctx.stroke();
  ctx.restore();

  drawArrow(ctx, edge, strong || newly ? edge.color : theme.string, strong ? 1 : 0.74);

  if (newly && !reducedMotion) {
    const t = (time * 0.0006 + edge.pairIndex * 0.13) % 1;
    const point = curvePoint(edge, t);
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = theme.amber;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawCard(ctx, node, theme, selected, hovered) {
  const newly = node.newlyRevealed;
  ctx.save();
  ctx.translate(node.x, node.y);
  ctx.rotate(node.tilt);

  const w = CARD_W;
  const h = CARD_H;
  const x = -w / 2;
  const y = -h / 2;

  ctx.shadowColor = "rgba(40, 25, 12, 0.3)";
  ctx.shadowBlur = selected || hovered ? 22 : 12;
  ctx.shadowOffsetY = selected || hovered ? 10 : 6;
  drawRoundRect(ctx, x, y, w, h, 6);
  const grad = ctx.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, theme.cardFill);
  grad.addColorStop(1, theme.cardFillB);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  ctx.fillStyle = "rgba(163, 48, 42, 0.1)";
  drawRoundRect(ctx, x, y, w, 4, 2);
  ctx.fill();

  ctx.lineWidth = selected ? 3 : newly ? 2.4 : 1.2;
  ctx.strokeStyle = selected ? theme.red : newly ? theme.amber : theme.cardBorder;
  drawRoundRect(ctx, x, y, w, h, 6);
  ctx.stroke();

  const fold = 15;
  ctx.beginPath();
  ctx.moveTo(x + w - fold, y + h);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + w, y + h - fold);
  ctx.closePath();
  const foldGrad = ctx.createLinearGradient(x + w - fold, y + h - fold, x + w, y + h);
  foldGrad.addColorStop(0, theme.cardFillB);
  foldGrad.addColorStop(1, "rgba(60, 40, 15, 0.34)");
  ctx.fillStyle = foldGrad;
  ctx.fill();
  ctx.strokeStyle = "rgba(60, 40, 15, 0.3)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + w - fold, y + h);
  ctx.lineTo(x + w, y + h - fold);
  ctx.stroke();

  ctx.fillStyle = theme.cardText;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = '700 16px "Noto Serif SC", serif';
  const nameLines = wrapText(ctx, node.name, w - 22);
  const hasIdentity = Boolean(node.identity);
  const nameStartY = (hasIdentity ? -8 : -1) - (nameLines.length - 1) * 9;
  nameLines.forEach((line, index) => {
    ctx.fillText(line, 0, nameStartY + index * 18);
  });

  if (hasIdentity) {
    ctx.font = '500 11px "Noto Serif SC", serif';
    ctx.fillStyle = theme.cardMuted;
    const identity = node.identity.length > 11 ? `${node.identity.slice(0, 11)}...` : node.identity;
    ctx.fillText(identity, 0, h / 2 - 14);
  }

  if (newly) {
    ctx.save();
    ctx.translate(w / 2 - 16, -h / 2 + 13);
    ctx.rotate(-0.18);
    ctx.fillStyle = theme.amber;
    drawRoundRect(ctx, -12, -9, 24, 18, 3);
    ctx.fill();
    ctx.fillStyle = "#fff6e6";
    ctx.font = '800 11px "Noto Serif SC", serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("新", 0, 0.5);
    ctx.restore();
  }

  ctx.restore();

  const pinX = node.x + (h / 2 - 4) * Math.sin(node.tilt);
  const pinY = node.y - (h / 2 - 4) * Math.cos(node.tilt);
  drawPin(ctx, pinX, pinY, newly ? theme.amber : theme.pin);
}

function drawBoard(ctx, state, theme) {
  const grad = ctx.createRadialGradient(
    state.width / 2,
    state.height / 2,
    Math.min(state.width, state.height) * 0.1,
    state.width / 2,
    state.height / 2,
    Math.max(state.width, state.height) * 0.75
  );
  grad.addColorStop(0, theme.corkA);
  grad.addColorStop(1, theme.corkB);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, state.width, state.height);

  ctx.save();
  state.specks.forEach((speck) => {
    ctx.globalAlpha = speck.a;
    ctx.fillStyle = theme.speck;
    ctx.beginPath();
    ctx.arc(speck.x, speck.y, speck.r, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();

  const vignette = ctx.createRadialGradient(
    state.width / 2,
    state.height / 2,
    Math.min(state.width, state.height) * 0.36,
    state.width / 2,
    state.height / 2,
    Math.max(state.width, state.height) * 0.72
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, theme.vignette);
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, state.width, state.height);
}

function drawEdgeTooltip(ctx, edge, point, state, theme) {
  const maxWidth = Math.min(310, state.width - 32);
  const title = `${edge.sourceName} -> ${edge.targetName} · ${edge.type}`;
  ctx.save();
  ctx.font = '700 12px "Noto Serif SC", serif';
  const titleLines = wrapText(ctx, title, maxWidth - 24, 2);
  ctx.font = '500 11px "Noto Serif SC", serif';
  const descriptionLines = edge.description ? wrapText(ctx, edge.description, maxWidth - 24, 3) : [];
  const meta = `第 ${edge.revealChapter + 1} 章揭示`;
  const width = maxWidth;
  const height = 36 + titleLines.length * 16 + descriptionLines.length * 15 + (descriptionLines.length ? 6 : 0);
  let x = point.x + 14;
  let y = point.y - height - 14;
  x = clamp(x, 12, state.width - width - 12);
  y = clamp(y, 12, state.height - height - 16);

  ctx.shadowColor = "rgba(0,0,0,0.26)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 6;
  drawRoundRect(ctx, x, y, width, height, 6);
  ctx.fillStyle = theme.panelBg;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.strokeStyle = theme.panelBorder;
  ctx.lineWidth = 1;
  drawRoundRect(ctx, x, y, width, height, 6);
  ctx.stroke();

  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = edge.color;
  ctx.font = '700 12px "Noto Serif SC", serif';
  titleLines.forEach((line, index) => {
    ctx.fillText(line, x + 12, y + 10 + index * 16);
  });
  let cursorY = y + 12 + titleLines.length * 16;
  if (descriptionLines.length) {
    ctx.fillStyle = theme.text;
    ctx.font = '500 11px "Noto Serif SC", serif';
    descriptionLines.forEach((line, index) => {
      ctx.fillText(line, x + 12, cursorY + 4 + index * 15);
    });
    cursorY += 8 + descriptionLines.length * 15;
  }
  ctx.fillStyle = theme.muted;
  ctx.font = '600 10px "Noto Serif SC", serif';
  ctx.fillText(meta, x + 12, cursorY);
  ctx.restore();
}

function drawGraph(ctx, state, selectedCharacterId, nightMode, reducedMotion, time) {
  const theme = nightMode ? themes.dark : themes.light;
  const selectedId = selectedCharacterId ? String(selectedCharacterId) : null;
  const activeNodeId = state.hoverNodeId || selectedId;
  const hoveredEdge = state.edges.find((edge) => edge.id === state.hoverEdgeId) || null;
  let labelEdge = hoveredEdge;

  drawBoard(ctx, state, theme);

  state.edges.forEach((edge) => {
    const active = Boolean(activeNodeId && isConnected(edge, activeNodeId));
    const hovered = state.hoverEdgeId === edge.id;
    drawString(ctx, edge, theme, active, hovered, reducedMotion, time);
    if (!labelEdge && selectedId && active) labelEdge = edge;
  });

  state.particles.forEach((particle) => {
    const alpha = clamp(particle.life / particle.maxLife, 0, 1);
    ctx.save();
    ctx.globalAlpha = alpha * 0.85;
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  state.nodes.forEach((node) => {
    const isSelected = selectedId === node.id;
    const isHovered = state.hoverNodeId === node.id;
    drawCard(ctx, node, theme, isSelected, isHovered);
  });

  if (labelEdge) {
    const point = state.hoverEdgePoint && state.hoverEdgeId === labelEdge.id ? state.hoverEdgePoint : curvePoint(labelEdge, 0.5);
    drawEdgeTooltip(ctx, labelEdge, point, state, theme);
  }
}

export default function GraphView({
  graph = EMPTY_GRAPH,
  currentChapter,
  selectedCharacterId,
  onSelectCharacter,
  nightMode = false,
  emptyDescription = "AI 可能仍在分析，或这些人物关系尚未在当前阅读进度揭露。"
}) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const stateRef = useRef(null);
  const rafRef = useRef(null);
  const revealedKeysRef = useRef(new Set());
  const selectedCharacterIdRef = useRef(selectedCharacterId);
  const nightModeRef = useRef(nightMode);
  const reducedMotionRef = useRef(false);

  selectedCharacterIdRef.current = selectedCharacterId;
  nightModeRef.current = nightMode;

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      reducedMotionRef.current = media.matches;
      if (media.matches && stateRef.current) stateRef.current.layoutTicks = Math.max(stateRef.current.layoutTicks, 72);
    };
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return undefined;

    const canvas = canvasRef.current;
    const container = containerRef.current;
    let resizeObserver;

    const syncSize = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(320, rect.width);
      const height = Math.max(420, rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stateRef.current = buildGraphState(
        graph,
        stateRef.current,
        width,
        height,
        currentChapter,
        revealedKeysRef.current,
        reducedMotionRef.current
      );
    };

    syncSize();
    resizeObserver = new ResizeObserver(syncSize);
    resizeObserver.observe(container);

    const frame = (time) => {
      const state = stateRef.current;
      const ctx = canvas.getContext("2d");
      if (state && ctx) {
        const delta = time - state.lastTime;
        state.lastTime = time;
        simulate(state, delta, reducedMotionRef.current);
        drawGraph(ctx, state, selectedCharacterIdRef.current, nightModeRef.current, reducedMotionRef.current, time);
      }
      rafRef.current = requestAnimationFrame(frame);
    };

    rafRef.current = requestAnimationFrame(frame);

    const releasePointer = (event) => {
      if (event?.pointerId != null && canvas.hasPointerCapture?.(event.pointerId)) {
        canvas.releasePointerCapture?.(event.pointerId);
      }
    };

    const handlePointerMove = (event) => {
      const state = stateRef.current;
      if (!state) return;
      const point = getPoint(event, canvas);

      if (state.draggingNode) {
        const node = state.draggingNode;
        const prevX = node.x;
        const prevY = node.y;
        const bounds = safeBounds(state.width, state.height);
        node.x = clamp(point.x, bounds.minX, bounds.maxX);
        node.y = clamp(point.y, bounds.minY, bounds.maxY);
        node.vx = (node.x - prevX) * 0.55;
        node.vy = (node.y - prevY) * 0.55;
        state.pointerDown.moved =
          state.pointerDown.moved || Math.hypot(point.x - state.pointerDown.x, point.y - state.pointerDown.y) > 4;
        state.hoverNodeId = node.id;
        state.hoverEdgeId = null;
        state.hoverEdgePoint = null;
        return;
      }

      const node = hitNode(state, point);
      const edgeHit = node ? null : hitEdge(state, point);
      state.hoverNodeId = node?.id || null;
      state.hoverEdgeId = edgeHit?.edge?.id || null;
      state.hoverEdgePoint = edgeHit ? { x: edgeHit.x, y: edgeHit.y } : null;
      canvas.style.cursor = node ? "grab" : edgeHit ? "help" : "auto";
    };

    const handlePointerDown = (event) => {
      const state = stateRef.current;
      if (!state) return;
      const point = getPoint(event, canvas);
      const node = hitNode(state, point);
      if (!node) return;
      event.preventDefault();
      node.dragging = true;
      state.draggingNode = node;
      state.hoverNodeId = node.id;
      state.hoverEdgeId = null;
      state.hoverEdgePoint = null;
      state.pointerDown = { x: point.x, y: point.y, nodeId: node.id, moved: false };
      canvas.style.cursor = "grabbing";
      canvas.setPointerCapture?.(event.pointerId);
    };

    const handlePointerUp = (event) => {
      const state = stateRef.current;
      if (!state) return;
      const draggingNode = state.draggingNode;
      const pointerDown = state.pointerDown;
      if (draggingNode) {
        draggingNode.dragging = false;
        state.draggingNode = null;
        releasePointer(event);
      }
      if (pointerDown && !pointerDown.moved && draggingNode) {
        onSelectCharacter(draggingNode.rawId);
      }
      state.pointerDown = null;
      canvas.style.cursor = state.hoverNodeId ? "grab" : "auto";
    };

    const handlePointerCancel = (event) => {
      const state = stateRef.current;
      if (!state) return;
      if (state.draggingNode) state.draggingNode.dragging = false;
      state.draggingNode = null;
      state.pointerDown = null;
      releasePointer(event);
      canvas.style.cursor = "auto";
    };

    const handlePointerLeave = (event) => {
      const state = stateRef.current;
      if (!state) return;
      if (state.draggingNode) {
        state.draggingNode.dragging = false;
        state.draggingNode = null;
        releasePointer(event);
      }
      state.hoverNodeId = null;
      state.hoverEdgeId = null;
      state.hoverEdgePoint = null;
      state.pointerDown = null;
      canvas.style.cursor = "auto";
    };

    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", handlePointerCancel);
    canvas.addEventListener("pointerleave", handlePointerLeave);

    return () => {
      resizeObserver?.disconnect();
      cancelAnimationFrame(rafRef.current);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerCancel);
      canvas.removeEventListener("pointerleave", handlePointerLeave);
    };
  }, [currentChapter, graph, onSelectCharacter]);

  const graphNodes = Array.isArray(graph?.nodes) ? graph.nodes : [];

  if (graphNodes.length === 0) {
    return (
      <div className={`grid h-full place-items-center p-8 text-center ${nightMode ? "casefile-dark text-[#ece2cd]" : "casefile-bg text-ink"}`}>
        <div>
          <div className="font-reader text-lg font-semibold">线索板暂时空白</div>
          <p className={`mt-2 max-w-sm text-sm ${nightMode ? "text-[#b6a384]" : "text-steel"}`}>
            {emptyDescription}
          </p>
        </div>
      </div>
    );
  }

  const theme = nightMode ? themes.dark : themes.light;

  return (
    <div ref={containerRef} className="relative h-full min-h-[420px] overflow-hidden lg:min-h-0">
      <canvas ref={canvasRef} className="absolute inset-0 touch-none" aria-label="人物关系线索板" />
      <div
        className="pointer-events-none absolute bottom-3 left-3 max-w-[calc(100%-24px)] rounded-md px-2 py-1 text-xs shadow-panel sm:bottom-5 sm:left-5 sm:max-w-[calc(100%-40px)] sm:rotate-[0.6deg] sm:px-3 sm:py-2 sm:text-sm"
        style={{ background: theme.panelBg, border: `1px solid ${theme.panelBorder}`, color: theme.text }}
      >
        <span className="font-semibold" style={{ color: theme.red }}>拖动重排 ·</span> 点人物看档案，悬停红线看方向与证据。
      </div>
    </div>
  );
}
