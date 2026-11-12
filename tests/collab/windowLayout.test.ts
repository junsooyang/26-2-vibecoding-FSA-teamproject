import { describe, expect, it } from 'vitest'
import { clampRect, defaultChatRect, parseSavedRect, WINDOW_MIN } from '../../src/collab/windowRect'
import { STICKY_SCALE_MAX, STICKY_SCALE_MIN, stickyFontScale } from '../../src/nodes/stickyLayout'

const VP = { width: 1440, height: 900 }

describe('채팅 창 위치 (clampRect)', () => {
  it('화면 안의 값은 그대로', () => {
    expect(clampRect({ x: 100, y: 120, width: 340, height: 480 }, VP, 60)).toEqual({
      x: 100,
      y: 120,
      width: 340,
      height: 480,
    })
  })

  it('머리가 툴바 위·화면 아래로 사라지지 않는다', () => {
    expect(clampRect({ x: 100, y: -500, width: 340, height: 480 }, VP, 60).y).toBe(60)
    expect(clampRect({ x: 100, y: 5000, width: 340, height: 480 }, VP, 60).y).toBe(900 - 48)
  })

  it('좌우로 끌어도 최소 80px 는 화면에 남아 다시 잡을 수 있다', () => {
    const left = clampRect({ x: -5000, y: 100, width: 340, height: 480 }, VP, 60)
    expect(left.x + left.width).toBeGreaterThanOrEqual(80)
    const right = clampRect({ x: 5000, y: 100, width: 340, height: 480 }, VP, 60)
    expect(right.x).toBeLessThanOrEqual(VP.width - 80)
  })

  it('너무 작게·너무 크게 만들 수 없다', () => {
    const small = clampRect({ x: 0, y: 100, width: 10, height: 10 }, VP, 60)
    expect(small.width).toBe(WINDOW_MIN.width)
    expect(small.height).toBe(WINDOW_MIN.height)
    const big = clampRect({ x: 0, y: 100, width: 9999, height: 9999 }, VP, 60)
    expect(big.width).toBeLessThanOrEqual(VP.width)
    expect(big.height).toBeLessThanOrEqual(VP.height)
  })
})

describe('채팅 창 처음 자리 (defaultChatRect)', () => {
  it('넓은 화면에서는 오른쪽 패널(340px) 자리를 비워 둔다', () => {
    const r = defaultChatRect(VP, 100)
    expect(r.x + r.width).toBeLessThanOrEqual(VP.width - 340)
    expect(r.y).toBe(100)
  })

  it('좁은 화면에서는 오른쪽 끝에 붙고 화면 안에 있다', () => {
    const r = defaultChatRect({ width: 900, height: 700 }, 100)
    expect(r.x + r.width).toBeLessThanOrEqual(900)
    expect(r.x).toBeGreaterThanOrEqual(0)
  })
})

describe('저장된 창 위치 읽기 (parseSavedRect)', () => {
  it('올바른 값만 쓴다', () => {
    expect(parseSavedRect('{"x":1,"y":2,"width":300,"height":400}')).toEqual({ x: 1, y: 2, width: 300, height: 400 })
    for (const bad of [null, '', 'not json', '{"x":1}', '{"x":"1","y":2,"width":3,"height":4}', '{"x":null,"y":2,"width":3,"height":4}']) {
      expect(parseSavedRect(bad)).toBeNull()
    }
  })
})

describe('메모 글자 배율 (stickyFontScale)', () => {
  it('크기를 정하지 않은 메모는 1', () => {
    expect(stickyFontScale()).toBe(1)
  })

  it('기본 크기면 1, 줄이면 작아지고 키우면 커진다', () => {
    expect(stickyFontScale(200, 150)).toBe(1)
    expect(stickyFontScale(160, 120)).toBeLessThan(1)
    expect(stickyFontScale(300, 230)).toBeGreaterThan(1)
  })

  it('너비·높이 중 좁은 쪽에 맞춘다 (가로로만 길게 늘려도 글자가 넘치지 않게)', () => {
    expect(stickyFontScale(400, 150)).toBe(1)
  })

  it('최소·최대 배율을 넘지 않는다', () => {
    expect(stickyFontScale(50, 40)).toBe(STICKY_SCALE_MIN)
    expect(stickyFontScale(2000, 2000)).toBe(STICKY_SCALE_MAX)
  })
})
