/**
 * AI 기반 WBS 세부 작업 분해 엔진 (프로바이더 교체 가능 구조).
 *
 * 지원 프로바이더 (AI_PROVIDER 환경변수로 선택, 기본값 'auto'):
 *  - 'gemini' : Google Gemini REST API (GEMINI_API_KEY, GEMINI_MODEL 기본 'gemini-3.1-flash-lite')
 *  - 'openai' : OpenAI 호환 Chat Completions API (OPENAI_API_KEY, OPENAI_MODEL 기본 'gpt-4o-mini', OPENAI_BASE_URL)
 *  - 'rule'   : 외부 API 키 없이도 동작하는 규칙·단계 기반 작업 분해기 (로컬 개발·데모·폴백용)
 *  - 'auto'   : GEMINI_API_KEY 가 있으면 gemini → OPENAI_API_KEY 가 있으면 openai → 둘 다 없으면 rule
 *
 * 외부 AI 호출이 실패하거나(시간 초과·사용량 몰림·형식 오류) 하루 상한을 넘으면 rule 결과를
 * fallback: true + notice 와 함께 돌려준다. (화면에 "기본 단계 추천으로 대신" 안내가 뜬다)
 */

// gemini-2.5-flash 는 새 사용자에게 더 이상 열려 있지 않다(404). 무료 등급에서 빠르게 응답한
// gemini-3.1-flash-lite 를 기본으로 쓴다 (2026-11 실측: 약 1.6초, JSON 형식 준수).
const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite'
/** 외부 AI 응답을 기다리는 최대 시간 (넘으면 기본 단계 추천으로 대신 보여 준다) */
const DEFAULT_AI_TIMEOUT_MS = 20_000

/** AI_TIMEOUT_MS 환경변수 (1~60초 사이) */
export function aiTimeoutMs(env = process.env) {
  const n = Number(env.AI_TIMEOUT_MS)
  return Number.isFinite(n) && n >= 1000 && n <= 60_000 ? n : DEFAULT_AI_TIMEOUT_MS
}
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini'
const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1'

export const MIN_SUBTASKS = 2
export const MAX_SUBTASKS = 8
export const DEFAULT_SUBTASKS = 5

const MAX_LABEL_LEN = 80
const MAX_CHECKLIST_ITEMS = 5
const MAX_CHECKLIST_LEN = 100

/** 요청할 세부 작업 개수를 허용 범위(2~8)로 맞춘다. */
export function clampTaskCount(raw) {
  const n = Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_SUBTASKS
  return Math.min(MAX_SUBTASKS, Math.max(MIN_SUBTASKS, Math.round(n)))
}

