/**
 * 보드 파일(사진/첨부) 저장 API.
 *
 * 예전에는 파일을 base64(data URL)로 보드 문서(Yjs)에 그대로 넣었다. 그러면 문서가 커져서
 * 새로 접속할 때마다 전부 내려받고 DB 도 빠르게 불어난다. 이제 파일 본문은 서버 디스크에 두고
 * 문서에는 짧은 참조 문자열(fsafile:<slug>/<id>)만 저장한다.
 *
 *  POST /api/files/:slug?kind=image|file   파일 업로드 (본문 = 원본 바이트)
 *  GET  /api/files/:slug/:id               파일 내려받기
 *
 * 두 라우트 모두 JWT 인증 + 해당 보드의 멤버(owner/member)만 가능하다. (초대 대기 invited 불가)
 *
 * 업로드 요청 규약 (multer 같은 추가 의존성 없이 raw body 로 받는다)
 *  - Content-Type: application/octet-stream  (JSON 으로 오해되어 파싱되는 것을 막기 위함)
 *  - X-File-Name: encodeURIComponent(원래 파일명)
 *  - X-File-Type: 원래 MIME 타입
 */
import express from 'express'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import db from './db.js'
import { requireAuth } from './auth.js'

const router = express.Router()

/** 업로드 파일이 저장되는 폴더 (환경변수 UPLOAD_DIR 로 변경 가능) */
export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || 'uploads')

const MAX_FILE_BYTES = 10 * 1024 * 1024 // 첨부 파일 최대 10MB
const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // 사진 최대 5MB

/**
 * 사진으로 인정하는 형식. SVG 는 스크립트를 담을 수 있어 제외한다.
 * 이 목록에 없는 형식은 내려줄 때 항상 다운로드용(octet-stream)으로만 응답한다.
 */
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const findRoomBySlug = db.prepare('SELECT * FROM rooms WHERE slug = ?')
const findMember = db.prepare('SELECT * FROM room_members WHERE room_id = ? AND user_id = ?')
const insertFile = db.prepare(
  `INSERT INTO files (id, room_slug, name, mime, size, uploader_id, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
)
const findFile = db.prepare('SELECT * FROM files WHERE id = ? AND room_slug = ?')
const deleteFilesByRoom = db.prepare('DELETE FROM files WHERE room_slug = ?')

/** 보드 삭제 시 호출: 해당 보드의 파일 기록과 디스크 폴더를 함께 지운다. */
export function removeRoomFiles(slug) {
  deleteFilesByRoom.run(slug)
  const dir = path.join(UPLOAD_DIR, slug)
  // slug 가 UPLOAD_DIR 밖을 가리키지 않는지 방어적으로 확인
  if (path.dirname(dir) === UPLOAD_DIR) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/** 로그인한 사용자가 이 보드의 멤버(초대 대기 제외)인지 확인하고 req.room 을 채운다. */
function requireRoomMember(req, res, next) {
  const room = findRoomBySlug.get(req.params.slug)
  if (!room) return res.status(404).json({ error: '존재하지 않는 방입니다.' })
  const membership = findMember.get(room.id, req.user.id)
  if (!membership || membership.role === 'invited') {
    return res.status(403).json({ error: '이 방에 접근할 권한이 없습니다.' })
  }
  req.room = room
  next()
}

router.use(requireAuth)

/** 파일명에서 경로 문자·제어문자를 제거하고 길이를 제한한다. */
function safeFileName(raw) {
  let name = 'file'
  try {
    name = decodeURIComponent(raw || 'file')
  } catch {
    // 잘못된 인코딩이면 기본 이름 사용
  }
  name = path.basename(name.replace(/\\/g, '/')).replace(/[\u0000-\u001f]/g, '').trim()
  return (name || 'file').slice(0, 200)
}

// 업로드: 인증/멤버십 확인 후에 본문을 받는다.
router.post(
  '/:slug',
  requireRoomMember,
  express.raw({ type: () => true, limit: MAX_FILE_BYTES }),
  (req, res) => {
    const body = req.body
    if (!Buffer.isBuffer(body) || body.length === 0) {
      return res.status(400).json({ error: '업로드할 파일이 비어 있습니다.' })
    }

    const kind = req.query.kind === 'image' ? 'image' : 'file'
    const mime = String(req.get('x-file-type') || 'application/octet-stream')
      .toLowerCase()
      .slice(0, 100)
    const name = safeFileName(req.get('x-file-name'))

    if (kind === 'image') {
      if (!IMAGE_MIMES.has(mime)) {
        return res.status(400).json({ error: 'PNG, JPG, GIF, WEBP 이미지만 올릴 수 있어요.' })
      }
      if (body.length > MAX_IMAGE_BYTES) {
        return res.status(413).json({ error: '이미지가 너무 큽니다. 최대 5MB까지 가능합니다.' })
      }
    }

    const id = crypto.randomUUID()
    const dir = path.join(UPLOAD_DIR, req.room.slug)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, id), body)
    insertFile.run(id, req.room.slug, name, mime, body.length, req.user.id, Date.now())

    res.status(201).json({
      file: {
        id,
        name,
        mime,
        size: body.length,
        // 보드 문서에 저장할 참조 문자열
        ref: `fsafile:${req.room.slug}/${id}`,
      },
    })
  },
)

// 내려받기
router.get('/:slug/:id', requireRoomMember, (req, res) => {
  if (!ID_RE.test(req.params.id)) return res.status(404).json({ error: '파일을 찾을 수 없습니다.' })
  const row = findFile.get(req.params.id, req.room.slug)
  const abs = path.join(UPLOAD_DIR, req.room.slug, req.params.id)
  if (!row || !fs.existsSync(abs)) return res.status(404).json({ error: '파일을 찾을 수 없습니다.' })

  const isImage = IMAGE_MIMES.has(row.mime)
  res.setHeader('Content-Type', isImage ? row.mime : 'application/octet-stream')
  res.setHeader('Content-Length', String(row.size))
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Cache-Control', 'private, max-age=86400')
  res.setHeader(
    'Content-Disposition',
    `${isImage ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
  )

  const stream = fs.createReadStream(abs)
  stream.on('error', () => {
    if (!res.headersSent) res.status(500).json({ error: '파일을 읽지 못했습니다.' })
    else res.destroy()
  })
  stream.pipe(res)
})

export default router
