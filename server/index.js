/**
 * 실시간 협업용 y-websocket 서버 (+ SQLite 영속화).
 *
 * 클라이언트(y-websocket Provider)가 ws://localhost:1234 로 접속하면
 * 방(room) 단위로 Yjs 문서 변경 사항을 서로 중계(broadcast)한다.
 *
 * 영속화: 방별 Yjs 문서를 SQLite(board.db)에 저장하여
 *        서버를 재시작해도 보드 내용이 유지된다. (server/persistence.js)
 *
 * 실행: npm run server
 */
import { WebSocketServer } from 'ws'
import { setupWSConnection, setPersistence } from 'y-websocket/bin/utils'
import { persistence, closeDb } from './persistence.js'

const host = process.env.HOST || '0.0.0.0'
const port = Number(process.env.PORT) || 1234

// Yjs 문서 영속화 핸들러 등록 (방 로드 시 복원 / 변경 시 SQLite 저장)
setPersistence(persistence)

const wss = new WebSocketServer({ host, port })

wss.on('connection', (conn, req) => {
  setupWSConnection(conn, req)
})

wss.on('listening', () => {
  console.log(`[y-websocket] 실시간 협업 서버 실행 중 → ws://localhost:${port}`)
  console.log(`[y-websocket] 영속화: SQLite (${process.env.DB_PATH || 'board.db'})`)
})

wss.on('error', (err) => {
  console.error('[y-websocket] 서버 오류:', err)
})

// 종료 시 DB 안전하게 닫기
function shutdown() {
  console.log('\n[y-websocket] 서버 종료 중...')
  wss.close(() => {
    closeDb()
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
