/**
 * 방/권한 관리 REST API 서버 실행 진입점 (개발용으로 따로 띄울 때).
 *
 * 실시간 동기화 서버(y-websocket, 포트 1234)와 별개로 동작한다.
 * 라우트 구성은 server/api/app.js 에 있다. 배포 때는 npm start(한 포트)를 쓴다.
 *
 * 실행: npm run api   (기본 포트 3001)
 */
import { createApp } from './app.js'
import { prepareServer } from '../boot.js'

const port = Number(process.env.API_PORT) || 3001

await prepareServer('api')

createApp().listen(port, () => {
  console.log(`[api] 방/권한 관리 API 서버 실행 중 → http://localhost:${port}`)
})
