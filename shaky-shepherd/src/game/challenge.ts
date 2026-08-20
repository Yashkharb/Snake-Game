/**
 * Friend Challenge System (Session 11).
 *
 * Pure, data-driven challenge system. Challenges are encoded in URL hash fragments
 * so they work on static GitHub Pages without any backend.
 *
 * Format: #challenge=base64url(data)
 * Data: JSON { v: 1, mode, targetScore, challenger?, timestamp }
 *
 * All validation is done client-side. No backend required.
 */
import type { GameModeId } from './modes.ts';

export const CHALLENGE_VERSION = 1;
export const CHALLENGE_HASH_PREFIX = '#challenge=';

/** The decoded challenge data structure. */
export interface ChallengeData {
  /** Schema version. */
  v: number;
  /** Game mode the challenge applies to. */
  mode: GameModeId;
  /** Target score to beat. */
  targetScore: number;
  /** Optional challenger name (for display). */
  challenger?: string;
  /** Unix timestamp when challenge was created. */
  timestamp: number;
}

/** Result of decoding a challenge. */
export interface ChallengeDecodeResult {
  /** The decoded challenge data, or null if invalid. */
  data: ChallengeData | null;
  /** Human-readable error message if invalid. */
  error?: string;
}

/** Valid game modes for challenges. */
const VALID_MODES: GameModeId[] = ['classic', 'time-attack', 'zen', 'daily'];

/** Maximum reasonable score for validation (prevents absurd challenges). */
const MAX_CHALLENGE_SCORE = 10000;

