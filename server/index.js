/**
 * 실시간 협업 서버 실행 진입점.
 * 서버 구성(접근 제어, 영속화)은 server/realtime.js 에 있다.
 *
 * 실행: npm run server   (기본 포트 1234)
 */
import { createRealtimeServer } from './realtime.js'
import { DB_PATH } from './config.js'

const host = process.env.HOST || '0.0.0.0'
const port = Number(process.env.PORT) || 1234

const realtime = createRealtimeServer()

realtime.server.listen(port, host, () => {
  console.log(`[y-websocket] 실시간 협업 서버 실행 중 → ws://localhost:${port}`)
  console.log(`[y-websocket] 영속화: SQLite (${DB_PATH}), 접속 시 JWT + 멤버십 검사`)
})

realtime.server.on('error', (err) => {
  console.error('[y-websocket] 서버 오류:', err)
})

// 종료 시 DB 안전하게 닫기
function shutdown() {
  console.log('\n[y-websocket] 서버 종료 중...')
  realtime.close().then(() => process.exit(0))
  // 안전장치: 3초 내 못 닫으면 강제 종료
  setTimeout(() => process.exit(0), 3000)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
