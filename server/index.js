/**
 * 실시간 협업용 y-websocket 서버.
 *
 * 클라이언트(y-websocket Provider)가 ws://localhost:1234 로 접속하면
 * 방(room) 단위로 Yjs 문서 변경 사항을 서로 중계(broadcast)한다.
 *
 * 실행: npm run server
 */
import { WebSocketServer } from 'ws'
import { setupWSConnection } from 'y-websocket/bin/utils'

const host = process.env.HOST || '0.0.0.0'
const port = Number(process.env.PORT) || 1234

const wss = new WebSocketServer({ host, port })

wss.on('connection', (conn, req) => {
  setupWSConnection(conn, req)
})

wss.on('listening', () => {
  console.log(`[y-websocket] 실시간 협업 서버 실행 중 → ws://localhost:${port}`)
})

wss.on('error', (err) => {
  console.error('[y-websocket] 서버 오류:', err)
})
