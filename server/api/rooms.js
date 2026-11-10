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
import { removeRoomFiles } from './files.js'

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
const updateMemberRole = db.prepare(
  'UPDATE room_members SET role = ?, joined_at = ? WHERE room_id = ? AND user_id = ?',
)
const deleteRoom = db.prepare('DELETE FROM rooms WHERE id = ?')
const findUserByUsername = db.prepare('SELECT id, username, name FROM users WHERE username = ?')

// 내가 "참여 중"인 방 목록 (초대 대기 invited 는 제외)
const listMyRooms = db.prepare(`
  SELECT r.id, r.slug, r.name, r.owner_id, r.created_at, m.role,
         (SELECT COUNT(*) FROM room_members WHERE room_id = r.id AND role != 'invited') AS member_count
  FROM rooms r
  JOIN room_members m ON m.room_id = r.id
  WHERE m.user_id = ? AND m.role != 'invited'
  ORDER BY r.created_at DESC
`)

// 내가 "초대 받은(대기 중)" 방 목록
const listMyInvites = db.prepare(`
  SELECT r.id, r.slug, r.name, r.owner_id, r.created_at,
         (SELECT u.name FROM users u WHERE u.id = r.owner_id) AS owner_name
  FROM rooms r
  JOIN room_members m ON m.room_id = r.id
  WHERE m.user_id = ? AND m.role = 'invited'
  ORDER BY r.created_at DESC
`)