/** Base64URL encoding (URL-safe, no padding). */
function base64UrlEncode(data: string): string {
  return btoa(data)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Base64URL decoding. */
function base64UrlDecode(data: string): string {
  // Add padding back if needed
  const padded = data + '='.repeat((4 - (data.length % 4)) % 4);
  return atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
}

/**
 * Encode a challenge into a URL-safe string for the URL hash.
 * Returns the full hash fragment including the prefix (e.g., "#challenge=abc123").
 */
export function encodeChallenge(data: ChallengeData): string {
  const json = JSON.stringify(data);
  const encoded = base64UrlEncode(json);
  return `${CHALLENGE_HASH_PREFIX}${encoded}`;
}

/**
 * Decode a challenge from a URL hash fragment.
 * Returns null for data if invalid, with error message.
 */
export function decodeChallenge(hashFragment: string): ChallengeDecodeResult {
  // Handle both full URL and just the hash
  let hash = hashFragment;
  if (hash.startsWith('#')) {
    // Already a hash fragment
  } else if (hash.includes('#')) {
    // Full URL - extract hash
    hash = hash.substring(hash.indexOf('#'));
  } else {
    return { data: null, error: 'No challenge hash found' };
  }

  if (!hash.startsWith(CHALLENGE_HASH_PREFIX)) {
    return { data: null, error: 'Not a challenge link' };
  }

  const encoded = hash.substring(CHALLENGE_HASH_PREFIX.length);
  if (!encoded) {
    return { data: null, error: 'Empty challenge data' };
  }

  let json: string;
  try {
    json = base64UrlDecode(encoded);
  } catch {
    return { data: null, error: 'Invalid challenge encoding' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { data: null, error: 'Invalid challenge JSON' };
  }

  // Validate the parsed data
  const validation = validateChallengeData(parsed);
  if (!validation.valid) {
    return { data: null, error: validation.error };
  }

  return { data: validation.data! };
}

/** Validate challenge data structure and values. */
function validateChallengeData(
  parsed: unknown
): { valid: boolean; data?: ChallengeData; error?: string } {
  if (typeof parsed !== 'object' || parsed === null) {
    return { valid: false, error: 'Challenge data must be an object' };
  }

  const p = parsed as Record<string, unknown>;

  // Version check
  if (typeof p.v !== 'number' || p.v !== CHALLENGE_VERSION) {
    return { valid: false, error: `Unsupported challenge version (expected ${CHALLENGE_VERSION})` };
  }

  // Mode validation
  if (typeof p.mode !== 'string' || !VALID_MODES.includes(p.mode as GameModeId)) {
    return { valid: false, error: `Invalid mode: ${String(p.mode)}` };
  }

  // Target score validation
  if (typeof p.targetScore !== 'number' || !Number.isInteger(p.targetScore)) {
    return { valid: false, error: 'Target score must be an integer' };
  }
  if (p.targetScore <= 0) {
    return { valid: false, error: 'Target score must be positive' };
  }
  if (p.targetScore > MAX_CHALLENGE_SCORE) {
    return { valid: false, error: `Target score exceeds maximum (${MAX_CHALLENGE_SCORE})` };
  }

  // Optional challenger name
  if (p.challenger !== undefined && typeof p.challenger !== 'string') {
    return { valid: false, error: 'Challenger must be a string' };
  }
  if (typeof p.challenger === 'string' && p.challenger.length > 20) {
    return { valid: false, error: 'Challenger name too long (max 20 chars)' };
  }

  // Timestamp validation
  if (typeof p.timestamp !== 'number' || !Number.isFinite(p.timestamp)) {
    return { valid: false, error: 'Invalid timestamp' };
  }
  const now = Date.now();
  // Allow some clock skew (1 hour future, 1 year past)
  if (p.timestamp > now + 3600000 || p.timestamp < now - 31536000000) {
    return { valid: false, error: 'Timestamp out of reasonable range' };
  }

  return {
    valid: true,
    data: {
      v: CHALLENGE_VERSION,
      mode: p.mode as GameModeId,
      targetScore: p.targetScore,
      challenger: typeof p.challenger === 'string' ? p.challenger : undefined,
      timestamp: p.timestamp,
    },
  };
}

/** Get a human-readable mode display name. */
function modeDisplayName(mode: GameModeId): string {
  switch (mode) {
    case 'classic':
      return 'CLASSIC';
    case 'time-attack':
      return 'TIME ATTACK';
    case 'zen':
      return 'ZEN';
    case 'daily':
      return 'DAILY';
  }
}

/** Format a timestamp for display. */
function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Generate a challenge share message with the challenge link.
 * The link includes the current page origin + the challenge hash.
 */
export function buildChallengeShareMessage(
  challenge: ChallengeData,
  origin: string = typeof window !== 'undefined' ? window.location.origin : ''
): string {
  const challengeHash = encodeChallenge(challenge);
  const link = `${origin}/${challengeHash}`;
  const modeName = modeDisplayName(challenge.mode);
  const date = formatTimestamp(challenge.timestamp);
  const challenger = challenge.challenger ? ` by ${challenge.challenger}` : '';

  return (
    `SNAKE GAME${challenger}\n\n` +
    `${modeName}\n` +
    `SCORE ${challenge.targetScore}\n\n` +
    `BEAT MY SCORE\n\n` +
    `${link}`
  );
}

/**
 * Create a challenge from a completed run.
 */
export function createChallengeFromRun(
  mode: GameModeId,
  score: number,
  challengerName?: string
): ChallengeData {
  return {
    v: CHALLENGE_VERSION,
    mode,
    targetScore: score,
    challenger: challengerName?.substring(0, 20),
    timestamp: Date.now(),
  };
}

/**
 * Parse a challenge from the current URL (if present).
 * Returns null if no valid challenge is present.
 */
export function getChallengeFromUrl(): ChallengeData | null {
  if (typeof window === 'undefined') return null;
  const result = decodeChallenge(window.location.hash);
  return result.data;
}

/** Check if the current URL has a valid challenge. */
export function hasActiveChallenge(): boolean {
  return getChallengeFromUrl() !== null;
}

/** Clear the challenge from the URL (replace state). */
export function clearChallengeFromUrl(): void {
  if (typeof window !== 'undefined' && window.history.replaceState) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

/** Get the mode display name for a challenge. */
export function getChallengeModeName(challenge: ChallengeData): string {
  return modeDisplayName(challenge.mode);
}

/** Get the challenger name for display, or "A friend". */
export function getChallengerName(challenge: ChallengeData): string {
  return challenge.challenger || 'A friend';
}