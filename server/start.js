/**
 * 배포용 실행 진입점: API + 실시간 서버를 한 포트로 실행한다.
 *
 * 실행: npm start   (포트: PORT 환경변수, 없으면 3001)
 *   - API        : http(s)://<호스트>/api/...
 *   - 실시간 연결 : ws(s)://<호스트>/ws   ← 프론트의 VITE_WS_URL 에 이 주소를 넣는다
 *
 * 개발할 때는 지금처럼 npm run api(3001) + npm run server(1234) 로 따로 띄워도 된다.
 * 단, 두 방식을 동시에 같은 포트로 띄우면 충돌하므로 하나만 쓴다.
 */
import { createCombinedServer } from './combined.js'
import { prepareServer } from './boot.js'

const host = process.env.HOST || '0.0.0.0'
const port = Number(process.env.PORT) || 3001

await prepareServer('start')

const combined = createCombinedServer()

combined.server.listen(port, host, () => {
  console.log(`[start] API + 실시간 서버 실행 중 (포트 ${port})`)
  console.log(`[start]   API        → http://localhost:${port}/api`)
  console.log(`[start]   실시간 연결 → ws://localhost:${port}/ws`)
})

combined.server.on('error', (err) => {
  console.error('[start] 서버 오류:', err)
  process.exit(1)
})

// 종료 신호를 받으면 보드 내용을 저장하고 DB 를 닫은 뒤 끝낸다. (Render 는 재배포 때 SIGTERM 을 보낸다)
let stopping = false
function shutdown() {
  if (stopping) return
  stopping = true
  console.log('\n[start] 서버 종료 중...')
  combined.close().then(() => process.exit(0))
  // 안전장치: 10초 안에 못 닫으면 강제 종료
  setTimeout(() => process.exit(0), 10_000).unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
