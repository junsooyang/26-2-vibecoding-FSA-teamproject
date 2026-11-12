/**
 * AI 기반 작업 분해 REST API.
 *
 *  GET /api/ai/models
 *    - 응답: { models: Array<{ id, label, model, available, reason? }>, defaultModel }
 *    - 권한: 로그인만 (키가 있는지만 알려 주고 키 값은 내보내지 않는다)
 *
 *  POST /api/ai/:slug/breakdown
 *    - 요청: { topic: string, context?: string, count?: number, model?: 'gemini' | 'openai' | 'rule' }
 *    - 응답: { provider: 'gemini' | 'openai' | 'rule', model: string, tasks: Array<{ label: string, checklist: string[] }> }
 *    - 쓸 수 없는 모델(키 없음·서버 설정으로 꺼짐)을 고르면 400
 *
 * 권한: JWT 인증 + 해당 보드의 정식 멤버(owner/member)만 작업 분해 호출 가능 (invited 불가).
 * 보호: 사용자별 호출 횟수 제한(10분에 20회)으로 외부 AI API 할당량 남용을 막는다.
 */
import express from 'express'
import { db } from '../db.js'
import {
  AI_MODEL_IDS,
  breakdownTaskWithAi,
  clampTaskCount,
  defaultAiModelId,
  listAiModels,
  resolveAiChoice,
} from '../ai.js'
import { asyncRoute, requireAuth } from './auth.js'

const router = express.Router()
router.use(requireAuth)

const TOPIC_MAX = 500
const CONTEXT_MAX = 1000

// 사용자별 AI 호출 제한 (10분에 20회)
const AI_WINDOW_MS = 10 * 60 * 1000
const AI_MAX_CALLS = 20
const aiUsage = new Map() // userId -> { count, first }

function checkAndRecordAiQuota(userId) {
  const now = Date.now()
  // 오래된 기록이 쌓이지 않게 가끔 정리
  if (aiUsage.size > 5000) {
    for (const [k, v] of aiUsage) if (now - v.first > AI_WINDOW_MS) aiUsage.delete(k)
  }
  const rec = aiUsage.get(userId)
  if (!rec || now - rec.first > AI_WINDOW_MS) {
    aiUsage.set(userId, { count: 1, first: now })
    return true
  }
  if (rec.count >= AI_MAX_CALLS) return false
  rec.count++
  return true
}

/**
 * 서버 전체 하루 외부 AI 호출 상한 (AI_DAILY_LIMIT, 기본 200회).
 * 무료 키의 하루 한도를 다 써 버리거나 유료 키 비용이 끝없이 늘지 않게 한다.
 * 넘으면 오류 대신 기본 단계 추천으로 대신 보여 준다. 날짜는 UTC 기준으로 바뀐다.
 */
export function createDailyCounter(limit) {
  let day = ''
  let used = 0
  return {
    /** 한 번 쓸 수 있으면 세고 true, 상한이면 false */
    take(now = Date.now()) {
      const today = new Date(now).toISOString().slice(0, 10)
      if (today !== day) {
        day = today
        used = 0
      }
      if (used >= limit) return false
      used++
      return true
    },
    get used() {
      return used
    },
  }
}
const dailyLimit = (() => {
  const n = Number(process.env.AI_DAILY_LIMIT)
  return Number.isInteger(n) && n >= 0 ? n : 200
})()
const daily = createDailyCounter(dailyLimit)

/** 보드 멤버십 확인 미들웨어 (owner/member 만 통과) */
const requireRoomMember = asyncRoute(async (req, res, next) => {
  const room = await db.get('SELECT * FROM rooms WHERE slug = ?', [req.params.slug])
  if (!room) return res.status(404).json({ error: '존재하지 않는 방입니다.' })
  const membership = await db.get(
    'SELECT role FROM room_members WHERE room_id = ? AND user_id = ?',
    [room.id, req.user.id],
  )
  if (!membership || membership.role === 'invited') {
    return res.status(403).json({ error: '이 방에 접근할 권한이 없습니다.' })
  }
  req.room = room
  next()
})

