/**
 * AI 기반 WBS 작업 분해 테스트.
 *  - 프로바이더 선택(Gemini / OpenAI / 규칙 기반 폴백)과 응답 정리 확인
 *  - REST API 권한 검사(로그인, 보드 멤버 전용, 초대 대기 차단) 및 입력 검증
 */
import { createRequire } from 'node:module'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeApi, register, startServers, type TestServers } from '../helpers/server'

const nodeRequire = createRequire(import.meta.url)
const {
  breakdownTaskWithAi,
  clampTaskCount,
  parseAndSanitizeTasks,
  resolveAiProvider,
} = nodeRequire('../../server/ai.js') as typeof import('../../server/ai.js')

let servers: TestServers
let call: ReturnType<typeof makeApi>

beforeAll(async () => {
  servers = await startServers()
  call = makeApi(servers.api)
})

afterAll(async () => {
  await servers.close()
})

describe('AI 프로바이더 및 응답 파서 (server/ai.js)', () => {
  it('키가 없으면 기본 단계 추천(rule) 모드를 고르고, GEMINI_API_KEY 나 OPENAI_API_KEY 가 있으면 해당 모델을 고른다', () => {
    expect(resolveAiProvider({})).toEqual({ provider: 'rule', model: 'rule-wbs-v1' })
    expect(resolveAiProvider({ GEMINI_API_KEY: 'g-key' })).toEqual({
      provider: 'gemini',
      apiKey: 'g-key',
      model: 'gemini-3.1-flash-lite',
    })
    expect(resolveAiProvider({ OPENAI_API_KEY: 'o-key', OPENAI_MODEL: 'gpt-4.1-mini' })).toEqual({
      provider: 'openai',
      apiKey: 'o-key',
      model: 'gpt-4.1-mini',
      baseUrl: 'https://api.openai.com/v1',
    })
  })

  it('요청 개수는 2~8 사이로 맞춘다', () => {
    expect(clampTaskCount(1)).toBe(2)
    expect(clampTaskCount(99)).toBe(8)
    expect(clampTaskCount(undefined)).toBe(5)
    expect(clampTaskCount(4)).toBe(4)
  })

  it('마크다운 코드블록이 섞인 JSON 응답도 안전하게 파싱하고 제어문자를 정리한다', () => {
    const raw = '```json\n{"tasks":[{"label":"  DB 스키마 설계\\u0000 ","checklist":["테이블 정의","  ","인덱스 확인"]}]}\n```'
    const tasks = parseAndSanitizeTasks(raw, 5)
    expect(tasks).toEqual([
      {
        label: 'DB 스키마 설계',
        checklist: ['테이블 정의', '인덱스 확인'],
      },
    ])
  })

  it('Gemini 프로바이더 호출 시 공식 generateContent 형식으로 요청하고 결과를 정리한다', async () => {
    let calledUrl = ''
    let keyHeader = ''
    let hasSignal = false
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calledUrl = String(url)
      keyHeader = String((init?.headers as Record<string, string>)?.['x-goog-api-key'] ?? '')
      hasSignal = !!init?.signal
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      tasks: [
                        { label: '요구사항 분석', checklist: ['기능 목록 정리', '화면 흐름도'] },
                        { label: 'API 구현', checklist: ['라우터 작성', '권한 테스트'] },
                      ],
                    }),
                  },
                ],
              },
            },
          ],
        }),
      }
    }) as unknown as typeof fetch

    const res = await breakdownTaskWithAi(
      { topic: '결제 모듈 개발', count: 2 },
      { env: { GEMINI_API_KEY: 'test-gemini-key' }, fetchImpl: fakeFetch },
    )
    expect(calledUrl).toContain('generativelanguage.googleapis.com')
    expect(calledUrl).toContain('gemini-3.1-flash-lite:generateContent')
    // 키는 주소가 아니라 헤더로, 시간 제한과 함께 보낸다
    expect(calledUrl).not.toContain('test-gemini-key')
    expect(calledUrl).not.toContain('key=')
    expect(keyHeader).toBe('test-gemini-key')
    expect(hasSignal).toBe(true)
    expect(res.provider).toBe('gemini')
    expect(res.fallback).toBeUndefined()
    expect(res.tasks).toHaveLength(2)
    expect(res.tasks[0].label).toBe('요구사항 분석')
  })

  it('OpenAI 호환 프로바이더로도 손쉽게 전환할 수 있다', async () => {
    let authHeader = ''
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      authHeader = String((init?.headers as Record<string, string>)?.Authorization ?? '')
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  tasks: [
                    { label: '슬라이드 목차 구성', checklist: ['도입부', '본론'] },
                    { label: '대본 리허설', checklist: ['시간 측정'] },
                  ],
                }),
              },
            },
          ],
        }),
      }
    }) as unknown as typeof fetch

    const res = await breakdownTaskWithAi(
      { topic: '최종 발표 준비', count: 2 },
      { env: { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test-123' }, fetchImpl: fakeFetch },
    )
    expect(authHeader).toBe('Bearer sk-test-123')
    expect(res.provider).toBe('openai')
    expect(res.tasks).toHaveLength(2)
  })
})