/** 환경변수에서 어떤 프로바이더를 쓸지 결정한다. */
export function resolveAiProvider(env = process.env) {
  const forced = String(env.AI_PROVIDER || 'auto').trim().toLowerCase()
  const geminiKey = String(env.GEMINI_API_KEY || '').trim()
  const openaiKey = String(env.OPENAI_API_KEY || '').trim()

  if (forced === 'gemini') {
    if (!geminiKey) throw new Error('AI_PROVIDER=gemini 이지만 GEMINI_API_KEY 가 설정되지 않았습니다.')
    return {
      provider: 'gemini',
      apiKey: geminiKey,
      model: String(env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim(),
    }
  }
  if (forced === 'openai') {
    if (!openaiKey) throw new Error('AI_PROVIDER=openai 이지만 OPENAI_API_KEY 가 설정되지 않았습니다.')
    return {
      provider: 'openai',
      apiKey: openaiKey,
      model: String(env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL).trim(),
      baseUrl: String(env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE).trim().replace(/\/+$/, ''),
    }
  }
  if (forced === 'rule') {
    return { provider: 'rule', model: 'rule-wbs-v1' }
  }
  if (geminiKey) {
    return {
      provider: 'gemini',
      apiKey: geminiKey,
      model: String(env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim(),
    }
  }
  if (openaiKey) {
    return {
      provider: 'openai',
      apiKey: openaiKey,
      model: String(env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL).trim(),
      baseUrl: String(env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE).trim().replace(/\/+$/, ''),
    }
  }
  return { provider: 'rule', model: 'rule-wbs-v1' }
}

/** AI 에 전달할 시스템·사용자 프롬프트 생성 */
export function buildBreakdownPrompt({ topic, context, count }) {
  const cleanTopic = String(topic || '').trim()
  const cleanContext = String(context || '').trim()
  const lines = [
    '당신은 대학생·실무 팀 프로젝트의 WBS(업무 분해 구조) 전문가입니다.',
    `주어진 큰 작업(또는 아이디어)을 실행 가능한 세부 WBS 작업 ${count}개로 순서대로 쪼개 주세요.`,
    '',
    '규칙:',
    `1. 정확히 ${count}개의 세부 작업을 만드세요.`,
    '2. 각 세부 작업의 label(작업명)은 40자 이내의 명확한 행동 중심 한국어 문구로 작성하세요.',
    '3. 각 세부 작업마다 checklist(세부 체크항목)를 2~4개씩 구체적인 한국어로 작성하세요.',
    '4. 반드시 JSON 형식으로만 응답하세요: {"tasks":[{"label":"...","checklist":["...","..."]}]}',
    '',
    `[대상 작업/아이디어]: ${cleanTopic}`,
  ]
  if (cleanContext) lines.push(`[추가 맥락/요구사항]: ${cleanContext}`)
  return lines.join('\n')
}

/** 모델 응답 텍스트에서 JSON 객체를 꺼내고 정해진 모양으로 정리한다. */
export function parseAndSanitizeTasks(rawTextOrObj, maxTasks = MAX_SUBTASKS) {
  let parsed = rawTextOrObj
  if (typeof rawTextOrObj === 'string') {
    const cleaned = rawTextOrObj
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim()
    parsed = JSON.parse(cleaned)
  }
  const rawList = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.tasks) ? parsed.tasks : []
  const out = []
  for (const item of rawList) {
    const normalized = sanitizeOneTask(item)
    if (normalized) out.push(normalized)
    if (out.length >= maxTasks) break
  }
  if (out.length === 0) {
    throw new Error('AI 응답에서 유효한 세부 작업 목록을 찾지 못했습니다.')
  }
  return out
}

function sanitizeOneTask(item) {
  if (!item || typeof item !== 'object') return null
  const label = String(item.label ?? item.title ?? item.name ?? '')
    .replace(/[\u0000-\u001f]/g, ' ')
    .trim()
    .slice(0, MAX_LABEL_LEN)
  if (!label) return null
  const rawChecklist = Array.isArray(item.checklist ?? item.subtasks ?? item.items)
    ? item.checklist ?? item.subtasks ?? item.items
    : []
  const checklist = rawChecklist
    .map((c) => String(c ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, MAX_CHECKLIST_LEN))
    .filter(Boolean)
    .slice(0, MAX_CHECKLIST_ITEMS)
  return { label, checklist }
}

/** Google Gemini generateContent 호출 */
async function callGemini({ apiKey, model, prompt, count, fetchImpl, timeoutMs }) {
  // 키는 주소(?key=)가 아니라 헤더로 보낸다 (주소는 프록시·접속 기록에 남을 수 있다)
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        required: ['tasks'],
        properties: {
          tasks: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              required: ['label', 'checklist'],
              properties: {
                label: { type: 'STRING' },
                checklist: { type: 'ARRAY', items: { type: 'STRING' } },
              },
            },
          },
        },
      },
    },
  }
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) {
    throw new Error(`Gemini API 호출 실패 (${res.status})`)
  }
  const data = await res.json()
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Gemini 응답이 비어 있습니다.')
  }
  return parseAndSanitizeTasks(text, count)
}

/** OpenAI 호환 Chat Completions 호출 */
async function callOpenAi({ apiKey, model, baseUrl, prompt, count, fetchImpl, timeoutMs }) {
  const url = `${baseUrl}/chat/completions`
  const body = {
    model,
    temperature: 0.4,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: '반드시 {"tasks":[{"label":"작업명","checklist":["세부항목1","세부항목2"]}]} 형태의 JSON만 출력하세요.',
      },
      { role: 'user', content: prompt },
    ],
  }
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) {
    throw new Error(`OpenAI API 호출 실패 (${res.status})`)
  }
  const data = await res.json()
  const text = data?.choices?.[0]?.message?.content
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('OpenAI 응답이 비어 있습니다.')
  }
  return parseAndSanitizeTasks(text, count)
}

// ---------------------------------------------------------------------------
// 규칙 기반 폴백 (API 키가 없을 때도 즉시 사용할 수 있는 템플릿 분해기)
// ---------------------------------------------------------------------------

