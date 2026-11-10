/**
 * 인증: 회원가입 / 로그인 + JWT 발급·검증 미들웨어.
 * 로그인 식별자는 아이디(username)를 사용한다.
 */
import express from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import db from './db.js'

import { JWT_SECRET } from '../config.js'

const TOKEN_TTL = '7d'

// 아이디 형식: 영문/숫자/밑줄(_), 3~20자
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/

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
    const payload = jwt.verify(token, JWT_SECRET)
    req.user = { id: payload.sub, username: payload.username, name: payload.name }
    next()
  } catch {
    return res.status(401).json({ error: '유효하지 않거나 만료된 토큰입니다.' })
  }
}

const router = express.Router()

const insertUser = db.prepare(
  'INSERT INTO users (username, name, password_hash, created_at) VALUES (?, ?, ?, ?)',
)
const findByUsername = db.prepare('SELECT * FROM users WHERE username = ?')

// 회원가입
router.post('/register', async (req, res) => {
  const { username, name, password } = req.body ?? {}
  if (!username || !name || !password) {
    return res.status(400).json({ error: '아이디, 이름, 비밀번호는 필수입니다.' })
  }
  if (!USERNAME_RE.test(String(username))) {
    return res
      .status(400)
      .json({ error: '아이디는 영문/숫자/밑줄(_) 3~20자여야 합니다.' })
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: '비밀번호는 6자 이상이어야 합니다.' })
  }
  if (findByUsername.get(username)) {
    return res.status(409).json({ error: '이미 사용 중인 아이디입니다.' })
  }

  const hash = await bcrypt.hash(String(password), 10)
  const info = insertUser.run(username, name, hash, Date.now())
  const user = { id: Number(info.lastInsertRowid), username, name }
  return res.status(201).json({ token: signToken(user), user })
})

// 로그인
router.post('/login', async (req, res) => {
  const { username, password } = req.body ?? {}
  if (!username || !password) {
    return res.status(400).json({ error: '아이디와 비밀번호를 입력하세요.' })
  }
  const row = findByUsername.get(username)
  if (!row) return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' })

  const ok = await bcrypt.compare(String(password), row.password_hash)
  if (!ok) return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' })

  const user = { id: row.id, username: row.username, name: row.name }
  return res.json({ token: signToken(user), user })
})

// 현재 로그인 사용자 정보
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user })
})

export default router
