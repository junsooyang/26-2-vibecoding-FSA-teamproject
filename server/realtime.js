/**
 * 실시간 협업용 y-websocket 서버 (+ SQLite 영속화 + 접근 제어) 를 만든다.
 * 포트를 여는 것은 호출부(server/index.js 또는 자동 테스트)가 한다.
 *
 * 클라이언트(y-websocket Provider)가 ws://<host>/<보드 slug>?token=<JWT> 로 접속하면
 * 방(room) 단위로 Yjs 문서 변경 사항을 서로 중계(broadcast)한다.
 *
 * 접근 제어:
 *  - 연결 시(HTTP upgrade 단계) JWT 를 검증하고, 그 사용자가 해당 보드의 멤버(owner/member)인지
 *    DB 로 확인한다. 통과하지 못하면 WebSocket 연결 자체를 거절한다. (초대 대기 invited 는 불가)
 *      · 토큰 없음/위조 401, 멤버 아님/초대 대기 403, 없는 보드 404
 *  - 연결된 뒤에도 주기적으로(기본 2초) 멤버십을 다시 확인한다.
 *      · 보드가 삭제됨        → 닫힘 코드 4404 로 연결 종료
 *      · 멤버에서 제외됨/나감  → 닫힘 코드 4403 으로 연결 종료
 *    클라이언트는 이 코드를 보고 안내 후 보드 목록으로 돌아간다.
 *
 * 영속화: 방별 Yjs 문서를 SQLite 에 저장하여 서버를 재시작해도 보드 내용이 유지된다. (persistence.js)
 */
import http from 'node:http'
import { WebSocketServer } from 'ws'
import jwt from 'jsonwebtoken'
import { setupWSConnection, setPersistence } from 'y-websocket/bin/utils'
import { persistence, flushPendingWrites } from './persistence.js'
import { db } from './db.js'
import { JWT_SECRET, WS_MAX_PAYLOAD } from './config.js'

/** 닫힘 코드 (4000번대는 애플리케이션 용도로 예약된 영역) */
export const CLOSE_ROOM_DELETED = 4404
export const CLOSE_FORBIDDEN = 4403

/**
 * 요청 URL(/<slug>?token=... 또는 /ws/<slug>?token=...) 에서 보드 slug 와 토큰을 꺼낸다.
 * /ws/ 접두사는 API 와 한 포트로 합쳐 실행할 때(server/start.js) 주소를 알아보기 쉽게 쓰는 용도다.
 * slug 에는 '/' 가 들어갈 수 없으므로 두 형식이 헷갈리지 않는다.
 */
