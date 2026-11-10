/**
 * 방/권한 관리 REST API 앱 (포트를 열지 않는 Express 앱).
 *
 * 실제 실행(server/api/index.js)과 자동 테스트(tests/)가 같은 앱을 쓰도록 분리했다.
 * DB 파일 위치는 import 시점의 DB_PATH 환경변수로 정해진다. (server/config.js)
 *
 *  - 인증(회원가입/로그인):  /api/auth/*
 *  - 방 관리:               /api/rooms/*
 *  - 개인 공간:             /api/personal/*
 *  - 보드 파일(사진/첨부):   /api/files/*
 */
import express from 'express'
import cors from 'cors'
import authRouter from './auth.js'
import roomsRouter from './rooms.js'
import personalRouter from './personal.js'
import filesRouter from './files.js'

export function createApp() {
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

  return app
}
