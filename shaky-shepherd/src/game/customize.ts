/**
 * Customize page UI logic (Session 7).
 *
 * Handles rendering the cosmetic grid, preview rendering, and equip actions.
 * Pure UI logic — no simulation or persistence here.
 */
import {
  getCosmeticsByCategory,
  type CosmeticCategory,
  type CosmeticDefinition,
  type EquippedCosmetics,
} from './cosmetics.ts';
import { loadProfile, saveProfile, equipCosmetic } from './progression.ts';

const CATEGORY_ORDER: CosmeticCategory[] = ['snake', 'food', 'trail', 'board'];

let profile = loadProfile();
let equipped: EquippedCosmetics = profile.equippedCosmetics;

function renderPreview(canvas: HTMLCanvasElement, cosmetic: CosmeticDefinition, isLocked: boolean) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const time = performance.now();

  if (cosmetic.category === 'snake') {
    drawSnakePreview(ctx, cosmetic, width, height, time, reducedMotion, isLocked);
  } else if (cosmetic.category === 'food') {
    drawFoodPreview(ctx, cosmetic, width, height, time, reducedMotion, isLocked);
  } else if (cosmetic.category === 'trail') {
    drawTrailPreview(ctx, cosmetic, width, height, time, reducedMotion, isLocked);
  } else if (cosmetic.category === 'board') {
    drawBoardPreview(ctx, cosmetic, width, height, time, reducedMotion, isLocked);
  }
}

