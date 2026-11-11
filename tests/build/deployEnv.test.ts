import { describe, expect, it } from 'vitest'
import { checkDeployEnv, formatDeployEnvReport, isStrictDeployBuild } from '../../scripts/deployEnv'

const GOOD = { VITE_API_URL: 'https://board.example.com/api', VITE_WS_URL: 'wss://board.example.com/ws' }

describe('isStrictDeployBuild', () => {
  it('Vercel 이나 CHECK_DEPLOY_ENV=1 일 때만 엄격', () => {
    expect(isStrictDeployBuild({ VERCEL: '1' })).toBe(true)
    expect(isStrictDeployBuild({ CHECK_DEPLOY_ENV: '1' })).toBe(true)
    expect(isStrictDeployBuild({})).toBe(false)
  })
})

describe('checkDeployEnv (배포 빌드)', () => {
  it('올바른 값이면 통과', () => {
    expect(checkDeployEnv(GOOD, { strict: true })).toEqual({ errors: [], warnings: [] })
  })

  it('둘 다 없으면 두 개 모두 오류', () => {
    const r = checkDeployEnv({}, { strict: true })
    expect(r.errors).toHaveLength(2)
    expect(r.errors.join()).toMatch(/VITE_API_URL/)
    expect(r.errors.join()).toMatch(/VITE_WS_URL/)
  })

  it('공백만 있어도 빈 값으로 본다', () => {
    expect(checkDeployEnv({ ...GOOD, VITE_WS_URL: '   ' }, { strict: true }).errors).toHaveLength(1)
  })

  it('http·ws 주소는 막는다 (https 페이지에서 브라우저가 차단)', () => {
    const r = checkDeployEnv(
      { VITE_API_URL: 'http://board.example.com/api', VITE_WS_URL: 'ws://board.example.com/ws' },
      { strict: true },
    )
    expect(r.errors).toHaveLength(2)
  })

  it('localhost 주소는 막는다', () => {
    const r = checkDeployEnv(
      { VITE_API_URL: 'https://localhost:3001/api', VITE_WS_URL: 'wss://127.0.0.1:3001/ws' },
      { strict: true },
    )
    expect(r.errors.filter((e) => e.includes('localhost'))).toHaveLength(2)
  })

  it('주소 형식이 아니면 막는다', () => {
    const r = checkDeployEnv({ ...GOOD, VITE_API_URL: 'board.example.com/api' }, { strict: true })
    expect(r.errors.join()).toMatch(/올바른 주소/)
  })

  it('/api 로 끝나지 않으면 경고만 한다', () => {
    const r = checkDeployEnv({ ...GOOD, VITE_API_URL: 'https://board.example.com' }, { strict: true })
    expect(r.errors).toEqual([])
    expect(r.warnings).toHaveLength(1)
  })
})

describe('checkDeployEnv (로컬 빌드)', () => {
  it('값이 없어도 막지 않고 경고로만 알린다', () => {
    const r = checkDeployEnv({}, { strict: false })
    expect(r.errors).toEqual([])
    expect(r.warnings).toHaveLength(2)
  })
})

describe('서버 비밀 값 노출 막기', () => {
  const jwt = (payload: object) =>
    `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`

  it('로컬 빌드여도 Supabase 비밀 키·DB 주소·service_role 키가 VITE_ 에 있으면 막는다', () => {
    for (const extra of [
      { VITE_SUPABASE_KEY: 'sb_secret_abc' },
      { VITE_DB: 'postgresql://postgres.x:pw@aws-0-x.pooler.supabase.com:5432/postgres' },
      { VITE_KEY: jwt({ role: 'service_role' }) },
      { VITE_SUPABASE_SECRET_KEY: 'anything' },
    ]) {
      expect(checkDeployEnv({ ...GOOD, ...extra }, { strict: false }).errors).toHaveLength(1)
      expect(checkDeployEnv({ ...GOOD, ...extra }, { strict: true }).errors).toHaveLength(1)
    }
  })

  it('공개해도 되는 키(publishable·anon)는 막지 않는다', () => {
    const r = checkDeployEnv(
      { ...GOOD, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc', VITE_ANON: jwt({ role: 'anon' }) },
      { strict: true },
    )
    expect(r.errors).toEqual([])
  })
})

describe('formatDeployEnvReport', () => {
  it('오류가 있으면 멈춘다는 문구와 Vercel 설정 위치를 알려 준다', () => {
    const text = formatDeployEnvReport(checkDeployEnv({}, { strict: true }))
    expect(text).toMatch(/빌드를 멈춥니다/)
    expect(text).toMatch(/Environment Variables/)
  })
  it('문제가 없으면 빈 문자열', () => {
    expect(formatDeployEnvReport(checkDeployEnv(GOOD, { strict: true }))).toBe('')
  })
})
