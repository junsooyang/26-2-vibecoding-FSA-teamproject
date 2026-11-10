/**
 * 실시간 협업용 y-websocket 서버 (+ SQLite 영속화 + 접근 제어).
 *
 * 클라이언트(y-websocket Provider)가 ws://localhost:1234/<보드 slug>?token=<JWT> 로 접속하면
 * 방(room) 단위로 Yjs 문서 변경 사항을 서로 중계(broadcast)한다.
 *
 * 접근 제어:
 *  - 연결 시(HTTP upgrade 단계) JWT 를 검증하고, 그 사용자가 해당 보드의 멤버(owner/member)인지
 *    DB 로 확인한다. 통과하지 못하면 WebSocket 연결 자체를 거절한다. (초대 대기 invited 는 불가)
 *  - 연결된 뒤에도 2초마다 멤버십을 다시 확인한다.
 *      · 보드가 삭제됨        → 닫힘 코드 4404 로 연결 종료
 *      · 멤버에서 제외됨(강퇴) → 닫힘 코드 4403 으로 연결 종료
 *    클라이언트는 이 코드를 보고 안내 후 보드 목록으로 돌아간다.
 *
 * 영속화: 방별 Yjs 문서를 SQLite(board.db)에 저장하여
 *        서버를 재시작해도 보드 내용이 유지된다. (server/persistence.js)
 *
 * 실행: npm run server
 */
import http from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { WebSocketServer } from 'ws'
import jwt from 'jsonwebtoken'
import { setupWSConnection, setPersistence } from 'y-websocket/bin/utils'
import { persistence, closeDb } from './persistence.js'
import { JWT_SECRET, DB_PATH } from './config.js'

const host = process.env.HOST || '0.0.0.0'
const port = Number(process.env.PORT) || 1234

/** 닫힘 코드 (4000번대는 애플리케이션 용도로 예약된 영역) */
export const CLOSE_ROOM_DELETED = 4404
export const CLOSE_FORBIDDEN = 4403

// Yjs 문서 영속화 핸들러 등록 (방 로드 시 복원 / 변경 시 SQLite 저장)
setPersistence(persistence)

// 멤버십 확인용 읽기 전용 DB 연결 (rooms / room_members 는 API 서버가 만든다)
const authDb = new DatabaseSync(DB_PATH)
const roomExistsStmt = () => authDb.prepare('SELECT 1 AS ok FROM rooms WHERE slug = ?')
const memberRoleStmt = () =>
  authDb.prepare(
    `SELECT m.role AS role
       FROM room_members m
       JOIN rooms r ON r.id = m.room_id
      WHERE r.slug = ? AND m.user_id = ?`,
  )

/**
 * 사용자의 보드 접근 상태를 판정한다.
 * 반환: 'ok' | 'deleted'(보드 없음) | 'forbidden'(멤버 아님/초대 대기)
 * DB 조회에 실패하면 안전하게 'forbidden'(접근 거부) 쪽으로 처리한다.
 */
function checkAccess(slug, userId) {
  try {
    if (!roomExistsStmt().get(slug)) return 'deleted'
    const row = memberRoleStmt().get(slug, userId)
    if (!row || row.role === 'invited') return 'forbidden'
    return 'ok'
  } catch (err) {
    console.error('[y-websocket] 멤버십 확인 실패:', err instanceof Error ? err.message : err)
    return 'forbidden'
  }
}

/** 요청 URL(/<slug>?token=...) 에서 보드 slug 와 토큰을 꺼낸다. */
function parseRequest(req) {
  const url = new URL(req.url || '/', 'http://localhost')
  const slug = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
  const token = url.searchParams.get('token')
  return { slug, token }
}

function rejectUpgrade(socket, status, message) {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`)
  socket.destroy()
}

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('y-websocket 실시간 협업 서버')
})

const wss = new WebSocketServer({ noServer: true })

/** 연결 중인 클라이언트: 주기적 멤버십 재확인용 */
const sessions = new Map() // ws -> { slug, userId }

server.on('upgrade', (req, socket, head) => {
  const { slug, token } = parseRequest(req)
  if (!slug || !token) return rejectUpgrade(socket, 401, 'Unauthorized')

  let userId
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    userId = payload.sub
  } catch {
    return rejectUpgrade(socket, 401, 'Unauthorized')
  }

  const access = checkAccess(slug, userId)
  if (access === 'deleted') return rejectUpgrade(socket, 404, 'Not Found')
  if (access !== 'ok') return rejectUpgrade(socket, 403, 'Forbidden')

  wss.handleUpgrade(req, socket, head, (ws) => {
    sessions.set(ws, { slug, userId })
    ws.on('close', () => sessions.delete(ws))
    // docName 을 명시해서 URL 파싱 방식에 의존하지 않는다.
    setupWSConnection(ws, req, { docName: slug })
  })
})

// 연결된 뒤 보드가 삭제되거나 멤버에서 제외되면 연결을 끊는다.
const recheckTimer = setInterval(() => {
  for (const [ws, { slug, userId }] of sessions) {
    const access = checkAccess(slug, userId)
    if (access === 'ok') continue
    sessions.delete(ws)
    ws.close(access === 'deleted' ? CLOSE_ROOM_DELETED : CLOSE_FORBIDDEN, access)
  }
}, 2000)

server.listen(port, host, () => {
  console.log(`[y-websocket] 실시간 협업 서버 실행 중 → ws://localhost:${port}`)
  console.log(`[y-websocket] 영속화: SQLite (${DB_PATH}), 접속 시 JWT + 멤버십 검사`)
})

server.on('error', (err) => {
  console.error('[y-websocket] 서버 오류:', err)
})

// 종료 시 DB 안전하게 닫기
function shutdown() {
  console.log('\n[y-websocket] 서버 종료 중...')
  clearInterval(recheckTimer)
  wss.close(() => {
    server.close()
    closeDb()
    try {
      authDb.close()
    } catch {
      // ignore
    }
    process.exit(0)
  })
  // 안전장치: 3초 내 못 닫으면 강제 종료
  setTimeout(() => {
    closeDb()
    process.exit(0)
  }, 3000)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