function validateBreakdownBody(body) {
  const { topic, context, count } = body ?? {}
  if (typeof topic !== 'string' || !topic.trim()) {
    return { error: '분해할 작업 제목이나 내용을 입력하세요.' }
  }
  if (topic.trim().length > TOPIC_MAX) {
    return { error: `작업 제목/내용은 ${TOPIC_MAX}자 이하로 입력하세요.` }
  }
  if (context !== undefined && typeof context !== 'string') {
    return { error: '추가 맥락 형식이 올바르지 않습니다.' }
  }
  if (typeof context === 'string' && context.length > CONTEXT_MAX) {
    return { error: `추가 맥락은 ${CONTEXT_MAX}자 이하로 입력하세요.` }
  }
  if (count !== undefined && (typeof count !== 'number' || !Number.isFinite(count))) {
    return { error: '작업 개수는 숫자여야 합니다.' }
  }
  const { model } = body ?? {}
  if (model !== undefined && (typeof model !== 'string' || !AI_MODEL_IDS.includes(model))) {
    return { error: '알 수 없는 모델이에요.' }
  }
  return {
    topic: topic.trim(),
    context: typeof context === 'string' ? context.trim() : '',
    count: clampTaskCount(count),
    ...(model ? { model } : {}),
  }
}

/**
 * GET /api/ai/models — AI 창의 모델 선택 목록.
 * 키가 있는 모델만 available: true. 키 값은 내보내지 않는다.
 */
router.get('/models', (_req, res) => {
  res.json({ models: listAiModels(), defaultModel: defaultAiModelId() })
})

router.post(
  '/:slug/breakdown',
  requireRoomMember,
  asyncRoute(async (req, res) => {
    const validated = validateBreakdownBody(req.body)
    if (validated.error) {
      return res.status(400).json({ error: validated.error })
    }
    if (!checkAndRecordAiQuota(req.user.id)) {
      return res
        .status(429)
        .json({ error: 'AI 작업 분해 요청이 너무 많아요. 잠시 뒤에 다시 시도하세요.' })
    }

    // 고른 모델을 지금 쓸 수 있는지 먼저 확인 (키가 없는 모델을 억지로 보내도 호출하지 않는다)
    let chosen
    try {
      chosen = resolveAiChoice(process.env, validated.model)
    } catch (err) {
      if (err && err.code === 'MODEL_UNAVAILABLE') return res.status(400).json({ error: err.message })
      console.error('[ai] 모델 설정 오류:', err instanceof Error ? err.message : err)
      return res
        .status(502)
        .json({ error: 'AI 서비스에서 세부 작업을 생성하지 못했습니다. 설정이나 네트워크를 확인하세요.' })
    }

    try {
      // 외부 AI 를 쓸 때만 하루 상한을 센다 (기본 단계 추천은 외부 호출을 하지 않는다)
      const usesExternal = chosen.provider !== 'rule'
      const allowed = !usesExternal || daily.take()
      const result = await breakdownTaskWithAi(validated, {
        skipExternal: !allowed,
        skipReason: '오늘 AI 사용량이 많아 기본 단계 추천으로 보여 드려요. 내일 다시 시도해 보세요.',
        onError: (err) => console.warn('[ai] 외부 AI 호출 실패 → 기본 단계 추천:', err instanceof Error ? err.message : err),
      })
      return res.json(result)
    } catch (err) {
      console.error('[ai] 작업 분해 실패:', err instanceof Error ? err.message : err)
      return res
        .status(502)
        .json({ error: 'AI 서비스에서 세부 작업을 생성하지 못했습니다. 설정이나 네트워크를 확인하세요.' })
    }
  }),
)

export default router
