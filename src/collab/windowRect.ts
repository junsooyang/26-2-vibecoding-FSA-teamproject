/**
 * 화면 위에 떠 있는 작은 창(채팅창)의 위치·크기 계산.
 * 화면 밖으로 사라지지 않게 맞추고, 브라우저에 저장된 값을 안전하게 읽는다.
 */

export interface WindowRect {
  x: number
  y: number
  width: number
  height: number
}

export interface Viewport {
  width: number
  height: number
}

/** 창 최소 크기 */
export const WINDOW_MIN = { width: 260, height: 260 }
/** 창 머리(끌기 손잡이)가 화면 안에 최소 이만큼은 남아 있어야 다시 잡을 수 있다 */
const KEEP_VISIBLE = 80

/** 창이 화면 밖으로 나가지 않게 위치·크기를 맞춘다 (머리는 항상 화면 안) */
export function clampRect(rect: WindowRect, vp: Viewport, minTop = 0): WindowRect {
  const width = Math.round(Math.min(Math.max(rect.width, WINDOW_MIN.width), Math.max(WINDOW_MIN.width, vp.width - 16)))
  const height = Math.round(
    Math.min(Math.max(rect.height, WINDOW_MIN.height), Math.max(WINDOW_MIN.height, vp.height - minTop - 8)),
  )
  // 가로: 창이 화면 밖으로 반쯤 나가는 것까지는 허용하되 KEEP_VISIBLE 만큼은 보이게
  const x = Math.round(Math.min(Math.max(rect.x, KEEP_VISIBLE - width), vp.width - KEEP_VISIBLE))
  // 세로: 머리가 툴바 아래 ~ 화면 아래 사이에 오게
  const y = Math.round(Math.min(Math.max(rect.y, minTop), Math.max(minTop, vp.height - 48)))
  return { x, y, width, height }
}

/**
 * 채팅창 처음 위치: 오른쪽 위.
 * 화면이 넓으면 오른쪽 패널(340px) 자리를 비워 그 왼쪽에 둔다 → 캘린더·대시보드와 나란히 볼 수 있다.
 */
export function defaultChatRect(vp: Viewport, top: number): WindowRect {
  const width = 340
  const height = Math.min(480, Math.max(WINDOW_MIN.height, vp.height - top - 24))
  const sidePanel = vp.width >= 1100 ? 356 : 0
  return clampRect({ x: vp.width - width - 16 - sidePanel, y: top, width, height }, vp, top)
}

/** 저장해 둔 값이 올바른 모양일 때만 쓴다 (깨진 값·옛 형식은 무시) */
export function parseSavedRect(raw: string | null): WindowRect | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<WindowRect>
    const ok = ['x', 'y', 'width', 'height'].every(
      (k) => typeof v[k as keyof WindowRect] === 'number' && Number.isFinite(v[k as keyof WindowRect]),
    )
    return ok ? (v as WindowRect) : null
  } catch {
    return null
  }
}
