import { describe, expect, it } from 'vitest'
import type { PersonalNote } from '../../src/api/client'
import {
  MAX_NOTES,
  UNTITLED,
  addNote,
  formatNoteTime,
  noteLabel,
  removeNote,
  updateNote,
} from '../../src/screens/personalNotes'

const n = (id: string, title = '', text = ''): PersonalNote => ({ id, title, text, updatedAt: 0 })

describe('noteLabel', () => {
  it('제목 → 본문 첫 줄 → "제목 없는 노트" 순서', () => {
    expect(noteLabel({ title: ' 회의록 ', text: '본문' })).toBe('회의록')
    expect(noteLabel({ title: '', text: '\n\n  첫 줄  \n둘째 줄' })).toBe('첫 줄')
    expect(noteLabel({ title: '  ', text: '' })).toBe(UNTITLED)
  })
})

describe('addNote / updateNote / removeNote', () => {
  it('새 노트는 맨 앞에 빈 제목으로', () => {
    const { notes, id } = addNote([n('a')], 1000)
    expect(notes).toHaveLength(2)
    expect(notes[0]).toEqual({ id, title: '', text: '', updatedAt: 1000 })
  })

  it('최대 개수면 더 만들지 않는다', () => {
    const full = Array.from({ length: MAX_NOTES }, (_, i) => n(`n${i}`))
    expect(addNote(full)).toEqual({ notes: full, id: null })
  })

  it('고친 노트만 바뀌고 고친 시각이 남는다', () => {
    const out = updateNote([n('a', 'A'), n('b', 'B')], 'b', { title: 'B2' }, 5)
    expect(out[0]).toEqual(n('a', 'A'))
    expect(out[1]).toEqual({ id: 'b', title: 'B2', text: '', updatedAt: 5 })
  })

  it('지우면 바로 아래(없으면 위) 노트를 고른다', () => {
    const list = [n('a'), n('b'), n('c')]
    expect(removeNote(list, 'b').nextId).toBe('c')
    expect(removeNote(list, 'c').nextId).toBe('b')
    expect(removeNote([n('a')], 'a')).toEqual({ notes: [], nextId: null })
  })
})

describe('formatNoteTime', () => {
  it('오늘이면 시:분, 아니면 월/일', () => {
    const now = new Date(2026, 10, 12, 15, 0).getTime()
    expect(formatNoteTime(new Date(2026, 10, 12, 9, 5).getTime(), now)).toBe('09:05')
    expect(formatNoteTime(new Date(2026, 10, 3, 9, 5).getTime(), now)).toBe('11/3')
    expect(formatNoteTime(0, now)).toBe('')
  })
})
