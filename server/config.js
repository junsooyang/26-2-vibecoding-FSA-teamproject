/**
 * 서버 공용 설정 (API 서버와 실시간 서버가 같은 값을 쓰도록 한 곳에서 관리).
 */

const DEV_SECRET = 'dev-insecure-secret-change-me'

// 운영에서는 반드시 환경변수로 주입할 것. (개발 편의용 기본값)
export const JWT_SECRET = process.env.JWT_SECRET || DEV_SECRET

// 운영 환경에서 개발용 기본 비밀키(또는 .env.example 의 예시 값, 너무 짧은 값)를 쓰면
// 누구나 토큰을 위조할 수 있으므로 시작 자체를 막는다.
const WEAK_SECRETS = new Set([DEV_SECRET, 'change-me-in-production'])
if (process.env.NODE_ENV === 'production' && (WEAK_SECRETS.has(JWT_SECRET) || JWT_SECRET.length < 32)) {
  throw new Error('운영 환경에서는 JWT_SECRET 환경변수를 32자 이상의 임의 값으로 설정해야 합니다.')
}
if (process.env.NODE_ENV !== 'production' && JWT_SECRET === DEV_SECRET && !process.env.VITEST) {
  console.warn('[config] 개발용 JWT_SECRET 을 쓰고 있어요. 배포할 때는 반드시 바꾸세요.')
}

export const DB_PATH = process.env.DB_PATH || 'board.db'

// 실시간 서버 메시지 하나의 최대 크기 (MB). 예전 방식으로 문서에 들어간 사진을 고려해 넉넉히 둔다.
export const WS_MAX_PAYLOAD = (Number(process.env.WS_MAX_PAYLOAD_MB) || 16) * 1024 * 1024
