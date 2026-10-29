/**
 * 방 관리 REST API.
 *
 * 권한 모델:
 *  - owner(팀장): 방 생성자. 멤버 초대/강퇴, 방 삭제 가능.
 *  - member(참여자): 방 입장/편집만 가능.
 *
 * 방의 slug 는 실시간 동기화(y-websocket)에서 쓰는 "방 이름"과 동일하다.
 */
import express from 'express'
import db from './db.js'
import { requireAuth } from './auth.js'

const router = express.Router()
router.use(requireAuth)

// --- prepared statements ---
const insertRoom = db.prepare(
  'INSERT INTO rooms (slug, name, owner_id, created_at) VALUES (?, ?, ?, ?)',
)
const findRoomBySlug = db.prepare('SELECT * FROM rooms WHERE slug = ?')
const findRoomById = db.prepare('SELECT * FROM rooms WHERE id = ?')
const insertMember = db.prepare(
  'INSERT OR IGNORE INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)',
)
const findMember = db.prepare('SELECT * FROM room_members WHERE room_id = ? AND user_id = ?')
const deleteMember = db.prepare('DELETE FROM room_members WHERE room_id = ? AND user_id = ?')
const deleteRoom = db.prepare('DELETE FROM rooms WHERE id = ?')
const findUserByEmail = db.prepare('SELECT id, email, name FROM users WHERE email = ?')

// 내가 속한 방 목록 (역할 포함)
const listMyRooms = db.prepare(`
  SELECT r.id, r.slug, r.name, r.owner_id, r.created_at, m.role,
         (SELECT COUNT(*) FROM room_members WHERE room_id = r.id) AS member_count
  FROM rooms r
  JOIN room_members m ON m.room_id = r.id
  WHERE m.user_id = ?
  ORDER BY r.created_at DESC
`)

// 방의 멤버 목록
const listMembers = db.prepare(`
  SELECT u.id, u.email, u.name, m.role, m.joined_at
  FROM room_members m
  JOIN users u ON u.id = m.user_id
  WHERE m.room_id = ?
  ORDER BY m.role DESC, m.joined_at ASC
`)

/** slug 생성: 공백/특수문자를 정리하고 짧은 랜덤 접미사를 붙여 유일성 확보. */
function makeSlug(name) {
  const base =
    String(name)
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'room'
  return `${base}-${Math.random().toString(36).slice(2, 8)}`
}

// 방 생성 (생성자가 owner 가 됨)
router.post('/', (req, res) => {
  const { name } = req.body ?? {}
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: '방 이름을 입력하세요.' })
  }
  const slug = makeSlug(name)
  const now = Date.now()
  const info = insertRoom.run(slug, String(name).trim(), req.user.id, now)
  const roomId = Number(info.lastInsertRowid)
  insertMember.run(roomId, req.user.id, 'owner', now)
  return res.status(201).json({ room: findRoomById.get(roomId) })
})

// 내가 속한 방 목록
router.get('/', (req, res) => {
  res.json({ rooms: listMyRooms.all(req.user.id) })
})

/** 방 접근 권한 확인 미들웨어: 멤버여야 통과, req.room / req.membership 세팅 */
function loadRoomMembership(req, res, next) {
  const room = findRoomBySlug.get(req.params.slug)
  if (!room) return res.status(404).json({ error: '존재하지 않는 방입니다.' })
  const membership = findMember.get(room.id, req.user.id)
  if (!membership) return res.status(403).json({ error: '이 방에 접근할 권한이 없습니다.' })
  req.room = room
  req.membership = membership
  next()
}

// 방 상세 (멤버 목록 포함)
router.get('/:slug', loadRoomMembership, (req, res) => {
  res.json({
    room: req.room,
    role: req.membership.role,
    members: listMembers.all(req.room.id),
  })
})

// 멤버 초대 (owner 만) — 이메일로 기존 사용자를 member 로 추가
router.post('/:slug/members', loadRoomMembership, (req, res) => {
  if (req.membership.role !== 'owner') {
    return res.status(403).json({ error: '팀장(owner)만 초대할 수 있습니다.' })
  }
  const { email } = req.body ?? {}
  if (!email) return res.status(400).json({ error: '초대할 사용자의 이메일을 입력하세요.' })

  const invitee = findUserByEmail.get(email)
  if (!invitee) {
    return res.status(404).json({ error: '해당 이메일의 가입된 사용자를 찾을 수 없습니다.' })
  }
  if (findMember.get(req.room.id, invitee.id)) {
    return res.status(409).json({ error: '이미 방에 속한 사용자입니다.' })
  }
  insertMember.run(req.room.id, invitee.id, 'member', Date.now())
  return res.status(201).json({ members: listMembers.all(req.room.id) })
})

// 멤버 강퇴 (owner 만, owner 자신은 강퇴 불가)
router.delete('/:slug/members/:userId', loadRoomMembership, (req, res) => {
  if (req.membership.role !== 'owner') {
    return res.status(403).json({ error: '팀장(owner)만 멤버를 내보낼 수 있습니다.' })
  }
  const targetId = Number(req.params.userId)
  if (targetId === req.user.id) {
    return res.status(400).json({ error: '팀장은 자신을 내보낼 수 없습니다.' })
  }
  deleteMember.run(req.room.id, targetId)
  return res.json({ members: listMembers.all(req.room.id) })
})

// 방 삭제 (owner 만). CASCADE 로 멤버도 함께 삭제됨.
router.delete('/:slug', loadRoomMembership, (req, res) => {
  if (req.membership.role !== 'owner') {
    return res.status(403).json({ error: '팀장(owner)만 방을 삭제할 수 있습니다.' })
  }
  deleteRoom.run(req.room.id)
  return res.json({ ok: true })
})

export default router
