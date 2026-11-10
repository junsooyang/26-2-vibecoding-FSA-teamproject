/**
 * 방/권한 관리 REST API 서버.
 *
 * 실시간 동기화 서버(y-websocket, 포트 1234)와 별개로 동작한다.
 *  - 인증(회원가입/로그인):  /api/auth/*
 *  - 방 관리:               /api/rooms/*
 *
 * 실행: npm run api   (기본 포트 3001)
 */
import express from 'express'
import cors from 'cors'
import authRouter from './auth.js'
import roomsRouter from './rooms.js'
import personalRouter from './personal.js'
import filesRouter from './files.js'

const port = Number(process.env.API_PORT) || 3001

const app = express()
app.use(cors())
// 개인 공간 파일(data URL)이 커질 수 있으므로 바디 크기 제한을 넉넉히 둔다.
app.use(express.json({ limit: '20mb' }))

app.get('/api/health', (_req, res) => res.json({ ok: true }))
app.use('/api/auth', authRouter)
app.use('/api/rooms', roomsRouter)
app.use('/api/personal', personalRouter)
app.use('/api/files', filesRouter)

// JSON 파싱 오류 등 공통 에러 핸들러
app.use((err, _req, res, _next) => {
  console.error('[api] 오류:', err)
  res.status(err.status || 500).json({ error: err.message || '서버 오류' })
})

app.listen(port, () => {
  console.log(`[api] 방/권한 관리 API 서버 실행 중 → http://localhost:${port}`)
})
