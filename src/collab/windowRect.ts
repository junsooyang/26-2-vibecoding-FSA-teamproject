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
/** 화면이 아주 작을 때(크게 확대) 허용하는 최소 크기 */
const SMALL_MIN = { width: 200, height: 160 }
/** 창 머리(끌기 손잡이)가 화면 안에 최소 이만큼은 남아 있어야 다시 잡을 수 있다 */
const KEEP_VISIBLE = 80

/** 창이 화면 밖으로 나가지 않게 위치·크기를 맞춘다 (머리는 항상 화면 안) */
export function clampRect(rect: WindowRect, vp: Viewport, minTop = 0): WindowRect {
  // 쓸 수 있는 최대 크기 (화면 확대·작은 창에서는 기본 최소 크기보다 작을 수 있다)
  const maxW = Math.max(SMALL_MIN.width, vp.width - 16)
  const maxH = Math.max(SMALL_MIN.height, vp.height - minTop - 8)
  // 최소 크기도 화면에 들어가게 줄인다 → 확대해도 창 아래쪽(입력칸)이 화면 밖으로 잘리지 않는다
  const minW = Math.min(WINDOW_MIN.width, maxW)
  const minH = Math.min(WINDOW_MIN.height, maxH)
  const width = Math.round(Math.min(Math.max(rect.width, minW), maxW))
  const height = Math.round(Math.min(Math.max(rect.height, minH), maxH))
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
  const height = Math.min(480, vp.height - top - 24)
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
