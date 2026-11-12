/**
 * 팀원별 개인 공간 REST API.
 *
 * 각 사용자의 개인 노트(여러 개, 제목 포함)/파일을 방(slug)별로 서버 DB 에 저장한다.
 * 모든 라우트는 JWT 인증이 필요하며, 로그인한 본인(req.user.id)의 데이터에만 접근한다.
 * → 어느 기기/브라우저에서 로그인해도 같은 내용이 보인다.
 *
 *  GET  /api/personal/:slug   내 개인 공간 조회  → { notes, files, note }
 *  PUT  /api/personal/:slug   내 개인 공간 저장  ← { notes, files }
 *
 * 예전에는 노트가 한 개(note 문자열)였다. 그 값이 남아 있으면 "개인 노트" 라는 첫 노트로 보여 주고,
 * 여러 노트(notes)로 한 번 저장하면 예전 칸은 비운다. (예전 방식 { note } 저장도 그대로 받는다)
 */
import express from 'express'
import { db } from '../db.js'
import { asyncRoute, requireAuth } from './auth.js'

const router = express.Router()

/** 노트 개수·제목·본문 길이 상한 */
export const NOTE_LIMITS = { count: 50, title: 100, text: 200_000 }
/** 예전 한 개짜리 노트를 보여 줄 때 쓰는 id·제목 */
const LEGACY_NOTE_ID = 'note-legacy'
const LEGACY_NOTE_TITLE = '개인 노트'

// Postgres 의 TEXT 에는 NUL 문자를 넣을 수 없으므로 미리 뺀다.
const noNul = (s) => s.replace(/\u0000/g, '')

/** 노트 하나를 정해진 모양으로 정리한다. 모양이 틀리면 null */
export function cleanNote(n) {
  if (!n || typeof n !== 'object') return null
  const id = typeof n.id === 'string' ? n.id.trim().slice(0, 100) : ''
  if (!id) return null
  return {
    id,
    title: typeof n.title === 'string' ? noNul(n.title).slice(0, NOTE_LIMITS.title) : '',
    text: typeof n.text === 'string' ? noNul(n.text).slice(0, NOTE_LIMITS.text) : '',
    updatedAt: Number.isFinite(Number(n.updatedAt)) ? Number(n.updatedAt) : Date.now(),
  }
}

/** 노트 목록 정리: 모양이 틀린 항목·같은 id 는 빼고, 최대 개수까지 */
export function cleanNotes(list) {
  if (!Array.isArray(list)) return []
  const seen = new Set()
  const out = []
  for (const raw of list) {
    const n = cleanNote(raw)
    if (!n || seen.has(n.id)) continue
    seen.add(n.id)
    out.push(n)
    if (out.length >= NOTE_LIMITS.count) break
  }
  return out
}

function parseJson(raw, fallback) {
  try {
    const v = JSON.parse(raw)
    return v ?? fallback
  } catch {
    return fallback
  }
}

// 모든 개인 공간 라우트는 인증 필요
router.use(requireAuth)

/** 내 개인 공간 조회 */
router.get(
  '/:slug',
  asyncRoute(async (req, res) => {
    const row = await db.get(
      'SELECT note, files_json, notes_json, updated_at FROM personal_spaces WHERE user_id = ? AND room_slug = ?',
      [req.user.id, req.params.slug],
    )
    if (!row) {
      return res.json({ note: '', notes: [], files: [] })
    }
    const files = parseJson(row.files_json, [])
    let notes = cleanNotes(parseJson(row.notes_json, []))
    // 예전 한 개짜리 노트가 남아 있으면 첫 노트로 보여 준다
    if (notes.length === 0 && row.note) {
      notes = [{ id: LEGACY_NOTE_ID, title: LEGACY_NOTE_TITLE, text: row.note, updatedAt: Number(row.updated_at) || 0 }]
    }
    res.json({ note: row.note ?? '', notes, files: Array.isArray(files) ? files : [] })
  }),
)

/** 파일 항목 하나를 정해진 모양으로 정리한다. 실행될 수 있는 주소(javascript: 등)는 버린다. */
function cleanFile(f) {
  if (!f || typeof f !== 'object') return null
  const url = typeof f.url === 'string' ? f.url : ''
  if (!/^data:/i.test(url)) return null // 개인 파일은 브라우저에서 읽은 data URL 만 저장한다
  return {
    id: String(f.id ?? '').slice(0, 100),
    name: String(f.name ?? 'file').slice(0, 200),
    url,
    size: Number.isFinite(Number(f.size)) ? Number(f.size) : 0,
  }
}

/** 내 개인 공간 저장 (그 보드의 멤버만) */
router.put(
  '/:slug',
  asyncRoute(async (req, res) => {
    const room = await db.get('SELECT id FROM rooms WHERE slug = ?', [req.params.slug])
    if (!room) return res.status(404).json({ error: '존재하지 않는 방입니다.' })
    const membership = await db.get('SELECT role FROM room_members WHERE room_id = ? AND user_id = ?', [
      room.id,
      req.user.id,
    ])
    if (!membership || membership.role === 'invited') {
      return res.status(403).json({ error: '이 방에 접근할 권한이 없습니다.' })
    }
    const { note, notes, files } = req.body ?? {}
    const safeFiles = Array.isArray(files) ? files.map(cleanFile).filter(Boolean) : []
    // 여러 노트로 저장하면 예전 한 개짜리 칸은 비운다 (다 지웠는데 예전 노트가 되살아나지 않게)
    const useNotes = Array.isArray(notes)
    const safeNote = useNotes ? '' : typeof note === 'string' ? noNul(note) : ''
    const safeNotes = useNotes ? cleanNotes(notes) : []
    await db.run(
      `INSERT INTO personal_spaces (user_id, room_slug, note, files_json, notes_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, room_slug)
       DO UPDATE SET note = excluded.note, files_json = excluded.files_json,
                     notes_json = excluded.notes_json, updated_at = excluded.updated_at`,
      [req.user.id, req.params.slug, safeNote, JSON.stringify(safeFiles), JSON.stringify(safeNotes), Date.now()],
    )
    res.json({ ok: true })
  }),
)

export default router