const DOMAIN_TEMPLATES = [
  {
    match: /발표|피티|ppt|프레젠테이션|시연/i,
    steps: (t) => [
      { label: `${t} 핵심 메시지 및 목차 구성`, checklist: ['발표 시간·청중 확인', '핵심 스토리라인 3단 구성', '슬라이드 목차 확정'] },
      { label: `${t} 자료 및 근거 데이터 수집`, checklist: ['핵심 화면 스크린샷·다이어그램 준비', '수치·비교표 정리', '참고 자료 출처 표기'] },
      { label: `${t} 슬라이드 디자인 및 초안 제작`, checklist: ['표지·목차·본문 템플릿 통일', '핵심 장표 시각화', '오타 및 가독성 점검'] },
      { label: `${t} 대본 작성 및 시연 시나리오 준비`, checklist: ['슬라이드별 발표 대본 작성', '라이브 시연 순서 및 백업 영상 준비', '예상 질문(Q&A) 정리'] },
      { label: `${t} 리허설 및 최종 수정`, checklist: ['시간 측정 리허설 진행', '팀원 피드백 반영', '최종 제출본(PDF/PPT) 백업'] },
      { label: `${t} 장비 점검 및 당일 체크`, checklist: ['발표장 화면 비율·음향 확인', '발표자·질의응답 역할 분담'] },
      { label: `${t} 질의응답 예상 답변집 정리`, checklist: ['핵심 기술·기획 질문 5선 정리', '보충 슬라이드(Appendix) 추가'] },
      { label: `${t} 사후 피드백 기록 정리`, checklist: ['심사위원·교수님 피드백 메모', '개선 필요 사항 보드 반영'] },
    ],
  },
  {
    match: /보고서|논문|리포트|문서|기획서|제안서/i,
    steps: (t) => [
      { label: `${t} 목차 설계 및 작성 분량 정의`, checklist: ['제출 양식·분량 제한 확인', '장·절 세부 목차 확정', '참고문헌 표기 규칙 통일'] },
      { label: `${t} 선행 자료 조사 및 레퍼런스 정리`, checklist: ['관련 논문·사례 5건 이상 수집', '핵심 인용구 및 통계 정리', '비교 분석 표 초안 작성'] },
      { label: `${t} 서론·배경 및 문제 정의 집필`, checklist: ['추진 배경 및 필요성 서술', '기존 한계점 및 목표 명시', '도입부 도표 삽입'] },
      { label: `${t} 본론(핵심 설계·결과) 집필`, checklist: ['핵심 내용 및 구현 결과 작성', '표·그래프·아키텍처 그림 삽입', '근거 데이터 검증'] },
      { label: `${t} 결론·기대효과 및 최종 교정`, checklist: ['요약 및 향후 계획 작성', '맞춤법·문맥 통일성 검수', '최종 PDF 변환 및 제출 확인'] },
      { label: `${t} 참고문헌 및 부록 정리`, checklist: ['인용 누락 여부 확인', '부록 데이터·설문 문항 첨부'] },
      { label: `${t} 동료 교차 검토(Peer Review)`, checklist: ['논리 비약 구간 점검', '문단 간 연결성 수정'] },
      { label: `${t} 요약본(Executive Summary) 작성`, checklist: ['1페이지 핵심 요약 정리', '주요 성과 지표 강조'] },
    ],
  },
  {
    match: /개발|구현|앱|웹|서버|기능|api|코딩|프로토타입|시스템/i,
    steps: (t) => [
      { label: `${t} 요구사항 및 화면·API 명세 정의`, checklist: ['핵심 사용자 흐름(User Flow) 정리', '입출력 데이터 및 API 형식 정의', '예외·오류 처리 기준 합의'] },
      { label: `${t} 데이터 구조 및 기본 골격 설계`, checklist: ['DB 스키마·상태 모델 정의', '폴더 및 모듈 구조 세팅', '공통 유틸·환경변수 구성'] },
      { label: `${t} 백엔드 핵심 로직 및 API 구현`, checklist: ['엔드포인트 및 비즈니스 로직 작성', '입력값 검증 및 권한 체크', '단위 동작 확인'] },
      { label: `${t} 프론트엔드 UI 및 상태 연동`, checklist: ['화면 컴포넌트 마크업·스타일링', 'API·상태 데이터 연동', '로딩·오류 안내 표시'] },
      { label: `${t} 통합 테스트 및 버그 수정`, checklist: ['주요 시나리오 및 엣지 케이스 검증', '자동 테스트 작성·실행', '코드 리뷰 및 리팩토링'] },
      { label: `${t} 반응형 화면 및 접근성 다듬기`, checklist: ['좁은 화면 레이아웃 점검', '키보드 조작 및 안내 문구 확인'] },
      { label: `${t} 배포 환경 설정 및 스모크 테스트`, checklist: ['환경변수·빌드 스크립트 점검', '배포 후 실제 동작 확인'] },
      { label: `${t} 사용법 및 기술 문서 정리`, checklist: ['README·실행 방법 업데이트', '변경 사항 및 한계 기록'] },
    ],
  },
]

