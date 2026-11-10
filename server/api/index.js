/**
 * 방/권한 관리 REST API 서버 실행 진입점.
 *
 * 실시간 동기화 서버(y-websocket, 포트 1234)와 별개로 동작한다.
 * 라우트 구성은 server/api/app.js 에 있다.
 *
 * 실행: npm run api   (기본 포트 3001)
 */
import { createApp } from './app.js'

const port = Number(process.env.API_PORT) || 3001

createApp().listen(port, () => {
  console.log(`[api] 방/권한 관리 API 서버 실행 중 → http://localhost:${port}`)
})
