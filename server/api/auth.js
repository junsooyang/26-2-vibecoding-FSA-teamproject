/**
 * 인증: 회원가입 / 로그인 + JWT 발급·검증 미들웨어.
 */
import express from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import db from './db.js'

// 운영에서는 반드시 환경변수로 주입할 것. (개발 편의용 기본값)
const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me'
const TOKEN_TTL = '7d'

export function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, name: user.name }, JWT_SECRET, {
    expiresIn: TOKEN_TTL,
  })
}

/** Authorization: Bearer <token> 를 검증하고 req.user 를 채운다. */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ error: '인증이 필요합니다.' })
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    req.user = { id: payload.sub, email: payload.email, name: payload.name }
    next()
  } catch {
    return res.status(401).json({ error: '유효하지 않거나 만료된 토큰입니다.' })
  }
}

const router = express.Router()

const insertUser = db.prepare(
  'INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)',
)
const findByEmail = db.prepare('SELECT * FROM users WHERE email = ?')

// 회원가입
router.post('/register', async (req, res) => {
  const { email, name, password } = req.body ?? {}
  if (!email || !name || !password) {
    return res.status(400).json({ error: '이메일, 이름, 비밀번호는 필수입니다.' })
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: '비밀번호는 6자 이상이어야 합니다.' })
  }
  if (findByEmail.get(email)) {
    return res.status(409).json({ error: '이미 가입된 이메일입니다.' })
  }

  const hash = await bcrypt.hash(String(password), 10)
  const info = insertUser.run(email, name, hash, Date.now())
  const user = { id: Number(info.lastInsertRowid), email, name }
  return res.status(201).json({ token: signToken(user), user })
})

// 로그인
router.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {}
  if (!email || !password) {
    return res.status(400).json({ error: '이메일과 비밀번호를 입력하세요.' })
  }
  const row = findByEmail.get(email)
  if (!row) return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' })

  const ok = await bcrypt.compare(String(password), row.password_hash)
  if (!ok) return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' })

  const user = { id: row.id, email: row.email, name: row.name }
  return res.json({ token: signToken(user), user })
})

// 현재 로그인 사용자 정보
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user })
})

export default router
