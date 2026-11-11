/**
 * 방 관리 REST API.
 *
 * 권한 모델:
 *  - owner(팀장): 방 생성자. 멤버 초대/강퇴, 방 삭제 가능.
 *  - member(참여자): 방 입장/편집만 가능.
 *
 * 방의 slug 는 실시간 동기화(y-websocket)에서 쓰는 "방 이름"과 동일하다.
 */
import crypto from 'node:crypto'
import express from 'express'
import { db } from '../db.js'
import { asyncRoute, requireAuth } from './auth.js'
import { removeRoomFiles } from './files.js'

const router = express.Router()
router.use(requireAuth)

// --- 쿼리 ---
const SQL = {
  findRoomBySlug: 'SELECT * FROM rooms WHERE slug = ?',
  findRoomById: 'SELECT * FROM rooms WHERE id = ?',
  insertRoom: 'INSERT INTO rooms (slug, name, owner_id, created_at) VALUES (?, ?, ?, ?) RETURNING id',
  insertMember:
    'INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
  findMember: 'SELECT * FROM room_members WHERE room_id = ? AND user_id = ?',
  deleteMember: 'DELETE FROM room_members WHERE room_id = ? AND user_id = ?',
  updateMemberRole: 'UPDATE room_members SET role = ?, joined_at = ? WHERE room_id = ? AND user_id = ?',
  findUserByUsername: 'SELECT id, username, name FROM users WHERE username = ?',
  deletePersonalSpace: 'DELETE FROM personal_spaces WHERE user_id = ? AND room_slug = ?',
  // 내가 "참여 중"인 방 목록 (초대 대기 invited 는 제외)
  listMyRooms: `
    SELECT r.id, r.slug, r.name, r.owner_id, r.created_at, m.role,
           (SELECT CAST(COUNT(*) AS INTEGER) FROM room_members WHERE room_id = r.id AND role <> 'invited') AS member_count
    FROM rooms r
    JOIN room_members m ON m.room_id = r.id
    WHERE m.user_id = ? AND m.role <> 'invited'
    ORDER BY r.created_at DESC`,
  // 내가 "초대 받은(대기 중)" 방 목록
  listMyInvites: `
    SELECT r.id, r.slug, r.name, r.owner_id, r.created_at,
           (SELECT u.name FROM users u WHERE u.id = r.owner_id) AS owner_name
    FROM rooms r
    JOIN room_members m ON m.room_id = r.id
    WHERE m.user_id = ? AND m.role = 'invited'
    ORDER BY r.created_at DESC`,
  // 방의 멤버 목록 (초대 대기 invited 포함 — owner 가 현황을 볼 수 있게)
  listMembers: `
    SELECT u.id, u.username, u.name, m.role, m.joined_at
    FROM room_members m
    JOIN users u ON u.id = m.user_id
    WHERE m.room_id = ?
    ORDER BY m.role DESC, m.joined_at ASC`,
}

const listMembers = (roomId) => db.all(SQL.listMembers, [roomId])

/** slug 생성: 공백/특수문자를 정리하고 짧은 랜덤 접미사를 붙여 유일성 확보. */
function makeSlug(name) {
  const base =
    String(name)
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'room'
  // 추측하기 어렵도록 암호학적 난수로 접미사를 만든다 (영문 소문자+숫자 8자)
  const suffix = crypto.randomBytes(6).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '')
  return `${base}-${(suffix + '00000000').slice(0, 8)}`
}

const ROOM_NAME_MAX = 50

// 방 생성 (생성자가 owner 가 됨)
router.post(
  '/',
  asyncRoute(async (req, res) => {
    const { name } = req.body ?? {}
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: '방 이름을 입력하세요.' })
    }
    if (name.trim().length > ROOM_NAME_MAX) {
      return res.status(400).json({ error: `방 이름은 ${ROOM_NAME_MAX}자 이하로 입력하세요.` })
    }
    let slug = makeSlug(name)
    while (await db.get(SQL.findRoomBySlug, [slug])) slug = makeSlug(name)
    const now = Date.now()
    // 방과 팀장 멤버십을 함께 만든다 (한쪽만 생기지 않도록)
    const room = await db.tx(async (t) => {
      const { id } = await t.get(SQL.insertRoom, [slug, name.trim(), req.user.id, now])
      await t.run(SQL.insertMember, [id, req.user.id, 'owner', now])
      return t.get(SQL.findRoomById, [id])
    })
    return res.status(201).json({ room })
  }),
)