function buildDefaultSteps(t) {
  return [
    { label: `${t} 목표 및 세부 범위 정의`, checklist: ['최종 산출물 형태 합의', '필수 포함 항목 정리', '일정 및 완료 기준 설정'] },
    { label: `${t} 기초 자료 조사 및 사례 분석`, checklist: ['참고 사례·레퍼런스 수집', '핵심 인사이트 3가지 도출', '조사 결과 팀 공유'] },
    { label: `${t} 핵심 구조 설계 및 초안 작성`, checklist: ['전체 흐름·구성안 스케치', '세부 파트별 초안 작성', '필요 리소스·도구 정리'] },
    { label: `${t} 세부 내용 제작 및 고도화`, checklist: ['초안 바탕 본문·결과물 제작', '시각 자료·예시 보강', '중간 점검 피드백 반영'] },
    { label: `${t} 최종 검수 및 제출본 완성`, checklist: ['누락 항목 및 완성도 점검', '팀원 전체 최종 확인', '제출 형식에 맞춰 내보내기'] },
    { label: `${t} 예상 문제점 및 대안 점검`, checklist: ['리스크 요인 파악', '대체 방안 마련'] },
    { label: `${t} 중간 공유 및 피드백 수렴`, checklist: ['진행 현황 공유', '수정 사항 정리'] },
    { label: `${t} 결과 정리 및 회고 기록`, checklist: ['산출물 아카이빙', '배운 점 및 개선점 기록'] },
  ]
}

export function generateRuleBasedTasks(topic, context = '', count = DEFAULT_SUBTASKS) {
  const shortTopic = String(topic || '새 작업').trim().slice(0, 28) || '새 작업'
  const combined = `${shortTopic} ${context}`
  const matched = DOMAIN_TEMPLATES.find((d) => d.match.test(combined))
  const pool = matched ? matched.steps(shortTopic) : buildDefaultSteps(shortTopic)
  return pool.slice(0, clampTaskCount(count))
}

/**
 * 큰 작업/아이디어를 세부 WBS 작업 목록으로 분해한다.
 * @param {{ topic: string, context?: string, count?: number }} input
 * @param {{ env?: Record<string, string | undefined>, fetchImpl?: typeof fetch }} [options]
 */
export async function breakdownTaskWithAi(input, options = {}) {
  const env = options.env ?? process.env
  const fetchImpl = options.fetchImpl ?? fetch
  const topic = String(input?.topic ?? '').trim()
  const context = String(input?.context ?? '').trim()
  const count = clampTaskCount(input?.count)

  if (!topic) {
    throw new Error('분해할 작업 제목이나 내용을 입력하세요.')
  }

  const resolved = resolveAiProvider(env)
  const ruleResult = (notice) => ({
    provider: 'rule',
    model: 'rule-wbs-v1',
    tasks: generateRuleBasedTasks(topic, context, count),
    ...(notice ? { fallback: true, notice } : {}),
  })
  if (resolved.provider === 'rule') return ruleResult()

  // 외부 AI 를 부르지 않기로 한 경우(서버 전체 하루 상한 초과 등): 기본 단계 추천으로 대신
  if (options.skipExternal) return ruleResult(options.skipReason || 'AI 사용량이 많아 기본 단계 추천으로 보여 드려요.')

  const prompt = buildBreakdownPrompt({ topic, context, count })
  const timeoutMs = aiTimeoutMs(env)
  try {
    const tasks =
      resolved.provider === 'gemini'
        ? await callGemini({ apiKey: resolved.apiKey, model: resolved.model, prompt, count, fetchImpl, timeoutMs })
        : await callOpenAi({
            apiKey: resolved.apiKey,
            model: resolved.model,
            baseUrl: resolved.baseUrl,
            prompt,
            count,
            fetchImpl,
            timeoutMs,
          })
    return {
      provider: resolved.provider,
      model: resolved.model,
      tasks,
    }
  } catch (err) {
    // 응답이 늦거나(시간 초과) 사용량이 몰리거나(503·429) 형식이 깨져도 사용자는 결과를 받는다.
    // 키 값이 오류 문구에 섞이지 않도록 메시지만 남긴다.
    if (options.onError) options.onError(err)
    if (options.fallbackOnError === false) throw err
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError')
    return ruleResult(
      timedOut
        ? 'AI 응답이 늦어 기본 단계 추천으로 보여 드려요. 잠시 뒤 다시 생성해 보세요.'
        : 'AI 서비스가 지금 응답하지 않아 기본 단계 추천으로 보여 드려요. 잠시 뒤 다시 생성해 보세요.',
    )
  }
}
