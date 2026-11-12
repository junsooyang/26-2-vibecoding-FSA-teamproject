/**
 * 새 노드 빈자리 찾기 테스트 (src/collab/placement.ts 의 실제 코드 사용).
 */
import { describe, expect, it } from 'vitest'
import { findFreePosition, findFreePositions, type Box } from '../../src/collab/placement'

const size = { width: 200, height: 100 }
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

describe('빈자리 찾기', () => {
  it('비어 있으면 원하는 자리 그대로 (20px 그리드에 맞춤)', () => {
    expect(findFreePosition({ x: 103, y: 47 }, size, [])).toEqual({ x: 100, y: 40 })
  })

  it('원하는 자리에 노드가 있으면 겹치지 않는 자리로 옮긴다 (간격 20px 포함)', () => {
    const existing: Box[] = [{ x: 0, y: 0, width: 200, height: 100 }]
    const p = findFreePosition({ x: 0, y: 0 }, size, existing)
    const placed = { ...p, ...size }
    expect(overlaps(placed, existing[0])).toBe(false)
    // 간격까지 지키는지: 20px 넓힌 상자와도 안 겹쳐야 함
    expect(overlaps(placed, { x: -20, y: -20, width: 240, height: 140 })).toBe(false)
  })

  it('가장 가까운 빈자리를 고른다 (멀리 가지 않음)', () => {
    const existing: Box[] = [{ x: 0, y: 0, width: 200, height: 100 }]
    const p = findFreePosition({ x: 0, y: 0 }, size, existing)
    // 위/아래로 비키는 게 가장 가깝다 (세로 이동 120px < 가로 이동 220px)
    expect(Math.abs(p.x) + Math.abs(p.y)).toBeLessThanOrEqual(120)
  })

  it('여러 개를 연달아 만들어도 서로 겹치지 않는다', () => {
    const boxes: Box[] = []
    for (let i = 0; i < 12; i++) {
      const p = findFreePosition({ x: 0, y: 0 }, size, boxes)
      const placed = { ...p, ...size }
      for (const b of boxes) expect(overlaps(placed, b)).toBe(false)
      boxes.push(placed)
    }
  })

  it('찾을 범위 안에 빈자리가 없으면 원하는 자리 그대로 (만들기는 된다)', () => {
    const wall: Box[] = [{ x: -10000, y: -10000, width: 20000, height: 20000 }]
    expect(findFreePosition({ x: 0, y: 0 }, size, wall, { maxRings: 5 })).toEqual({ x: 0, y: 0 })
  })

  it('findFreePositions 는 여러 개의 세부 작업을 한 번에 배치할 때도 서로 겹치지 않는다', () => {
    const existing: Box[] = [{ x: 0, y: 0, width: 200, height: 100 }]
    const desired = Array.from({ length: 5 }, () => ({ x: 0, y: 0 }))
    const positions = findFreePositions(desired, size, existing)
    expect(positions).toHaveLength(5)
    const all: Box[] = [...existing]
    for (const p of positions) {
      const box = { ...p, ...size }
      for (const prev of all) expect(overlaps(box, prev)).toBe(false)
      all.push(box)
    }
  })
})
