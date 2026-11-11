/**
 * 팀원별 개인 공간 REST API.
 *
 * 각 사용자의 개인 노트/파일을 방(slug)별로 서버(SQLite)에 저장한다.
 * 모든 라우트는 JWT 인증이 필요하며, 로그인한 본인(req.user.id)의 데이터에만 접근한다.
 * → 어느 기기/브라우저에서 로그인해도 같은 내용이 보인다.
 *
 *  GET  /api/personal/:slug   내 개인 공간 조회
 *  PUT  /api/personal/:slug   내 개인 공간 저장(노트 + 파일 목록)
 */
import express from 'express'
import db from './db.js'
import { requireAuth } from './auth.js'

const router = express.Router()

const getSpace = db.prepare(
  'SELECT note, files_json FROM personal_spaces WHERE user_id = ? AND room_slug = ?',
)
const upsertSpace = db.prepare(`
  INSERT INTO personal_spaces (user_id, room_slug, note, files_json, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(user_id, room_slug)
  DO UPDATE SET note = excluded.note, files_json = excluded.files_json, updated_at = excluded.updated_at
`)

const findRoomBySlug = db.prepare('SELECT id FROM rooms WHERE slug = ?')
const findMember = db.prepare('SELECT role FROM room_members WHERE room_id = ? AND user_id = ?')

// 모든 개인 공간 라우트는 인증 필요
router.use(requireAuth)

/** 내 개인 공간 조회 */
router.get('/:slug', (req, res) => {
  const row = getSpace.get(req.user.id, req.params.slug)
  if (!row) {
    return res.json({ note: '', files: [] })
  }
  let files = []
  try {
    files = JSON.parse(row.files_json)
  } catch {
    files = []
  }
  res.json({ note: row.note ?? '', files })
})

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
router.put('/:slug', (req, res) => {
  const room = findRoomBySlug.get(req.params.slug)
  if (!room) return res.status(404).json({ error: '존재하지 않는 방입니다.' })
  const membership = findMember.get(room.id, req.user.id)
  if (!membership || membership.role === 'invited') {
    return res.status(403).json({ error: '이 방에 접근할 권한이 없습니다.' })
  }
  const { note, files } = req.body ?? {}
  const safeNote = typeof note === 'string' ? note : ''
  const safeFiles = Array.isArray(files) ? files.map(cleanFile).filter(Boolean) : []
  upsertSpace.run(
    req.user.id,
    req.params.slug,
    safeNote,
    JSON.stringify(safeFiles),
    Date.now(),
  )
  res.json({ ok: true })
})

export default router
