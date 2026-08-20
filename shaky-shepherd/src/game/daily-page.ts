/**
 * Daily Challenge page UI logic (Session 8).
 *
 * Handles rendering today's challenge with modifier, progress, and stats,
 * plus the full history list.
 */
import {
  generateDailyChallenge,
  getDailyParamsForDate,
  getDailyModifierForDate,
  formatDailyDate,
  dailyDateKey,
} from './daily.ts';
import {
  readStoredDailyStatus,
  readStoredDailyHistory,
  computeDailyStreak,
  DAILY_KEYS,
} from './storage.ts';
import { readStoredNumber } from './storage.ts';

function mountDailyPage() {
  const today = dailyDateKey();
  const challenge = generateDailyChallenge(today);
  const params = getDailyParamsForDate(today);
  const modifier = getDailyModifierForDate(today);

  // Populate today's challenge
  populateTodayChallenge(challenge, params, modifier);

  // Populate history
  populateHistory();
}

function populateTodayChallenge(
  challenge: ReturnType<typeof generateDailyChallenge>,
  params: ReturnType<typeof getDailyParamsForDate>,
  modifier: ReturnType<typeof getDailyModifierForDate>,
) {
  const dateEl = document.getElementById('daily-today-date');
  const modifierEl = document.getElementById('daily-today-modifier');
  const progressFill = document.getElementById('daily-today-progress-fill');
  const progressText = document.getElementById('daily-today-progress-text');
  const bestEl = document.getElementById('daily-today-best');
  const yourBestEl = document.getElementById('daily-today-your-best');
  const streakEl = document.getElementById('daily-today-streak');
  const descEl = document.getElementById('daily-today-desc');

  // Date
  if (dateEl) dateEl.textContent = formatDailyDate(challenge.dateKey);

  // Modifier
  if (modifierEl) {
    modifierEl.textContent = `${modifier.label} — ${modifier.description}`;
    modifierEl.className = `daily-today-modifier modifier-${modifier.id}`;
  }

  // Progress (from today's run if in progress)
  const status = readStoredDailyStatus();
  const progress = status && status.dateKey === challenge.dateKey
    ? Math.min(params.foodCount, Math.max(0, (status.level - 1) * 4 + Math.floor(status.score / 10)))
    : 0;
  const foodCount = params.foodCount;
  const pct = foodCount > 0 ? Math.min(100, Math.round((progress / foodCount) * 100)) : 0;

  if (progressFill) progressFill.style.width = `${pct}%`;
  if (progressText) progressText.textContent = `${progress} / ${foodCount}`;

  // Best score (all-time)
  const highScore = readStoredNumber(DAILY_KEYS.best, 0);
  if (bestEl) bestEl.textContent = String(highScore).padStart(3, '0');

  // Your best today
  if (yourBestEl) {
    if (status && status.dateKey === challenge.dateKey) {
      yourBestEl.textContent = String(status.score).padStart(3, '0');
    } else {
      yourBestEl.textContent = '—';
    }
  }

  // Streak
  const history = readStoredDailyHistory();
  const streak = computeDailyStreak(history, challenge.dateKey);
  if (streakEl) streakEl.textContent = streak > 0 ? `${streak} ${streak === 1 ? 'DAY' : 'DAYS'}` : '0 DAYS';

  // Description
  if (descEl) {
    descEl.textContent = getModifierDescription(modifier.id);
  }
}

function getModifierDescription(modifierId: string): string {
  const descriptions: Record<string, string> = {
    'normal': 'Standard rules. 60 fruits. No walls. No time limit.',
    'fast-snake': 'Snake moves 30% faster. The fruit positions are the same, but you have less time to react. Plan your turns early.',
    'wraparound': 'Walls wrap around — leave one edge, appear on the opposite side. Only your tail can trap you. The fruit positions are unchanged.',
    'double-score': 'Every fruit awards 20 points instead of 10. The challenge is identical to Normal, but scores are doubled. Leaderboard scores reflect the modifier.',
    'fruit-storm': '90 fruits instead of 60. A longer run with more opportunities — and more chances to make a mistake. The board is the same, just more of it.',
  };
  return descriptions[modifierId] ?? descriptions.normal;
}

function populateHistory() {
  const listEl = document.getElementById('daily-history-list');
  if (!listEl) return;

  const history = readStoredDailyHistory();
  const dates = Object.keys(history).sort((a, b) => b.localeCompare(a)); // newest first

  if (dates.length === 0) {
    listEl.innerHTML = '<p class="daily-history-empty">No Daily Challenges completed yet. Play today to start your history!</p>';
    return;
  }

  listEl.innerHTML = '';

  for (const dateKey of dates) {
    const entry = history[dateKey];
    const challenge = generateDailyChallenge(dateKey);
    const modifier = challenge.modifier ?? { id: 'normal', label: 'NORMAL' };
    const isCompleted = entry.completed;

    const item = document.createElement('div');
    item.className = `daily-history-item${isCompleted ? ' completed' : ''}`;

    const modifierClass = `daily-history-modifier ${modifier.id}`;
    const scoreClass = entry.score === readStoredNumber(DAILY_KEYS.best, 0) ? 'best' : '';

    item.innerHTML = `
      <span class="daily-history-date">${formatDailyDate(dateKey)}</span>
      <span class="${modifierClass}">${modifier.label}</span>
      <span class="daily-history-score ${scoreClass}">${String(entry.score).padStart(3, '0')}</span>
      <span class="daily-history-score">BEST ${String(readStoredNumber(DAILY_KEYS.best, 0)).padStart(3, '0')}</span>
      ${isCompleted ? '<span class="daily-history-completed" aria-label="Completed">✓</span>' : ''}
    `;

    listEl.appendChild(item);
  }
}

// Auto-refresh when storage changes (e.g., from another tab)
window.addEventListener('storage', () => {
  mountDailyPage();
});

// Dev hook
if (import.meta.env.DEV) {
  (window as unknown as { __serpentDailyPage?: object }).__serpentDailyPage = {
    refresh: mountDailyPage,
  };
}

export { mountDailyPage };