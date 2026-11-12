/**
 * AI 기반 작업 분해 REST API.
 *
 *  POST /api/ai/:slug/breakdown
 *    - 요청: { topic: string, context?: string, count?: number }
 *    - 응답: { provider: 'gemini' | 'openai' | 'rule', model: string, tasks: Array<{ label: string, checklist: string[] }> }
 *
 * 권한: JWT 인증 + 해당 보드의 정식 멤버(owner/member)만 호출 가능 (invited 불가).
 * 보호: 사용자별 호출 횟수 제한(10분에 20회)으로 외부 AI API 할당량 남용을 막는다.
 */
import express from 'express'
import { db } from '../db.js'
import { breakdownTaskWithAi, clampTaskCount } from '../ai.js'
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
  const rec = aiUsage.get(userId)
  if (!rec || now - rec.first > AI_WINDOW_MS) {
    aiUsage.set(userId, { count: 1, first: now })
    return true
  }
  if (rec.count >= AI_MAX_CALLS) return false
  rec.count++
  return true
}

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
  return {
    topic: topic.trim(),
    context: typeof context === 'string' ? context.trim() : '',
    count: clampTaskCount(count),
  }
}

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

    try {
      const result = await breakdownTaskWithAi(validated)
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
