import { describe, expect, it } from 'vitest'
import {
  deadlineSeenId,
  nextDeadlineSeen,
  parseDeadlineSeen,
  pickDeadlineAlerts,
} from '../../src/collab/deadlineSeen'

const TODAY = '2026-11-13'
const TOMORROW = '2026-11-14'
const task = (id: string, due: string, done = false) => ({ id, due, done })

describe('마감 알림: 확인한 지난 마감은 다시 알리지 않기', () => {
  const items = [
    task('late', '2026-11-10'),
    task('today', TODAY),
    task('tomorrow', TOMORROW),
    task('later', '2026-11-20'),
    task('doneLate', '2026-11-01', true),
  ]

  it('처음에는 지난 마감·오늘·내일(완료 제외)을 마감일 순으로 알린다', () => {
    expect(pickDeadlineAlerts(items, new Set(), TODAY, TOMORROW).map((d) => d.id)).toEqual([
      'late',
      'today',
      'tomorrow',
    ])
  })

  it('확인한 지난 마감은 빠지고, 오늘·내일 마감은 계속 알린다', () => {
    const shown = pickDeadlineAlerts(items, new Set(), TODAY, TOMORROW)
    const seen = new Set(nextDeadlineSeen(new Set(), shown, items, TODAY))
    expect([...seen]).toEqual([deadlineSeenId(items[0])])
    expect(pickDeadlineAlerts(items, seen, TODAY, TOMORROW).map((d) => d.id)).toEqual([
      'today',
      'tomorrow',
    ])
  })

  it('오늘 마감을 확인하고 날이 지나 마감이 지나면, 그때 한 번은 지난 마감으로 다시 알린다', () => {
    const shown = pickDeadlineAlerts([task('t', TODAY)], new Set(), TODAY, TOMORROW)
    const seen = new Set(nextDeadlineSeen(new Set(), shown, [task('t', TODAY)], TODAY))
    expect(seen.size).toBe(0)
    expect(pickDeadlineAlerts([task('t', TODAY)], seen, TOMORROW, '2026-11-15')).toHaveLength(1)
  })

  it('마감일을 바꾸면 그 작업은 다시 알리고, 완료·삭제된 작업의 기록은 정리한다', () => {
    const seen = new Set([deadlineSeenId(task('late', '2026-11-10')), deadlineSeenId(task('gone', '2026-11-01'))])
    const moved = [task('late', '2026-11-11')]
    expect(pickDeadlineAlerts(moved, seen, TODAY, TOMORROW).map((d) => d.id)).toEqual(['late'])
    expect(nextDeadlineSeen(seen, [], [task('late', '2026-11-10')], TODAY)).toEqual([
      deadlineSeenId(task('late', '2026-11-10')),
    ])
  })

  it('저장된 값이 깨져 있으면 빈 목록', () => {
    expect(parseDeadlineSeen(null).size).toBe(0)
    expect(parseDeadlineSeen('not json').size).toBe(0)
    expect(parseDeadlineSeen('{"a":1}').size).toBe(0)
    expect([...parseDeadlineSeen('["a@1", 2]')]).toEqual(['a@1'])
  })
})
