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
import authRouter, { requireAuth } from './auth.js'
import roomsRouter from './rooms.js'
import personalRouter from './personal.js'
import filesRouter from './files.js'
import aiRouter from './ai.js'

/**
 * CORS 허용 출처. CORS_ORIGIN 에 쉼표로 적으면 그 출처만 허용한다.
 * 비워 두면 개발 편의를 위해 모든 출처를 허용한다. (인증은 쿠키가 아닌 Bearer 토큰이라 CSRF 위험은 없음)
 */
function corsOptions() {
  const list = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return list.length ? { origin: list } : {}
}

/**
 * 프록시 신뢰 설정 (TRUST_PROXY).
 *
 * 배포 서비스는 앞단 프록시를 거쳐 요청을 넘기므로, 설정하지 않으면 모든 요청의 IP 가 프록시 IP 로 보인다.
 * 그러면 로그인 실패 제한(IP + 아이디)이 IP 를 구분하지 못해, 누구나 남의 아이디를 10번 틀려 잠글 수 있다.
 *
 *  - 비움(기본) : 믿지 않음. 프록시 없이 직접 받는 로컬 개발용. X-Forwarded-For 를 무시한다.
 *  - 숫자 N     : 앞단 프록시 N 단계를 믿는다. Render 는 3 (Cloudflare + 내부 프록시, 실측).
 *                 서비스마다 다르니 DEBUG_IP_ECHO=1 로 확인한다. 너무 작으면 프록시 IP 가 사용자 IP 로 잡힌다.
 *  - 그 밖      : Express 형식 그대로 (예: loopback, 10.0.0.0/8 처럼 쉼표로 여러 개)
 *  - true       : 모든 프록시를 믿음. X-Forwarded-For 를 누구나 꾸밀 수 있어 위험하므로 권하지 않는다.
 */
export function trustProxySetting(raw = process.env.TRUST_PROXY) {
  const v = String(raw ?? '').trim()
  if (!v || v === 'false' || v === '0') return false
  if (/^\d+$/.test(v)) return Number(v)
  if (v === 'true') {
    console.warn('[api] TRUST_PROXY=true 는 IP 위조에 취약해요. 프록시 단계 수(예: 1)를 쓰세요.')
    return true
  }
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', trustProxySetting())
  app.use(cors(corsOptions()))
  // 기본 보안 헤더 (API 응답용)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'no-referrer')
    next()
  })
  // 개인 공간 파일(data URL)은 커질 수 있어 이 경로만 큰 본문을 허용하고, 로그인한 사용자만 보낼 수 있게 한다.
  app.use('/api/personal', requireAuth, express.json({ limit: '20mb' }))
  // 그 밖의 JSON 요청은 작게 제한한다.
  app.use(express.json({ limit: '1mb' }))

  app.get('/api/health', (_req, res) => res.json({ ok: true }))

  // 배포 진단용 (DEBUG_IP_ECHO=1 일 때만): 서버가 판단한 "요청한 사람의 IP" 를 그 사람에게 돌려준다.
  // TRUST_PROXY 값이 맞는지(프록시 IP 가 아니라 실제 사용자 IP 로 보이는지) 확인할 때만 잠깐 켠다.
  if (process.env.DEBUG_IP_ECHO === '1') {
    app.get('/api/debug/ip', (req, res) => {
      const xff = String(req.headers['x-forwarded-for'] || '')
      res.json({
        ip: req.ip,
        trustProxy: app.get('trust proxy'),
        forwardedHops: xff ? xff.split(',').length : 0,
      })
    })
  }
  app.use('/api/auth', authRouter)
  app.use('/api/rooms', roomsRouter)
  app.use('/api/personal', personalRouter)
  app.use('/api/files', filesRouter)
  app.use('/api/ai', aiRouter)

  // JSON 파싱 오류 등 공통 에러 핸들러
  // 내부 오류 문구(DB·파서 메시지 등)는 사용자에게 보내지 않는다.
  app.use((err, _req, res, _next) => {
    const status = Number(err.status || err.statusCode) || 500
    if (status >= 500) console.error('[api] 오류:', err)
    let message = '서버 오류가 발생했습니다.'
    if (status === 413) message = '요청이 너무 큽니다.'
    else if (status >= 400 && status < 500) message = '잘못된 요청입니다.'
    if (!res.headersSent) res.status(status).json({ error: message })
  })

  return app
}
