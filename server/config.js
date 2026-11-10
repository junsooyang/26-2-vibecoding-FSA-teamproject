/**
 * 서버 공용 설정 (API 서버와 실시간 서버가 같은 값을 쓰도록 한 곳에서 관리).
 */

const DEV_SECRET = 'dev-insecure-secret-change-me'

// 운영에서는 반드시 환경변수로 주입할 것. (개발 편의용 기본값)
export const JWT_SECRET = process.env.JWT_SECRET || DEV_SECRET

// 운영 환경에서 개발용 기본 비밀키를 쓰면 누구나 토큰을 위조할 수 있으므로 시작 자체를 막는다.
if (process.env.NODE_ENV === 'production' && JWT_SECRET === DEV_SECRET) {
  throw new Error('운영 환경에서는 JWT_SECRET 환경변수를 반드시 설정해야 합니다.')
}

export const DB_PATH = process.env.DB_PATH || 'board.db'
