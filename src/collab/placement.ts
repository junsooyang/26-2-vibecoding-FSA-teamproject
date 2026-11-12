/**
 * 새 노드를 놓을 빈자리 찾기.
 *
 * 원하는 위치(보통 화면 가운데)에 다른 노드가 있으면, 그 주변을 가까운 순서로 둘러보며
 * 다른 노드와 겹치지 않는(사이 간격 포함) 가장 가까운 자리를 고른다.
 * 위치는 캔버스 그리드(20px)에 맞춘다.
 *
 * 브라우저 전용 코드를 쓰지 않아 자동 테스트에서 그대로 불러 쓸 수 있다.
 */

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface PlacementOptions {
  /** 노드 사이 최소 간격(px) */
  gap?: number
  /** 둘러볼 칸 간격(px) — 캔버스 그리드와 같게 */
  step?: number
  /** 최대 몇 칸까지 멀리 찾아볼지 */
  maxRings?: number
}

/** 기존 노드 크기를 모를 때 쓰는 기본값 */
export const DEFAULT_NODE_SIZE = { width: 200, height: 100 }

/** 새로 만들 노드 종류별 예상 크기 (그려지기 전이라 실제 크기를 모르므로) */
export const NEW_NODE_SIZE = {
  sticky: { width: 220, height: 140 },
  wbs: { width: 240, height: 150 },
  image: { width: 220, height: 200 },
} as const

function overlaps(a: Box, b: Box, gap: number) {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  )
}

const snap = (v: number, step: number) => Math.round(v / step) * step

/**
 * desired(왼쪽 위 좌표)에 size 크기의 노드를 놓을 때, existing 과 겹치지 않는 가장 가까운 왼쪽 위 좌표.
 * 범위 안에 빈자리가 없으면 desired 를 그대로 돌려준다(겹쳐도 만들어지게).
 */
export function findFreePosition(
  desired: { x: number; y: number },
  size: { width: number; height: number },
  existing: Box[],
  options: PlacementOptions = {},
): { x: number; y: number } {
  const gap = options.gap ?? 20
  const step = options.step ?? 20
  const maxRings = options.maxRings ?? 80
  const origin = { x: snap(desired.x, step), y: snap(desired.y, step) }
  const isFree = (x: number, y: number) =>
    !existing.some((b) => overlaps({ x, y, width: size.width, height: size.height }, b, gap))

  if (isFree(origin.x, origin.y)) return origin

  // 가운데에서 한 칸씩 바깥 고리(정사각형 테두리)를 넓혀 가며, 각 고리에서 가장 가까운 빈자리를 찾는다.
  // 고리를 다 둘러봐야 그 고리 안에서 가장 가까운 자리를 고를 수 있으므로, 한 고리 안의 후보를 모아서 비교한다.
  // (as 로 타입을 정해 둬야 TS 가 반복문 안의 대입을 놓치고 null 로만 보지 않는다)
  let best = null as { x: number; y: number; d: number } | null
  for (let r = 1; r <= maxRings; r++) {
    for (let i = -r; i <= r; i++) {
      for (const [dx, dy] of [
        [i, -r],
        [i, r],
        [-r, i],
        [r, i],
      ]) {
        const x = origin.x + dx * step
        const y = origin.y + dy * step
        if (!isFree(x, y)) continue
        const d = dx * dx + dy * dy
        if (!best || d < best.d) best = { x, y, d }
      }
    }
    // 이 고리에서 찾은 자리는, 더 바깥 고리의 어떤 자리보다도 가깝거나 같다 → 여기서 멈춘다.
    // (고리 r 의 가장 먼 점 거리² = 2r², 고리 r+1 의 가장 가까운 점 거리² = (r+1)².
    //  그래서 best.d <= (r+1)² 이면 바깥을 더 볼 필요가 없다.)
    if (best && best.d <= (r + 1) * (r + 1)) break
  }
  return best ? { x: best.x, y: best.y } : origin
}

/**
 * 여러 개의 노드를 차례대로 겹치지 않게 배치한다.
 * 앞서 배치한 노드의 자리도 occupied 목록에 즉시 반영해, 새로 생기는 노드끼리도 겹치지 않는다.
 */
export function findFreePositions(
  desiredList: Array<{ x: number; y: number }>,
  size: { width: number; height: number },
  existing: Box[],
  options: PlacementOptions = {},
): Array<{ x: number; y: number }> {
  const occupied = [...existing]
  return desiredList.map((desired) => {
    const pos = findFreePosition(desired, size, occupied, options)
    occupied.push({ x: pos.x, y: pos.y, width: size.width, height: size.height })
    return pos
  })
}