function parseRequest(req) {
  const url = new URL(req.url || '/', 'http://localhost')
  let slug = ''
  try {
    slug = decodeURIComponent(url.pathname.replace(/^\/+/, '').replace(/^ws\//, ''))
  } catch {
    slug = ''
  }
  return { slug, token: url.searchParams.get('token') }
}

function rejectUpgrade(socket, status, message) {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`)
  socket.destroy()
}

/**
 * @param {{ recheckMs?: number, maxPayload?: number, server?: import('node:http').Server }} [options]
 *   recheckMs: 연결된 사용자의 멤버십을 다시 확인하는 간격 (기본 2000ms)
 *   maxPayload: 메시지 하나의 최대 바이트 (기본 WS_MAX_PAYLOAD_MB, 16MB)
 *   server: 이미 있는 HTTP 서버(예: Express API)에 붙인다. 없으면 실시간 전용 서버를 새로 만든다.
 *           붙인 경우 close() 는 그 서버를 닫지 않는다(만든 쪽이 닫는다).
 */
export function createRealtimeServer(options = {}) {
  const recheckMs = options.recheckMs ?? 2000
  const maxPayload = options.maxPayload ?? WS_MAX_PAYLOAD

  // Yjs 문서 영속화 핸들러 등록 (방 로드 시 복원 / 변경 시 DB 저장)
  setPersistence(persistence)

  /**
   * 사용자의 보드 접근 상태를 판정한다. (API 서버와 같은 DB — server/db.js)
   * 반환: 'ok' | 'deleted'(보드 없음) | 'forbidden'(멤버 아님/초대 대기) | 'error'(DB 조회 실패)
   */
  async function checkAccess(slug, userId) {
    try {
      if (!(await db.get('SELECT 1 AS ok FROM rooms WHERE slug = ?', [slug]))) return 'deleted'
      const row = await db.get(
        `SELECT m.role AS role
           FROM room_members m
           JOIN rooms r ON r.id = m.room_id
          WHERE r.slug = ? AND m.user_id = ?`,
        [slug, userId],
      )
      if (!row || row.role === 'invited') return 'forbidden'
      return 'ok'
    } catch (err) {
      console.error('[y-websocket] 멤버십 확인 실패:', err instanceof Error ? err.message : err)
      return 'error'
    }
  }

  const ownsServer = !options.server
  const server =
    options.server ??
    http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('y-websocket 실시간 협업 서버')
    })

  // 메시지 하나의 최대 크기. 넘으면 ws 가 연결을 끊는다(1009). 기본값(100MB)은 메모리 고갈에 취약하다.
  const wss = new WebSocketServer({ noServer: true, maxPayload })

  /** 연결 중인 클라이언트: 주기적 멤버십 재확인용 */
  const sessions = new Map() // ws -> { slug, userId }

  server.on('upgrade', (req, socket, head) => {
    const { slug, token } = parseRequest(req)
    if (!slug || !token) return rejectUpgrade(socket, 401, 'Unauthorized')

    let userId
    try {
      userId = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }).sub
    } catch {
      return rejectUpgrade(socket, 401, 'Unauthorized')
    }

    // DB 를 기다리는 동안 소켓이 끊기면 조용히 정리한다 (처리기가 없으면 오류로 프로세스가 죽을 수 있음)
    socket.on('error', () => socket.destroy())
    checkAccess(slug, userId).then((access) => {
      if (socket.destroyed) return
      if (access === 'deleted') return rejectUpgrade(socket, 404, 'Not Found')
      // DB 를 확인하지 못하면 들여보내지 않는다 (fail closed)
      if (access === 'error') return rejectUpgrade(socket, 503, 'Service Unavailable')
      if (access !== 'ok') return rejectUpgrade(socket, 403, 'Forbidden')
      accept(req, socket, head, slug, userId)
    })
  })

  function accept(req, socket, head, slug, userId) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      sessions.set(ws, { slug, userId })
      ws.on('close', () => sessions.delete(ws))
      // 너무 큰 메시지·깨진 프레임이면 ws 가 'error' 를 낸다. 처리기가 없으면 서버 프로세스가 죽으므로
      // 그 연결만 끊고 서버는 계속 동작하게 한다. (ws 가 닫힘 코드 1009/1002 등으로 연결을 닫는다)
      ws.on('error', (err) => {
        console.warn(`[y-websocket] 연결 오류로 종료 (${slug}):`, err instanceof Error ? err.message : err)
        sessions.delete(ws)
      })
      // docName 을 명시해서 URL 파싱 방식에 의존하지 않는다.
      setupWSConnection(ws, req, { docName: slug })
    })
  }

  // 연결된 뒤 보드가 삭제되거나 멤버에서 제외되면 연결을 끊는다.
  // DB 가 잠깐 응답하지 않으면('error') 다들 끊지 않고 다음 확인 때 다시 본다.
  let rechecking = false
  const recheckTimer = setInterval(async () => {
    if (rechecking || sessions.size === 0) return
    rechecking = true
    try {
      // 같은 (보드, 사용자) 는 한 번만 조회한다
      const results = new Map()
      for (const { slug, userId } of sessions.values()) {
        const key = `${slug}\u0000${userId}`
        if (!results.has(key)) results.set(key, checkAccess(slug, userId))
      }
      for (const [ws, { slug, userId }] of [...sessions]) {
        const access = await results.get(`${slug}\u0000${userId}`)
        if (access === 'ok' || access === 'error' || !sessions.has(ws)) continue
        sessions.delete(ws)
        ws.close(access === 'deleted' ? CLOSE_ROOM_DELETED : CLOSE_FORBIDDEN, access)
      }
    } finally {
      rechecking = false
    }
  }, recheckMs)

  /** 연결을 끊고, 마지막 저장이 끝나면 DB 를 닫는다. */
  function close() {
    clearInterval(recheckTimer)
    return new Promise((resolve) => {
      for (const ws of wss.clients) ws.terminate()
      const finish = async () => {
        await flushPendingWrites()
        await db.close()
        resolve()
      }
      wss.close(() => {
        if (ownsServer) server.close(() => finish())
        else finish()
      })
    })
  }

  return { server, wss, close }
}
