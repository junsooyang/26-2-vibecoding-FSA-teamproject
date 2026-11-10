import { defineConfig } from 'vitest/config'

// 자동 테스트 설정 (npm test)
// - 서버(API·실시간)와 순수 로직(src/collab)을 Node 환경에서 검사한다.
// - 서버 테스트는 임시 DB 파일과 빈 포트를 써서 실제 board.db / 실행 중인 서버에 영향을 주지 않는다.
// - 테스트 파일마다 별도 프로세스(forks)에서 돌려, 서버 모듈이 import 시점에 여는 DB 연결이 섞이지 않게 한다.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,js}'],
    pool: 'forks',
    testTimeout: 20000,
    hookTimeout: 20000,
    // 서버 코드(server/)는 tests/helpers 가 Node 의 require 로 직접 불러온다 (Vite 변환을 거치지 않음).
  },
})