describe('외부 AI 가 실패하면 기본 단계 추천으로 대신 (server/ai.js)', () => {
  const env = { GEMINI_API_KEY: 'k' }

  it('사용량 몰림(503)·형식이 깨진 응답이면 fallback 과 안내 문구를 돌려준다', async () => {
    const busy = (async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof fetch
    const r1 = await breakdownTaskWithAi({ topic: '발표 준비', count: 3 }, { env, fetchImpl: busy })
    expect(r1).toMatchObject({ provider: 'rule', fallback: true })
    expect(r1.tasks).toHaveLength(3)
    expect(r1.notice).toMatch(/기본 단계 추천/)

    const broken = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: '이건 JSON 이 아님' }] } }] }),
    })) as unknown as typeof fetch
    expect(await breakdownTaskWithAi({ topic: '발표 준비' }, { env, fetchImpl: broken })).toMatchObject({
      provider: 'rule',
      fallback: true,
    })
  })

  it('응답이 시간 제한(AI_TIMEOUT_MS)을 넘으면 기다리지 않고 대신한다', async () => {
    const slow = ((_u: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
      })) as unknown as typeof fetch
    const t0 = Date.now()
    const r = await breakdownTaskWithAi(
      { topic: '보고서 작성' },
      { env: { ...env, AI_TIMEOUT_MS: '1000' }, fetchImpl: slow },
    )
    expect(Date.now() - t0).toBeLessThan(5000)
    expect(r).toMatchObject({ provider: 'rule', fallback: true })
    expect(r.notice).toMatch(/늦어/)
  })

  it('하루 상한을 넘기면(skipExternal) 외부 AI 를 부르지 않는다', async () => {
    let called = false
    const spy = (async () => {
      called = true
      return { ok: true, status: 200, json: async () => ({}) }
    }) as unknown as typeof fetch
    const r = await breakdownTaskWithAi({ topic: '앱 개발' }, { env, fetchImpl: spy, skipExternal: true, skipReason: '상한' })
    expect(called).toBe(false)
    expect(r).toMatchObject({ provider: 'rule', fallback: true, notice: '상한' })
  })

  it('하루 상한 카운터: 상한까지만 허용하고 날짜가 바뀌면 다시 센다', () => {
    const { createDailyCounter } = nodeRequire('../../server/api/ai.js') as {
      createDailyCounter: (limit: number) => { take: (now?: number) => boolean }
    }
    const c = createDailyCounter(2)
    const day1 = Date.UTC(2026, 10, 12, 10)
    expect([c.take(day1), c.take(day1), c.take(day1)]).toEqual([true, true, false])
    expect(c.take(Date.UTC(2026, 10, 13, 0, 1))).toBe(true)
    expect(createDailyCounter(0).take(day1)).toBe(false)
  })
})

describe('POST /api/ai/:slug/breakdown 권한 및 입력 검증', () => {
  it('비로그인(401), 없는 보드(404), 외부인·초대 대기(403)는 거절하고 정식 멤버만 허용한다', async () => {
    const owner = await register(call, 'ai_owner')
    const member = await register(call, 'ai_member')
    const invited = await register(call, 'ai_invited')
    const outsider = await register(call, 'ai_outsider')

    const slug = (await call('POST', '/rooms', owner, { name: 'AI보드' })).json.room.slug
    await call('POST', `/rooms/${slug}/members`, owner, { username: 'ai_member' })
    await call('POST', `/rooms/${slug}/accept`, member)
    await call('POST', `/rooms/${slug}/members`, owner, { username: 'ai_invited' })

    expect((await call('POST', `/ai/${slug}/breakdown`, null, { topic: '앱 개발' })).status).toBe(401)
    expect((await call('POST', '/ai/no-such-room/breakdown', owner, { topic: '앱 개발' })).status).toBe(404)
    expect((await call('POST', `/ai/${slug}/breakdown`, outsider, { topic: '앱 개발' })).status).toBe(403)
    expect((await call('POST', `/ai/${slug}/breakdown`, invited, { topic: '앱 개발' })).status).toBe(403)

    const ok = await call('POST', `/ai/${slug}/breakdown`, member, {
      topic: '캡스톤 웹 서비스 개발',
      context: 'React + Node.js',
      count: 4,
    })
    expect(ok.status).toBe(200)
    expect(ok.json.tasks).toHaveLength(4)
    expect(ok.json.tasks[0].label).toContain('캡스톤 웹 서비스 개발')
    expect(Array.isArray(ok.json.tasks[0].checklist)).toBe(true)
  })

  it('빈 제목·너무 긴 제목·잘못된 형식은 400 으로 거절한다', async () => {
    const owner = await register(call, 'ai_val')
    const slug = (await call('POST', '/rooms', owner, { name: '검증보드' })).json.room.slug

    expect((await call('POST', `/ai/${slug}/breakdown`, owner, { topic: '   ' })).status).toBe(400)
    expect((await call('POST', `/ai/${slug}/breakdown`, owner, { topic: ['배열'] })).status).toBe(400)
    expect((await call('POST', `/ai/${slug}/breakdown`, owner, { topic: '가'.repeat(501) })).status).toBe(400)
    expect((await call('POST', `/ai/${slug}/breakdown`, owner, { topic: '정상', context: 123 })).status).toBe(400)
  })
})
