/**
 * API(Express) 와 실시간 서버(y-websocket) 를 "한 HTTP 서버, 한 포트" 로 묶는다.
 *
 * 배포 서비스(Render 등)는 보통 포트를 하나만 열어 주고, Yjs 문서는 메모리에 있으므로
 * 두 서버를 한 프로세스로 실행하는 것이 맞다. (DB 연결도 하나를 함께 쓴다)
 *
 *  - 일반 HTTP 요청        → Express  (/api/...)
 *  - WebSocket 업그레이드  → 실시간 서버 (/ws/<slug>?token=..., 예전 형식 /<slug> 도 허용)
 *
 * 포트를 여는 것은 호출부(server/start.js 또는 자동 테스트)가 한다.
 */
import http from 'node:http'
import { createApp } from './api/app.js'
import { createRealtimeServer } from './realtime.js'

/**
 * @param {{ recheckMs?: number, maxPayload?: number }} [options] 실시간 서버 옵션
 */
export function createCombinedServer(options = {}) {
  const app = createApp()
  const server = http.createServer(app)
  const realtime = createRealtimeServer({ ...options, server })

  /** 실시간 연결·DB 를 정리한 뒤 HTTP 서버를 닫는다. */
  async function close() {
    await realtime.close()
    await new Promise((resolve) => {
      server.close(() => resolve())
      // 남아 있는 keep-alive 연결 때문에 닫기가 늦어지지 않게 한다.
      server.closeAllConnections?.()
    })
  }

  return { server, app, wss: realtime.wss, close }
}
