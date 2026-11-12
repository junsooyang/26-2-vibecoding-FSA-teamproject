/**
 * 개인 노트 목록 다루기 (순수 함수 — 화면과 분리해 테스트한다).
 */
import type { PersonalNote } from '../api/client'

/** 노트 최대 개수 (서버 상한과 같게) */
export const MAX_NOTES = 50
/** 제목을 비워 둔 노트가 목록에 보이는 이름 */
export const UNTITLED = '제목 없는 노트'

export function newNoteId(now = Date.now()): string {
  return `note-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** 목록에 보일 제목: 제목이 없으면 본문 첫 줄, 그것도 없으면 "제목 없는 노트" */
export function noteLabel(n: Pick<PersonalNote, 'title' | 'text'>): string {
  const t = n.title.trim()
  if (t) return t
  const firstLine = n.text.split('\n').find((l) => l.trim())?.trim() ?? ''
  return firstLine ? firstLine.slice(0, 30) : UNTITLED
}

/** 새 노트를 맨 앞에 추가 (최대 개수면 그대로) */
export function addNote(notes: PersonalNote[], now = Date.now()): { notes: PersonalNote[]; id: string | null } {
  if (notes.length >= MAX_NOTES) return { notes, id: null }
  const note: PersonalNote = { id: newNoteId(now), title: '', text: '', updatedAt: now }
  return { notes: [note, ...notes], id: note.id }
}

/** 노트 하나 고치기 (제목·본문). 고친 시각을 기록한다 */
export function updateNote(
  notes: PersonalNote[],
  id: string,
  patch: Partial<Pick<PersonalNote, 'title' | 'text'>>,
  now = Date.now(),
): PersonalNote[] {
  return notes.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: now } : n))
}

/** 노트 지우기. 지운 뒤 고를 노트 id(바로 아래, 없으면 위, 다 지웠으면 null)도 함께 */
export function removeNote(notes: PersonalNote[], id: string): { notes: PersonalNote[]; nextId: string | null } {
  const idx = notes.findIndex((n) => n.id === id)
  if (idx < 0) return { notes, nextId: notes[0]?.id ?? null }
  const rest = notes.filter((n) => n.id !== id)
  const next = rest[idx] ?? rest[idx - 1] ?? null
  return { notes: rest, nextId: next ? next.id : null }
}

/** 시각을 짧게: 오늘이면 "14:05", 아니면 "11/3" */
export function formatNoteTime(ms: number, now = Date.now()): string {
  if (!ms) return ''
  const d = new Date(ms)
  const today = new Date(now)
  const pad = (v: number) => String(v).padStart(2, '0')
  if (d.toDateString() === today.toDateString()) return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return `${d.getMonth() + 1}/${d.getDate()}`
}
