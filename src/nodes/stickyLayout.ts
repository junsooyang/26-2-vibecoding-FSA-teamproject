/**
 * 스티커 메모 크기에 맞춘 글자 비율 계산.
 *
 * 모서리를 끌어 메모를 줄이면 글자·버튼이 그대로라 잘려 보였다.
 * 그래서 메모 크기에 비례해 글자 크기(배율)를 정하고, 버튼·제목도 같은 배율(em)로 따라가게 한다.
 */

/** 기본 메모 크기 (CSS .sticky-node 기본 너비 200px, 기본 높이 기준 150px) */
export const STICKY_BASE = { width: 200, height: 150 }
/** 줄였을 때 최소 배율 / 키웠을 때 최대 배율 */
export const STICKY_SCALE_MIN = 0.75
export const STICKY_SCALE_MAX = 1.6
/** 이보다 작게는 줄일 수 없다 (최소 배율에서도 버튼 한 줄과 글 한 줄이 들어가는 크기) */
export const STICKY_MIN_SIZE = { width: 150, height: 110 }

/**
 * 메모 크기 → 글자 배율.
 * - 너비 기준으로 비례하고, 높이를 정했다면 높이가 더 좁을 때 그쪽에 맞춘다.
 * - 크기를 정하지 않은 메모(기본 크기)는 1.
 */
export function stickyFontScale(width?: number, height?: number): number {
  const ratios: number[] = []
  if (width && width > 0) ratios.push(width / STICKY_BASE.width)
  if (height && height > 0) ratios.push(height / STICKY_BASE.height)
  if (ratios.length === 0) return 1
  const raw = Math.min(...ratios)
  const clamped = Math.min(STICKY_SCALE_MAX, Math.max(STICKY_SCALE_MIN, raw))
  // 끄는 동안 글자가 미세하게 떨리지 않게 0.05 단위로 맞춘다
  return Math.round(clamped * 20) / 20
}