// 내가 참여 중인 방 목록
router.get(
  '/',
  asyncRoute(async (req, res) => {
    res.json({ rooms: await db.all(SQL.listMyRooms, [req.user.id]) })
  }),
)

// 내가 초대받은(대기 중) 방 목록
router.get(
  '/invites/list',
  asyncRoute(async (req, res) => {
    res.json({ invites: await db.all(SQL.listMyInvites, [req.user.id]) })
  }),
)

/**
 * 방 접근 권한 확인 미들웨어: 참여 중(owner/member)이어야 통과.
 * 초대 대기(invited) 상태면 아직 입장 불가 → 수락이 필요하다.
 */
const loadRoomMembership = asyncRoute(async (req, res, next) => {
  const room = await db.get(SQL.findRoomBySlug, [req.params.slug])
  if (!room) return res.status(404).json({ error: '존재하지 않는 방입니다.' })
  const membership = await db.get(SQL.findMember, [room.id, req.user.id])
  if (!membership) return res.status(403).json({ error: '이 방에 접근할 권한이 없습니다.' })
  if (membership.role === 'invited') {
    return res.status(403).json({ error: '초대를 수락해야 입장할 수 있습니다.' })
  }
  req.room = room
  req.membership = membership
  next()
})

/** 초대 수락/거절용: invited 상태의 멤버십을 찾아 req.room / req.membership 세팅 */
const loadInvite = asyncRoute(async (req, res, next) => {
  const room = await db.get(SQL.findRoomBySlug, [req.params.slug])
  if (!room) return res.status(404).json({ error: '존재하지 않는 방입니다.' })
  const membership = await db.get(SQL.findMember, [room.id, req.user.id])
  if (!membership || membership.role !== 'invited') {
    return res.status(404).json({ error: '대기 중인 초대가 없습니다.' })
  }
  req.room = room
  req.membership = membership
  next()
})

// 초대 수락 → invited 를 member 로 승격
router.post(
  '/:slug/accept',
  loadInvite,
  asyncRoute(async (req, res) => {
    await db.run(SQL.updateMemberRole, ['member', Date.now(), req.room.id, req.user.id])
    return res.json({ ok: true, room: req.room })
  }),
)

// 초대 거절 → 멤버십 삭제
router.post(
  '/:slug/decline',
  loadInvite,
  asyncRoute(async (req, res) => {
    await db.run(SQL.deleteMember, [req.room.id, req.user.id])
    return res.json({ ok: true })
  }),
)

// 방 상세 (멤버 목록 포함)
router.get(
  '/:slug',
  loadRoomMembership,
  asyncRoute(async (req, res) => {
    res.json({
      room: req.room,
      role: req.membership.role,
      members: await listMembers(req.room.id),
    })
  }),
)

// 멤버 초대 (owner 만) — 아이디로 기존 사용자를 member 로 추가
router.post(
  '/:slug/members',
  loadRoomMembership,
  asyncRoute(async (req, res) => {
    if (req.membership.role !== 'owner') {
      return res.status(403).json({ error: '팀장(owner)만 초대할 수 있습니다.' })
    }
    const { username } = req.body ?? {}
    if (typeof username !== 'string' || !username.trim()) {
      return res.status(400).json({ error: '초대할 사용자의 아이디를 입력하세요.' })
    }

    const invitee = await db.get(SQL.findUserByUsername, [username])
    if (!invitee) {
      return res.status(404).json({ error: '해당 아이디의 가입된 사용자를 찾을 수 없습니다.' })
    }
    const existing = await db.get(SQL.findMember, [req.room.id, invitee.id])
    if (existing) {
      if (existing.role === 'invited') {
        return res.status(409).json({ error: '이미 초대한 사용자입니다. (수락 대기 중)' })
      }
      return res.status(409).json({ error: '이미 방에 속한 사용자입니다.' })
    }
    // 바로 멤버가 아니라 "초대 대기(invited)" 상태로 추가 → 당사자가 수락해야 입장 가능
    await db.run(SQL.insertMember, [req.room.id, invitee.id, 'invited', Date.now()])
    return res.status(201).json({ members: await listMembers(req.room.id) })
  }),
)