// 방의 멤버 목록 (초대 대기 invited 포함 — owner 가 현황을 볼 수 있게)
const listMembers = db.prepare(`
  SELECT u.id, u.username, u.name, m.role, m.joined_at
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

// 내가 참여 중인 방 목록
router.get('/', (req, res) => {
  res.json({ rooms: listMyRooms.all(req.user.id) })
})

// 내가 초대받은(대기 중) 방 목록
router.get('/invites/list', (req, res) => {
  res.json({ invites: listMyInvites.all(req.user.id) })
})

/**
 * 방 접근 권한 확인 미들웨어: 참여 중(owner/member)이어야 통과.
 * 초대 대기(invited) 상태면 아직 입장 불가 → 수락이 필요하다.
 */
function loadRoomMembership(req, res, next) {
  const room = findRoomBySlug.get(req.params.slug)
  if (!room) return res.status(404).json({ error: '존재하지 않는 방입니다.' })
  const membership = findMember.get(room.id, req.user.id)
  if (!membership) return res.status(403).json({ error: '이 방에 접근할 권한이 없습니다.' })
  if (membership.role === 'invited') {
    return res.status(403).json({ error: '초대를 수락해야 입장할 수 있습니다.' })
  }
  req.room = room
  req.membership = membership
  next()
}

/** 초대 수락/거절용: invited 상태의 멤버십을 찾아 req.room / req.membership 세팅 */
function loadInvite(req, res, next) {
  const room = findRoomBySlug.get(req.params.slug)
  if (!room) return res.status(404).json({ error: '존재하지 않는 방입니다.' })
  const membership = findMember.get(room.id, req.user.id)
  if (!membership || membership.role !== 'invited') {
    return res.status(404).json({ error: '대기 중인 초대가 없습니다.' })
  }
  req.room = room
  req.membership = membership
  next()
}

// 초대 수락 → invited 를 member 로 승격
router.post('/:slug/accept', loadInvite, (req, res) => {
  updateMemberRole.run('member', Date.now(), req.room.id, req.user.id)
  return res.json({ ok: true, room: req.room })
})

// 초대 거절 → 멤버십 삭제
router.post('/:slug/decline', loadInvite, (req, res) => {
  deleteMember.run(req.room.id, req.user.id)
  return res.json({ ok: true })
})

// 방 상세 (멤버 목록 포함)
router.get('/:slug', loadRoomMembership, (req, res) => {
  res.json({
    room: req.room,
    role: req.membership.role,
    members: listMembers.all(req.room.id),
  })
})

// 멤버 초대 (owner 만) — 아이디로 기존 사용자를 member 로 추가
router.post('/:slug/members', loadRoomMembership, (req, res) => {
  if (req.membership.role !== 'owner') {
    return res.status(403).json({ error: '팀장(owner)만 초대할 수 있습니다.' })
  }
  const { username } = req.body ?? {}
  if (!username) return res.status(400).json({ error: '초대할 사용자의 아이디를 입력하세요.' })

  const invitee = findUserByUsername.get(username)
  if (!invitee) {
    return res.status(404).json({ error: '해당 아이디의 가입된 사용자를 찾을 수 없습니다.' })
  }
  const existing = findMember.get(req.room.id, invitee.id)
  if (existing) {
    if (existing.role === 'invited') {
      return res.status(409).json({ error: '이미 초대한 사용자입니다. (수락 대기 중)' })
    }
    return res.status(409).json({ error: '이미 방에 속한 사용자입니다.' })
  }
  // 바로 멤버가 아니라 "초대 대기(invited)" 상태로 추가 → 당사자가 수락해야 입장 가능
  insertMember.run(req.room.id, invitee.id, 'invited', Date.now())
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

// 팀장 위임 (owner 만) — 참여자(member) 중 한 명을 새 팀장으로, 나는 참여자가 된다.
router.post('/:slug/transfer', loadRoomMembership, (req, res) => {
  if (req.membership.role !== 'owner') {
    return res.status(403).json({ error: '팀장(owner)만 위임할 수 있습니다.' })
  }
  const targetId = Number(req.body?.userId)
  if (!Number.isInteger(targetId) || targetId === req.user.id) {
    return res.status(400).json({ error: '팀장을 맡길 팀원을 선택하세요.' })
  }
  const target = findMember.get(req.room.id, targetId)
  if (!target || target.role !== 'member') {
    return res
      .status(400)
      .json({ error: '초대를 수락한 참여자에게만 팀장을 맡길 수 있습니다.' })
  }
  const now = Date.now()
  // 세 변경이 함께 성공하거나 함께 실패하도록 하나의 트랜잭션으로 처리
  db.exec('BEGIN')
  try {
    updateMemberRole.run('owner', target.joined_at, req.room.id, targetId)
    updateMemberRole.run('member', req.membership.joined_at ?? now, req.room.id, req.user.id)
    db.prepare('UPDATE rooms SET owner_id = ? WHERE id = ?').run(targetId, req.room.id)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return res.json({ ok: true, role: 'member', members: listMembers.all(req.room.id) })
})

// 보드에서 나가기 (참여자 본인). 팀장은 먼저 위임하거나 보드를 삭제해야 한다.
router.post('/:slug/leave', loadRoomMembership, (req, res) => {
  if (req.membership.role === 'owner') {
    return res
      .status(400)
      .json({ error: '팀장은 나갈 수 없어요. 먼저 다른 팀원에게 팀장을 맡기거나 보드를 삭제하세요.' })
  }
  deleteMember.run(req.room.id, req.user.id)
  // 나간 사람의 개인 공간(이 보드용 개인 노트/파일)도 함께 정리
  db.prepare('DELETE FROM personal_spaces WHERE user_id = ? AND room_slug = ?').run(
    req.user.id,
    req.room.slug,
  )
  return res.json({ ok: true })
})

// 방 삭제 (owner 만). CASCADE 로 멤버도 함께 삭제됨.
router.delete('/:slug', loadRoomMembership, (req, res) => {
  if (req.membership.role !== 'owner') {
    return res.status(403).json({ error: '팀장(owner)만 방을 삭제할 수 있습니다.' })
  }
  deleteRoom.run(req.room.id)
  // 방에 딸린 데이터도 함께 정리: 팀원들의 개인 공간 + 보드 내용(Yjs 문서 스냅샷).
  // docs 테이블은 실시간 서버(persistence.js)가 만들므로 아직 없을 수 있어 실패해도 무시한다.
  try {
    db.prepare('DELETE FROM personal_spaces WHERE room_slug = ?').run(req.room.slug)
    db.prepare('DELETE FROM docs WHERE name = ?').run(req.room.slug)
    removeRoomFiles(req.room.slug) // 업로드된 사진/첨부 파일(디스크 + 기록)
  } catch (err) {
    console.warn('[api] 방 부속 데이터 정리 중 경고:', err instanceof Error ? err.message : err)
  }
  return res.json({ ok: true })
})

export default router
