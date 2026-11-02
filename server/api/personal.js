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

/** 내 개인 공간 저장 */
router.put('/:slug', (req, res) => {
  const { note, files } = req.body ?? {}
  const safeNote = typeof note === 'string' ? note : ''
  const safeFiles = Array.isArray(files) ? files : []
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