// 멤버 강퇴 (owner 만, owner 자신은 강퇴 불가)
router.delete(
  '/:slug/members/:userId',
  loadRoomMembership,
  asyncRoute(async (req, res) => {
    if (req.membership.role !== 'owner') {
      return res.status(403).json({ error: '팀장(owner)만 멤버를 내보낼 수 있습니다.' })
    }
    const targetId = Number(req.params.userId)
    if (!Number.isInteger(targetId)) {
      return res.status(400).json({ error: '내보낼 팀원을 선택하세요.' })
    }
    if (targetId === req.user.id) {
      return res.status(400).json({ error: '팀장은 자신을 내보낼 수 없습니다.' })
    }
    await db.tx(async (t) => {
      await t.run(SQL.deleteMember, [req.room.id, targetId])
      // 내보낸 사람의 이 보드용 개인 공간도 함께 정리 (나가기와 동일)
      await t.run(SQL.deletePersonalSpace, [targetId, req.room.slug])
    })
    return res.json({ members: await listMembers(req.room.id) })
  }),
)

// 팀장 위임 (owner 만) — 참여자(member) 중 한 명을 새 팀장으로, 나는 참여자가 된다.
router.post(
  '/:slug/transfer',
  loadRoomMembership,
  asyncRoute(async (req, res) => {
    if (req.membership.role !== 'owner') {
      return res.status(403).json({ error: '팀장(owner)만 위임할 수 있습니다.' })
    }
    const targetId = Number(req.body?.userId)
    if (!Number.isInteger(targetId) || targetId === req.user.id) {
      return res.status(400).json({ error: '팀장을 맡길 팀원을 선택하세요.' })
    }
    const target = await db.get(SQL.findMember, [req.room.id, targetId])
    if (!target || target.role !== 'member') {
      return res
        .status(400)
        .json({ error: '초대를 수락한 참여자에게만 팀장을 맡길 수 있습니다.' })
    }
    const now = Date.now()
    // 세 변경이 함께 성공하거나 함께 실패하도록 하나의 트랜잭션으로 처리
    await db.tx(async (t) => {
      await t.run(SQL.updateMemberRole, ['owner', target.joined_at, req.room.id, targetId])
      await t.run(SQL.updateMemberRole, ['member', req.membership.joined_at ?? now, req.room.id, req.user.id])
      await t.run('UPDATE rooms SET owner_id = ? WHERE id = ?', [targetId, req.room.id])
    })
    return res.json({ ok: true, role: 'member', members: await listMembers(req.room.id) })
  }),
)

// 보드에서 나가기 (참여자 본인). 팀장은 먼저 위임하거나 보드를 삭제해야 한다.
router.post(
  '/:slug/leave',
  loadRoomMembership,
  asyncRoute(async (req, res) => {
    if (req.membership.role === 'owner') {
      return res
        .status(400)
        .json({ error: '팀장은 나갈 수 없어요. 먼저 다른 팀원에게 팀장을 맡기거나 보드를 삭제하세요.' })
    }
    await db.tx(async (t) => {
      await t.run(SQL.deleteMember, [req.room.id, req.user.id])
      // 나간 사람의 개인 공간(이 보드용 개인 노트/파일)도 함께 정리
      await t.run(SQL.deletePersonalSpace, [req.user.id, req.room.slug])
    })
    return res.json({ ok: true })
  }),
)

// 방 삭제 (owner 만). CASCADE 로 멤버도 함께 삭제됨.
router.delete(
  '/:slug',
  loadRoomMembership,
  asyncRoute(async (req, res) => {
    if (req.membership.role !== 'owner') {
      return res.status(403).json({ error: '팀장(owner)만 방을 삭제할 수 있습니다.' })
    }
    // 보드·멤버·팀원들의 개인 공간·보드 내용(Yjs 문서 스냅샷)을 한 번에 지운다.
    await db.tx(async (t) => {
      await t.run('DELETE FROM rooms WHERE id = ?', [req.room.id])
      await t.run('DELETE FROM personal_spaces WHERE room_slug = ?', [req.room.slug])
      await t.run('DELETE FROM docs WHERE name = ?', [req.room.slug])
    })
    // 업로드된 사진/첨부 파일(저장소 + 기록). 실패해도 보드 삭제는 이미 끝났으므로 경고만 남긴다.
    try {
      await removeRoomFiles(req.room.slug)
    } catch (err) {
      console.warn('[api] 보드 파일 정리 중 경고:', err instanceof Error ? err.message : err)
    }
    return res.json({ ok: true })
  }),
)

export default router
