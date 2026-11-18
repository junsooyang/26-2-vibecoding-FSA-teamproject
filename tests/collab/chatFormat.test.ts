import { describe, expect, it } from 'vitest'
import {
  formatChatDate,
  formatChatDateTime,
  makeReplyRef,
  searchChat,
  splitByQuery,
  withDateDividers,
} from '../../src/collab/chatFormat'
import type { ChatMessage } from '../../src/collab/yjs'

const msg = (id: string, at: Date, text = 'hi', author = 'A'): ChatMessage => ({
  id,
  author,
  authorUsername: author.toLowerCase(),
  color: '#000',
  text,
  at: at.getTime(),
})

describe('채팅 날짜 구분선', () => {
  it('"2026년 11월 13일 금요일" 형식', () => {
    expect(formatChatDate(new Date(2026, 10, 13, 0, 0).getTime())).toBe('2026년 11월 13일 금요일')
  })

  it('앞 메시지와 날짜가 바뀐 새 메시지 앞에만 넣고, 첫 메시지 앞에는 넣지 않는다', () => {
    const items = withDateDividers([
      msg('a', new Date(2026, 10, 12, 23, 58)),
      msg('b', new Date(2026, 10, 12, 23, 59)),
      msg('c', new Date(2026, 10, 13, 0, 0)),
      msg('d', new Date(2026, 10, 13, 9, 0)),
    ])
    expect(items.map((i) => (i.kind === 'date' ? `[${i.label}]` : i.message.id))).toEqual([
      'a',
      'b',
      '[2026년 11월 13일 금요일]',
      'c',
      'd',
    ])
  })

  it('검색 결과용 날짜·시각은 올해가 아니면 연도를 붙인다', () => {
    const now = new Date(2026, 10, 13).getTime()
    expect(formatChatDateTime(new Date(2026, 10, 12, 9, 5).getTime(), now)).toBe('11월 12일 09:05')
    expect(formatChatDateTime(new Date(2025, 0, 2, 13, 0).getTime(), now)).toBe('2025년 1월 2일 13:00')
  })
})

describe('채팅 검색', () => {
  const list = [msg('a', new Date(), '회의는 내일'), msg('b', new Date(), '좋아요', '민수'), msg('c', new Date(), 'API 정리')]

  it('내용이나 보낸 사람으로 찾고, 앞뒤 공백·대소문자는 무시한다', () => {
    expect(searchChat(list, ' 회의 ').map((m) => m.id)).toEqual(['a'])
    expect(searchChat(list, '민수').map((m) => m.id)).toEqual(['b'])
    expect(searchChat(list, 'api').map((m) => m.id)).toEqual(['c'])
    expect(searchChat(list, '   ')).toHaveLength(3)
  })

  it('찾은 글자를 강조할 수 있게 나눈다', () => {
    expect(splitByQuery('aXbx', 'x')).toEqual([
      { text: 'a', hit: false },
      { text: 'X', hit: true },
      { text: 'b', hit: false },
      { text: 'x', hit: true },
    ])
    expect(splitByQuery('abc', '')).toEqual([{ text: 'abc', hit: false }])
  })
})

describe('채팅 답장 인용', () => {
  it('원문을 한 줄로 줄이고 80자를 넘으면 … 를 붙인다', () => {
    const long = msg('z', new Date(), `${'가'.repeat(100)}\n끝`, '영희')
    const ref = makeReplyRef(long)
    expect(ref).toMatchObject({ id: 'z', author: '영희' })
    expect(ref.text).toHaveLength(81)
    expect(ref.text.endsWith('…')).toBe(true)
    expect(makeReplyRef(msg('y', new Date(), '줄\n바꿈')).text).toBe('줄 바꿈')
  })
})
