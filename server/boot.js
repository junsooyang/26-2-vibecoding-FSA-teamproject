/**
 * 서버 실행 전 공통 준비: DB 연결·스키마 확인, 파일 저장소(버킷) 확인.
 * 여기서 실패하면 잘못된 설정으로 떠 있지 않도록 프로세스를 끝낸다.
 */
import { db, describeDb } from './db.js'
import { storage, describeStorage } from './storage.js'

export async function prepareServer(tag) {
  try {
    await db.ready()
  } catch (err) {
    console.error(`[${tag}] DB 연결 실패 (${describeDb()}):`, err instanceof Error ? err.message : err)
    console.error(`[${tag}] DATABASE_URL·DATABASE_SSL 설정을 확인하세요. Render 에서는 Supabase "Session pooler" 주소를 써야 해요.`)
    process.exit(1)
  }
  if (storage.ensureBucket) {
    try {
      const r = await storage.ensureBucket()
      if (r === 'created') console.log(`[${tag}] 저장소 버킷을 비공개로 만들었어요.`)
    } catch (err) {
      console.error(`[${tag}] 파일 저장소 확인 실패 (${describeStorage()}):`, err instanceof Error ? err.message : err)
      console.error(`[${tag}] SUPABASE_URL·SUPABASE_SECRET_KEY·SUPABASE_BUCKET 설정을 확인하세요.`)
      process.exit(1)
    }
  }
  console.log(`[${tag}]   DB         → ${describeDb()}`)
  console.log(`[${tag}]   파일 저장소 → ${describeStorage()}`)
}
