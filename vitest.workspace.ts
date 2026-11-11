import { defineWorkspace } from 'vitest/config'

// 같은 테스트를 두 DB 에서 돌린다.
//  - sqlite   : 모든 테스트 (로컬 개발과 같은 SQLite)
//  - postgres : 서버 테스트만, 메모리 Postgres(PGlite) 로 한 번 더 (배포용 Supabase 와 같은 SQL 방언)
export default defineWorkspace([
  {
    extends: './vitest.config.ts',
    test: { name: 'sqlite' },
  },
  {
    extends: './vitest.config.ts',
    test: {
      name: 'postgres',
      include: ['tests/server/**/*.test.ts'],
      env: { DB_DRIVER: 'pglite' },
    },
  },
])
