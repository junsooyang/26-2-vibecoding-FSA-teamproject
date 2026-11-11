/**
 * 인증: 회원가입 / 로그인 + JWT 발급·검증 미들웨어.
 * 로그인 식별자는 아이디(username)를 사용한다.
 */
import express from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { db } from '../db.js'

import { JWT_SECRET } from '../config.js'

const TOKEN_TTL = '7d'

// 아이디 형식: 영문/숫자/밑줄(_), 3~20자
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/
const NAME_MAX = 30
const PASSWORD_MIN = 6
// bcrypt 는 72바이트 뒤를 무시하므로, 그보다 긴 비밀번호는 받지 않는다.
const PASSWORD_MAX_BYTES = 72

// 서명 알고리즘을 고정해 다른 알고리즘으로 위조된 토큰을 거절한다.
export const JWT_VERIFY_OPTIONS = { algorithms: ['HS256'] }

// 로그인 실패 제한: 같은 IP + 아이디로 10분에 10번 실패하면 잠시 막는다 (메모리 보관).
const LOGIN_WINDOW_MS = 10 * 60 * 1000
const LOGIN_MAX_FAILS = 10
const loginFails = new Map() // key -> { count, first }

function loginKey(req, username) {
  return `${req.ip}|${String(username).toLowerCase()}`
}
function isLoginBlocked(key) {
  const rec = loginFails.get(key)
  if (!rec) return false
  if (Date.now() - rec.first > LOGIN_WINDOW_MS) {
    loginFails.delete(key)
    return false
  }
  return rec.count >= LOGIN_MAX_FAILS
}
function recordLoginFail(key) {
  const now = Date.now()
  const rec = loginFails.get(key)
  if (!rec || now - rec.first > LOGIN_WINDOW_MS) loginFails.set(key, { count: 1, first: now })
  else rec.count++
  // 오래된 기록이 쌓이지 않도록 가끔 정리
  if (loginFails.size > 10000) {
    for (const [k, v] of loginFails) if (now - v.first > LOGIN_WINDOW_MS) loginFails.delete(k)
  }
}

// 없는 아이디로 로그인해도 비밀번호 비교 시간을 들여, 응답 시간으로 아이디 존재 여부가 드러나지 않게 한다.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10)

/** async 라우트에서 난 오류를 Express 오류 처리기로 넘긴다 (처리 안 된 Promise 로 서버가 죽지 않게). */
export const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

export function signToken(user) {
  return jwt.sign({ sub: user.id, username: user.username, name: user.name }, JWT_SECRET, {
    expiresIn: TOKEN_TTL,
  })
}

/** Authorization: Bearer <token> 를 검증하고 req.user 를 채운다. */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ error: '인증이 필요합니다.' })
  try {
    const payload = jwt.verify(token, JWT_SECRET, JWT_VERIFY_OPTIONS)
    req.user = { id: payload.sub, username: payload.username, name: payload.name }
    next()
  } catch {
    return res.status(401).json({ error: '유효하지 않거나 만료된 토큰입니다.' })
  }
}

const router = express.Router()

// 같은 아이디로 동시에 가입해도 한 명만 성공하도록, 중복이면 아무 행도 돌려주지 않는다.
const insertUser = (username, name, hash) =>
  db.get(
    `INSERT INTO users (username, name, password_hash, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (username) DO NOTHING RETURNING id`,
    [username, name, hash, Date.now()],
  )
const findByUsername = (username) => db.get('SELECT * FROM users WHERE username = ?', [username])

// 회원가입
router.post(
  '/register',
  asyncRoute(async (req, res) => {
    const { username, name, password } = req.body ?? {}
    // 문자열이 아닌 값(배열·객체 등)은 처음부터 거절한다.
    if (typeof username !== 'string' || typeof name !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: '아이디, 이름, 비밀번호는 필수입니다.' })
    }
    const cleanName = name.trim()
    if (!username || !cleanName || !password) {
      return res.status(400).json({ error: '아이디, 이름, 비밀번호는 필수입니다.' })
    }
    if (!USERNAME_RE.test(username)) {
      return res
        .status(400)
        .json({ error: '아이디는 영문/숫자/밑줄(_) 3~20자여야 합니다.' })
    }
    if (cleanName.length > NAME_MAX) {
      return res.status(400).json({ error: `이름은 ${NAME_MAX}자 이하로 입력하세요.` })
    }
    if (password.length < PASSWORD_MIN) {
      return res.status(400).json({ error: `비밀번호는 ${PASSWORD_MIN}자 이상이어야 합니다.` })
    }
    if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
      return res.status(400).json({ error: '비밀번호가 너무 깁니다. (영문 기준 72자 이하)' })
    }
    if (await findByUsername(username)) {
      return res.status(409).json({ error: '이미 사용 중인 아이디입니다.' })
    }

    const hash = await bcrypt.hash(password, 10)
    const inserted = await insertUser(username, cleanName, hash)
    if (!inserted) return res.status(409).json({ error: '이미 사용 중인 아이디입니다.' })
    const user = { id: Number(inserted.id), username, name: cleanName }
    return res.status(201).json({ token: signToken(user), user })
  }),
)

// 로그인
router.post(
  '/login',
  asyncRoute(async (req, res) => {
    const { username, password } = req.body ?? {}
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      return res.status(400).json({ error: '아이디와 비밀번호를 입력하세요.' })
    }
    const key = loginKey(req, username)
    if (isLoginBlocked(key)) {
      return res
        .status(429)
        .json({ error: '로그인 시도가 너무 많아요. 10분 뒤에 다시 시도하세요.' })
    }
    const row = USERNAME_RE.test(username) ? await findByUsername(username) : undefined
    // 아이디가 없어도 같은 시간만큼 비교한다.
    const ok = await bcrypt.compare(
      Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES ? '' : password,
      row ? row.password_hash : DUMMY_HASH,
    )
    if (!row || !ok) {
      recordLoginFail(key)
      return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' })
    }
    loginFails.delete(key)

    const user = { id: row.id, username: row.username, name: row.name }
    return res.json({ token: signToken(user), user })
  }),
)

// 현재 로그인 사용자 정보
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user })
})

export default router