function drawSnakePreview(
  ctx: CanvasRenderingContext2D,
  cosmetic: CosmeticDefinition,
  w: number,
  h: number,
  time: number,
  reducedMotion: boolean,
  isLocked: boolean,
) {
  const centerX = w / 2;
  const centerY = h / 2;
  const segmentCount = 8;
  const segmentLength = Math.min(w, h) * 0.08;

  const props = getSnakeRenderPropsForPreview(cosmetic);

  // Draw a curved snake preview
  for (let i = segmentCount - 1; i >= 0; i--) {
    const t = i / (segmentCount - 1);
    const angle = (time * 0.001 + t * 2) * (reducedMotion ? 0 : 1);
    const x = centerX + Math.sin(angle) * (w * 0.25);
    const y = centerY + Math.cos(angle * 0.7) * (h * 0.2) - i * segmentLength * 0.5;
    const r = Math.max(3, segmentLength * (0.8 - t * 0.3));

    ctx.fillStyle = isLocked ? 'rgba(255,255,255,0.3)' : getSegmentColor(props, t, i === 0);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    if (i === 0 && !isLocked) {
      // Eyes
      ctx.fillStyle = props.pattern === 'gold' ? '#fff8dc' : '#fff5ea';
      const eyeOffset = r * 0.3;
      ctx.beginPath();
      ctx.arc(x - eyeOffset, y - eyeOffset, r * 0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + eyeOffset, y - eyeOffset, r * 0.25, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawFoodPreview(
  ctx: CanvasRenderingContext2D,
  cosmetic: CosmeticDefinition,
  w: number,
  h: number,
  time: number,
  reducedMotion: boolean,
  isLocked: boolean,
) {
  const centerX = w / 2;
  const centerY = h / 2;
  const radius = Math.min(w, h) * 0.3;

  const props = getFoodRenderPropsForPreview(cosmetic);

  if (isLocked) {
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  // Aura
  const pulse = reducedMotion ? 1 : 1 + Math.sin(time * 0.005) * 0.15;
  const auraRadius = radius * 1.5 * pulse;
  const aura = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, auraRadius);
  aura.addColorStop(0, `rgba(${hexToRgb(props.aura).join(',')}, 0.4)`);
  aura.addColorStop(0.5, `rgba(${hexToRgb(props.aura).join(',')}, 0.15)`);
  aura.addColorStop(1, `rgba(${hexToRgb(props.aura).join(',')}, 0)`);
  ctx.fillStyle = aura;
  ctx.fillRect(centerX - auraRadius, centerY - auraRadius, auraRadius * 2, auraRadius * 2);

  // Petals
  if (!reducedMotion) {
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(time * 0.001);
    for (let i = 0; i < 8; i++) {
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = i % 2 === 0 ? props.petalA : props.petalB;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.ellipse(0, -radius * 0.4, radius * 0.12, radius * 0.25, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Core
  const core = ctx.createRadialGradient(centerX - 3, centerY - 4, 1, centerX, centerY, radius);
  core.addColorStop(0, props.core[0]);
  core.addColorStop(0.3, props.core[1]);
  core.addColorStop(0.7, props.core[2]);
  core.addColorStop(1, props.core[2]);
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fill();

  // Special ring
  ctx.strokeStyle = props.ring;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius * 1.3, 0, Math.PI * 2);
  ctx.stroke();
}

function drawTrailPreview(
  ctx: CanvasRenderingContext2D,
  cosmetic: CosmeticDefinition,
  w: number,
  h: number,
  time: number,
  _reducedMotion: boolean,
  isLocked: boolean,
) {
  if (cosmetic.renderKey === 'none' || isLocked) {
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.font = '12px var(--font-mono)';
    ctx.textAlign = 'center';
    ctx.fillText(cosmetic.renderKey === 'none' ? 'NONE' : 'LOCKED', w / 2, h / 2 + 4);
    return;
  }

  const centerX = w / 2;
  const centerY = h / 2;

  ctx.globalCompositeOperation = 'lighter';

  for (let i = 0; i < 12; i++) {
    const t = (time * 0.002 + i * 0.3) % 1;
    const x = centerX + (t - 0.5) * w * 0.8;
    const y = centerY + Math.sin(time * 0.003 + i) * h * 0.15;
    const r = Math.max(2, 6 * (1 - t));
    const alpha = 0.3 * (1 - t);

    const color = cosmetic.preview?.color ?? '#ff7a17';
    const style = cosmetic.renderKey;

    switch (style) {
      case 'glow': {
        const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
        glow.addColorStop(0, hexToRgba(color, alpha));
        glow.addColorStop(1, hexToRgba(color, 0));
        ctx.fillStyle = glow;
        ctx.fillRect(x - r * 4, y - r * 4, r * 8, r * 8);
        break;
      }
      case 'particles': {
        ctx.fillStyle = hexToRgba(color, alpha);
        ctx.beginPath();
        ctx.arc(x + (Math.random() - 0.5) * 8, y + (Math.random() - 0.5) * 8, Math.max(1, r * 0.4), 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'fire': {
        const fire = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
        fire.addColorStop(0, 'rgba(255, 69, 0, ' + alpha + ')');
        fire.addColorStop(0.5, 'rgba(255, 140, 0, ' + alpha * 0.5 + ')');
        fire.addColorStop(1, 'rgba(255, 215, 0, 0)');
        ctx.fillStyle = fire;
        ctx.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
        break;
      }
      case 'lightning': {
        ctx.strokeStyle = hexToRgba(color, alpha * 2);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (Math.random() - 0.5) * 15, y + (Math.random() - 0.5) * 15);
        ctx.stroke();
        break;
      }
      case 'rainbow': {
        const hue = (time * 0.2 + i * 40) % 360;
        ctx.fillStyle = `hsla(${hue}, 100%, 60%, ${alpha})`;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1, r * 0.5), 0, Math.PI * 2);
        ctx.fill();
        break;
      }
    }
  }

  ctx.globalCompositeOperation = 'source-over';

  // Draw a small snake head at the front
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(centerX + w * 0.35, centerY, 6, 0, Math.PI * 2);
  ctx.fill();
}

function drawBoardPreview(
  ctx: CanvasRenderingContext2D,
  cosmetic: CosmeticDefinition,
  w: number,
  h: number,
  _time: number,
  _reducedMotion: boolean,
  isLocked: boolean,
) {
  const props = getBoardRenderPropsForPreview(cosmetic);

  if (isLocked) {
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;
    ctx.strokeRect(2, 2, w - 4, h - 4);
    return;
  }

  // Backdrop
  const backdrop = ctx.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.47, Math.max(w, h) * 0.75);
  backdrop.addColorStop(0, props.backdrop[0]);
  backdrop.addColorStop(0.56, props.backdrop[1]);
  backdrop.addColorStop(1, props.backdrop[2]);
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, w, h);

  // Warm glow
  const warm = ctx.createRadialGradient(-20, -20, 0, -20, -20, Math.max(w, h) * 0.55);
  warm.addColorStop(0, props.warm[0]);
  warm.addColorStop(1, props.warm[1]);
  ctx.fillStyle = warm;
  ctx.fillRect(0, 0, w, h);

  // Cool glow
  const cool = ctx.createRadialGradient(w + 20, h + 20, 0, w + 20, h + 20, Math.max(w, h) * 0.6);
  cool.addColorStop(0, props.cool[0]);
  cool.addColorStop(1, props.cool[1]);
  ctx.fillStyle = cool;
  ctx.fillRect(0, 0, w, h);

  // Stars
  if (props.stars) {
    for (let i = 0; i < 15; i++) {
      const x = (i * 73) % w;
      const y = (i * 137) % h;
      ctx.fillStyle = props.starColor;
      ctx.beginPath();
      ctx.arc(x, y, 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Grid
  ctx.lineWidth = 0.8;
  const cells = 8;
  const cellW = w / cells;
  const cellH = h / cells;
  for (let i = 0; i <= cells; i++) {
    const posX = i * cellW;
    const posY = i * cellH;
    ctx.strokeStyle = i % 2 === 0 ? props.gridHeavyColor : props.gridColor;
    ctx.beginPath();
    ctx.moveTo(posX, 0);
    ctx.lineTo(posX, h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, posY);
    ctx.lineTo(w, posY);
    ctx.stroke();
  }

  // Border
  ctx.strokeStyle = props.borderColor;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(1, 1, w - 2, h - 2);
}

function getSnakeRenderPropsForPreview(cosmetic: CosmeticDefinition) {
  switch (cosmetic.renderKey) {
    case 'neon':
      return { primary: '#00ffff', secondary: '#ff00ff', glow: 'rgba(0, 255, 255, 0.4)', pattern: 'gradient' };
    case 'cyber':
      return { primary: '#00ff88', secondary: '#ff0066', glow: 'rgba(0, 255, 136, 0.4)', pattern: 'circuit' };
    case 'inferno':
      return { primary: '#ff4500', secondary: '#ffd700', glow: 'rgba(255, 69, 0, 0.4)', pattern: 'gradient' };
    case 'ice':
      return { primary: '#7dd3fc', secondary: '#e0f2fe', glow: 'rgba(125, 211, 252, 0.4)', pattern: 'crystalline' };
    case 'void':
      return { primary: '#1a1a2e', secondary: '#c4b5fd', glow: 'rgba(196, 181, 253, 0.3)', pattern: 'nebula' };
    case 'gold':
      return { primary: '#ffd700', secondary: '#fff8dc', glow: 'rgba(255, 215, 0, 0.35)', pattern: 'gold' };
    case 'galaxy':
      return { primary: '#8b5cf6', secondary: '#ec4899', glow: 'rgba(139, 92, 246, 0.4)', pattern: 'nebula' };
    default:
      return { primary: '#ffffff', secondary: '#ff7a17', glow: 'rgba(255, 122, 23, 0.35)', pattern: 'solid' };
  }
}

function getFoodRenderPropsForPreview(cosmetic: CosmeticDefinition) {
  switch (cosmetic.renderKey) {
    case 'crystal':
      return { aura: '#a5f3fc', petalA: '#67e8f9', petalB: '#a5f3fc', core: ['#f0f9ff', '#a5f3fc', '#06b6d4'], ring: 'rgba(165, 243, 252, 0.9)' };
    case 'orb':
      return { aura: '#c4b5fd', petalA: '#a78bfa', petalB: '#ddd6fe', core: ['#f5f3ff', '#c4b5fd', '#7c3aed'], ring: 'rgba(196, 181, 253, 0.9)' };
    case 'star':
      return { aura: '#fde047', petalA: '#fde047', petalB: '#fef08a', core: ['#fefce8', '#fde047', '#ca8a04'], ring: 'rgba(253, 224, 71, 0.9)' };
    case 'energy-core':
      return { aura: '#fb923c', petalA: '#fb923c', petalB: '#fed7aa', core: ['#fff7ed', '#fb923c', '#c2410c'], ring: 'rgba(251, 146, 60, 0.9)' };
    default:
      return { aura: '#ffc285', petalA: '#ff7a17', petalB: '#ffc285', core: ['#fff7ed', '#ffd9a8', '#ff5f1f'], ring: 'rgba(255, 255, 255, 0.85)' };
  }
}

function getBoardRenderPropsForPreview(cosmetic: CosmeticDefinition) {
  switch (cosmetic.renderKey) {
    case 'arcade':
      return {
        backdrop: ['#0d1a0d', '#0a150a', '#050f05'],
        warm: ['rgba(57, 255, 20, 0.08)', 'rgba(57, 255, 20, 0)'],
        cool: ['rgba(57, 255, 20, 0.04)', 'rgba(57, 255, 20, 0)'],
        gridColor: 'rgba(57, 255, 20, 0.06)',
        gridHeavyColor: 'rgba(57, 255, 20, 0.15)',
        borderColor: 'rgba(57, 255, 20, 0.5)',
        stars: false,
        starColor: 'rgba(57, 255, 20, 0.3)',
        animated: true,
      };
    case 'matrix':
      return {
        backdrop: ['#000000', '#000000', '#000000'],
        warm: ['rgba(0, 255, 65, 0.08)', 'rgba(0, 255, 65, 0)'],
        cool: ['rgba(0, 255, 65, 0.04)', 'rgba(0, 255, 65, 0)'],
        gridColor: 'rgba(0, 255, 65, 0.06)',
        gridHeavyColor: 'rgba(0, 255, 65, 0.12)',
        borderColor: 'rgba(0, 255, 65, 0.4)',
        stars: false,
        starColor: 'rgba(0, 255, 65, 0.3)',
        animated: true,
      };
    case 'sunset':
      return {
        backdrop: ['#2d1005', '#1a0a0a', '#0a0505'],
        warm: ['rgba(255, 122, 23, 0.12)', 'rgba(255, 122, 23, 0)'],
        cool: ['rgba(196, 181, 253, 0.06)', 'rgba(196, 181, 253, 0)'],
        gridColor: 'rgba(255, 122, 23, 0.04)',
        gridHeavyColor: 'rgba(255, 122, 23, 0.08)',
        borderColor: 'rgba(255, 122, 23, 0.35)',
        stars: true,
        starColor: 'rgba(255, 122, 23, 0.2)',
        animated: true,
      };
    case 'void':
      return {
        backdrop: ['#000000', '#000000', '#000000'],
        warm: ['rgba(255, 255, 255, 0.02)', 'rgba(255, 255, 255, 0)'],
        cool: ['rgba(255, 255, 255, 0.01)', 'rgba(255, 255, 255, 0)'],
        gridColor: 'rgba(255, 255, 255, 0.015)',
        gridHeavyColor: 'rgba(255, 255, 255, 0.03)',
        borderColor: 'rgba(255, 255, 255, 0.15)',
        stars: true,
        starColor: 'rgba(255, 255, 255, 0.6)',
        animated: true,
      };
    case 'grid':
      return {
        backdrop: ['#0f0f0f', '#0a0a0a', '#050505'],
        warm: ['rgba(255, 255, 255, 0.02)', 'rgba(255, 255, 255, 0)'],
        cool: ['rgba(255, 255, 255, 0.01)', 'rgba(255, 255, 255, 0)'],
        gridColor: 'rgba(255, 255, 255, 0.08)',
        gridHeavyColor: 'rgba(255, 255, 255, 0.15)',
        borderColor: 'rgba(255, 255, 255, 0.3)',
        stars: false,
        starColor: 'rgba(255, 255, 255, 0.2)',
        animated: false,
      };
    default:
      return {
        backdrop: ['#171717', '#0e0e0e', '#0a0a0a'],
        warm: ['rgba(255, 122, 23, 0.05)', 'rgba(255, 122, 23, 0)'],
        cool: ['rgba(124, 58, 237, 0.05)', 'rgba(124, 58, 237, 0)'],
        gridColor: 'rgba(255, 255, 255, 0.04)',
        gridHeavyColor: 'rgba(255, 255, 255, 0.09)',
        borderColor: 'rgba(255, 255, 255, 0.28)',
        stars: true,
        starColor: 'rgba(255, 255, 255, 0.45)',
        animated: false,
      };
  }
}

function getSegmentColor(props: ReturnType<typeof getSnakeRenderPropsForPreview>, t: number, isHead: boolean): string {
  if (isHead) return props.primary;
  switch (props.pattern) {
    case 'circuit':
      return t < 0.5 ? props.primary : props.secondary;
    case 'crystalline':
      return `hsl(${200 - t * 40} 80% ${60 - t * 20}%)`;
    case 'nebula':
      return `hsl(${270 + t * 60} 70% ${60 - t * 20}%)`;
    case 'gold':
      return props.primary;
    case 'gradient':
    default:
      return `hsl(${24 + t * 238} 85% ${55 - t * 20}%)`;
  }
}

function hexToRgb(hex: string): number[] {
  const clean = hex.replace('#', '');
  if (clean.length === 3) {
    return [
      parseInt(clean[0] + clean[0], 16),
      parseInt(clean[1] + clean[1], 16),
      parseInt(clean[2] + clean[2], 16),
    ];
  }
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function hexToRgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  return `rgba(${rgb.join(',')}, ${alpha})`;
}

function renderCategory(category: CosmeticCategory) {
  const grid = document.getElementById(`${category}-grid`);
  if (!grid) return;

  const cosmetics = getCosmeticsByCategory(category);
  grid.innerHTML = '';

  for (const cosmetic of cosmetics) {
    const isUnlocked = profile.unlockedCosmetics.includes(cosmetic.id);
    const isEquipped = equipped[category] === cosmetic.id;

    const card = document.createElement('div');
    card.className = `cosmetic-card${!isUnlocked ? ' locked' : ''}${isEquipped ? ' equipped' : ''}`;
    card.dataset.cosmeticId = cosmetic.id;

    const previewCanvas = document.createElement('canvas');
    previewCanvas.className = 'cosmetic-preview';
    previewCanvas.width = 80;
    previewCanvas.height = 80;
    previewCanvas.setAttribute('aria-hidden', 'true');

    const nameEl = document.createElement('div');
    nameEl.className = 'cosmetic-name';
    nameEl.textContent = cosmetic.name;

    const descEl = document.createElement('div');
    descEl.className = 'cosmetic-desc';
    descEl.textContent = cosmetic.description;

    const statusEl = document.createElement('div');
    statusEl.className = `cosmetic-status${isEquipped ? ' equipped' : isUnlocked ? ' unlocked' : ' locked'}`;
    statusEl.textContent = isEquipped ? 'EQUIPPED' : isUnlocked ? 'UNLOCKED' : 'LOCKED';

    const button = document.createElement('button');
    button.className = `equip-button${isEquipped ? ' equipped' : ''}`;
    button.textContent = isEquipped ? 'EQUIPPED' : isUnlocked ? 'EQUIP' : 'LOCKED';
    button.disabled = !isUnlocked || isEquipped;
    button.addEventListener('click', () => equipCosmeticHandler(cosmetic.id, category));

    card.append(previewCanvas, nameEl, descEl, statusEl, button);
    grid.appendChild(card);

    // Render preview
    renderPreview(previewCanvas, cosmetic, !isUnlocked);
  }
}

function equipCosmeticHandler(cosmeticId: string, _category: CosmeticCategory) {
  const result = equipCosmetic(profile, cosmeticId);
  profile = result.profile;
  equipped = result.equipped;
  saveProfile(profile);
  renderAllCategories();
}

function renderAllCategories() {
  for (const category of CATEGORY_ORDER) {
    renderCategory(category);
  }
}

export function mountCustomize() {
  // Refresh profile in case it was updated elsewhere
  profile = loadProfile();
  equipped = profile.equippedCosmetics;
  renderAllCategories();

  // Listen for storage changes from other tabs
  window.addEventListener('storage', () => {
    profile = loadProfile();
    equipped = profile.equippedCosmetics;
    renderAllCategories();
  });
}

// Dev hook
if (import.meta.env.DEV) {
  (window as unknown as { __serpentCustomize?: object }).__serpentCustomize = {
    getProfile: () => profile,
    getEquipped: () => equipped,
    forceUnlock: (id: string) => {
      if (!profile.unlockedCosmetics.includes(id)) {
        profile = { ...profile, unlockedCosmetics: [...profile.unlockedCosmetics, id] };
        saveProfile(profile);
        renderAllCategories();
      }
    },
  };
}