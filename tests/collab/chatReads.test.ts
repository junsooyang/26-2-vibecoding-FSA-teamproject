/**
 * 채팅 읽음 표시 테스트 (src/collab/chatReads.ts 의 실제 코드 사용).
 */
import { describe, expect, it } from 'vitest'
import {
  advanceRead,
  myUnreadCount,
  unreadCountsByMessage,
  type ChatMember,
  type ChatRead,
} from '../../src/collab/chatReads'
import type { ChatMessage } from '../../src/collab/yjs'

const msg = (id: string, author: string, at: number): ChatMessage => ({
  id,
  author,
  authorUsername: author,
  color: '#000',
  text: id,
  at,
})

// 3명 방: A, B, C (모두 시각 0 에 들어옴)
const members: ChatMember[] = [
  { username: 'a', joinedAt: 0 },
  { username: 'b', joinedAt: 0 },
  { username: 'c', joinedAt: 0 },
]

describe('메시지별 안 읽은 사람 수 (카카오톡처럼)', () => {
  it('3명 방에서 A 가 보내면 2, B 가 읽으면 1, C 까지 읽으면 0', () => {
    const messages = [msg('m1', 'a', 100)]
    const reads: Record<string, ChatRead> = { a: { id: 'm1', at: 100 } }
    expect(unreadCountsByMessage(messages, reads, members).m1).toBe(2)

    reads.b = { id: 'm1', at: 100 }
    expect(unreadCountsByMessage(messages, reads, members).m1).toBe(1)

    reads.c = { id: 'm1', at: 100 }
    expect(unreadCountsByMessage(messages, reads, members).m1).toBe(0)
  })

  it('보낸 사람은 읽음 기록이 없어도 세지 않는다', () => {
    const messages = [msg('m1', 'a', 100)]
    expect(unreadCountsByMessage(messages, {}, members).m1).toBe(2)
  })

  it('뒤 메시지를 읽었으면 앞 메시지도 읽은 것 (순서로 비교)', () => {
    const messages = [msg('m1', 'a', 100), msg('m2', 'a', 200), msg('m3', 'b', 300)]
    const reads = { b: { id: 'm2', at: 200 }, c: { id: 'm1', at: 100 } }
    const counts = unreadCountsByMessage(messages, reads, members)
    expect(counts.m1).toBe(0) // b, c 둘 다 읽음
    expect(counts.m2).toBe(1) // c 아직
    expect(counts.m3).toBe(2) // a, c 아직 (b 는 보낸 사람)
  })

  it('메시지가 올라온 뒤에 들어온 멤버는 세지 않는다', () => {
    const messages = [msg('m1', 'a', 100), msg('m2', 'a', 500)]
    const late: ChatMember[] = [...members.slice(0, 2), { username: 'c', joinedAt: 300 }]
    const counts = unreadCountsByMessage(messages, {}, late)
    expect(counts.m1).toBe(1) // b 만
    expect(counts.m2).toBe(2) // b, c
  })

  it('읽은 메시지가 지워졌으면 시각으로 비교한다', () => {
    const messages = [msg('m1', 'a', 100), msg('m3', 'a', 300)]
    const reads = { b: { id: 'deleted', at: 200 } }
    const counts = unreadCountsByMessage(messages, reads, members)
    expect(counts.m1).toBe(1) // b 는 읽음(200 >= 100), c 안 읽음
    expect(counts.m3).toBe(2)
  })
})

describe('내 안 읽은 메시지 수', () => {
  it('내가 보낸 메시지는 세지 않는다', () => {
    const messages = [msg('m1', 'a', 100), msg('m2', 'b', 200), msg('m3', 'a', 300)]
    expect(myUnreadCount(messages, undefined, 'a')).toBe(1) // m2 만
  })

  it('읽은 위치 뒤의 다른 사람 메시지만 센다', () => {
    const messages = [msg('m1', 'b', 100), msg('m2', 'b', 200), msg('m3', 'c', 300)]
    expect(myUnreadCount(messages, { id: 'm2', at: 200 }, 'a')).toBe(1)
    expect(myUnreadCount(messages, { id: 'm3', at: 300 }, 'a')).toBe(0)
  })
})

describe('읽은 위치 갱신', () => {
  const messages = [msg('m1', 'a', 100), msg('m2', 'b', 200)]

  it('앞으로만 이동한다 (이미 더 뒤를 읽었으면 그대로)', () => {
    expect(advanceRead(messages, undefined, { id: 'm1', at: 100 })).toEqual({ id: 'm1', at: 100 })
    expect(advanceRead(messages, { id: 'm1', at: 100 }, { id: 'm2', at: 200 })).toEqual({
      id: 'm2',
      at: 200,
    })
    expect(advanceRead(messages, { id: 'm2', at: 200 }, { id: 'm1', at: 100 })).toBeNull()
    expect(advanceRead(messages, { id: 'm2', at: 200 }, { id: 'm2', at: 200 })).toBeNull()
  })
})
