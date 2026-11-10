/**
 * 작은 유틸 테스트: CSV 만들기, 담당자 나누기, 마감일 표시.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { csvCell, toCsv } from '../../src/collab/csv'
import { dueBadge, dueState, localIsoDate, splitAssignees } from '../../src/collab/wbsUtils'

describe('CSV', () => {
  it('쉼표·따옴표·줄바꿈이 있는 칸은 큰따옴표로 감싸고 따옴표는 두 번 쓴다', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('그가 "안녕"')).toBe('"그가 ""안녕"""')
    expect(csvCell('첫 줄\n둘째 줄')).toBe('"첫 줄\n둘째 줄"')
  })

  it('수식으로 실행될 수 있는 칸은 앞에 작은따옴표를 붙인다 (CSV 수식 주입 방지)', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`)
    expect(csvCell('+1')).toBe("'+1")
    expect(csvCell('-5')).toBe("'-5")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
  })

  it('빈 값과 숫자', () => {
    expect(csvCell(undefined)).toBe('')
    expect(csvCell(null)).toBe('')
    expect(csvCell(42)).toBe('42')
  })

  it('행은 CRLF 로 이어진다', () => {
    expect(toCsv([['번호', '작업명'], [1, '보고서, 초안']])).toBe('번호,작업명\r\n1,"보고서, 초안"')
  })
})

describe('담당자 나누기', () => {
  it('쉼표·슬래시·가운뎃점·& 로 나누고 공백을 정리한다', () => {
    expect(splitAssignees('철수, 영희 / 민수·지수 & 하늘')).toEqual(['철수', '영희', '민수', '지수', '하늘'])
  })

  it('비어 있으면 빈 목록', () => {
    expect(splitAssignees('')).toEqual([])
    expect(splitAssignees(undefined)).toEqual([])
    expect(splitAssignees(' , ')).toEqual([])
  })
})

describe('마감일', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 4, 15, 0, 0)) // 2026-11-04 오후 3시 (로컬)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('localIsoDate 는 로컬 날짜를 YYYY-MM-DD 로', () => {
    expect(localIsoDate(0)).toBe('2026-11-04')
    expect(localIsoDate(1)).toBe('2026-11-05')
    expect(localIsoDate(-4)).toBe('2026-10-31') // 달이 바뀌어도
  })

  it('dueBadge: 오늘 / 남은 날 / 지난 날', () => {
    expect(dueBadge('2026-11-04', false)).toBe('D-DAY')
    expect(dueBadge('2026-11-06', false)).toBe('D-2')
    expect(dueBadge('2026-11-01', false)).toBe('3일 지남')
  })

  it('dueState: 없음 / 지남 / 임박(3일 이내) / 여유, 완료된 작업은 강조하지 않음', () => {
    expect(dueState(undefined, false)).toBe('none')
    expect(dueState('2026-11-03', false)).toBe('overdue')
    expect(dueState('2026-11-07', false)).toBe('soon')
    expect(dueState('2026-11-20', false)).toBe('normal')
    expect(dueState('2026-11-03', true)).toBe('normal')
  })
})
