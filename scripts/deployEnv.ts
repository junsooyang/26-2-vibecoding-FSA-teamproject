/**
 * 배포 빌드 전 프론트 환경변수 검사.
 *
 * VITE_API_URL / VITE_WS_URL 은 "빌드할 때" 코드에 박힌다. 빠뜨리면 조용히 localhost 기본값으로
 * 빌드되어, 배포된 사이트가 로그인도 실시간 연결도 못 한다. 그래서 배포 빌드에서는 빌드를 멈춘다.
 *
 *  - 엄격(strict): Vercel(VERCEL=1) 또는 CHECK_DEPLOY_ENV=1 → 문제가 있으면 빌드 실패
 *  - 그 밖(로컬 npm run build): 경고만 출력
 */

export interface DeployEnvResult {
  errors: string[]
  warnings: string[]
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1'])

/** 이 빌드에서 엄격하게 검사할지 */
export function isStrictDeployBuild(env: Record<string, string | undefined>): boolean {
  return env.VERCEL === '1' || env.CHECK_DEPLOY_ENV === '1'
}

function parse(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

export function checkDeployEnv(
  env: Record<string, string | undefined>,
  options: { strict: boolean },
): DeployEnvResult {
  const problems: string[] = []
  const warnings: string[] = []
  const api = (env.VITE_API_URL ?? '').trim()
  const ws = (env.VITE_WS_URL ?? '').trim()

  // --- VITE_API_URL ---
  if (!api) {
    problems.push('VITE_API_URL 이 비어 있어요. 예: https://<서버 주소>/api')
  } else {
    const u = parse(api)
    if (!u) problems.push(`VITE_API_URL 이 올바른 주소가 아니에요: "${api}"`)
    else {
      if (u.protocol !== 'https:') {
        problems.push(`VITE_API_URL 은 https:// 로 시작해야 해요 (https 페이지에서 http 호출은 브라우저가 막아요): "${api}"`)
      }
      if (LOCAL_HOSTS.has(u.hostname)) {
        problems.push(`VITE_API_URL 이 내 컴퓨터(localhost) 주소예요. 배포된 서버 주소를 넣으세요: "${api}"`)
      }
      if (!/\/api\/?$/.test(u.pathname)) {
        warnings.push(`VITE_API_URL 이 /api 로 끝나지 않아요. 서버 주소 뒤에 /api 를 붙였는지 확인하세요: "${api}"`)
      }
    }
  }

  // --- VITE_WS_URL ---
  if (!ws) {
    problems.push('VITE_WS_URL 이 비어 있어요. 예: wss://<서버 주소>/ws')
  } else {
    const u = parse(ws)
    if (!u) problems.push(`VITE_WS_URL 이 올바른 주소가 아니에요: "${ws}"`)
    else {
      if (u.protocol !== 'wss:') {
        problems.push(`VITE_WS_URL 은 wss:// 로 시작해야 해요 (https 페이지에서 ws:// 연결은 브라우저가 막아요): "${ws}"`)
      }
      if (LOCAL_HOSTS.has(u.hostname)) {
        problems.push(`VITE_WS_URL 이 내 컴퓨터(localhost) 주소예요. 배포된 서버 주소를 넣으세요: "${ws}"`)
      }
    }
  }

  // VITE_ 로 시작하는 값은 모두 브라우저 코드에 그대로 들어간다. 서버 비밀 값이 섞이면 누구나 볼 수 있으므로
  // 로컬 빌드여도 항상 막는다.
  const leaks = findSecretLeaks(env)

  // 로컬 빌드에서는 막지 않고 알려만 준다 (개발·테스트용 빌드는 기본값으로 충분)
  if (!options.strict) return { errors: leaks, warnings: [...problems, ...warnings] }
  return { errors: [...leaks, ...problems], warnings }
}

/** 브라우저에 들어가면 안 되는 서버 비밀 값이 VITE_ 변수에 있는지 */
export function findSecretLeaks(env: Record<string, string | undefined>): string[] {
  const out: string[] = []
  for (const [key, raw] of Object.entries(env)) {
    if (!key.startsWith('VITE_')) continue
    const value = (raw ?? '').trim()
    if (!value) continue
    const byName = /SECRET|SERVICE_ROLE|PASSWORD|DATABASE_URL|JWT/i.test(key)
    const byValue =
      value.startsWith('sb_secret_') || /^postgres(ql)?:\/\//i.test(value) || isServiceRoleJwt(value)
    if (byName || byValue) {
      out.push(`${key} 에 서버 비밀 값이 들어 있어요. VITE_ 값은 브라우저에 그대로 공개되니 서버(Render) 환경변수로만 넣으세요.`)
    }
  }
  return out
}

/** 예전 Supabase service_role 키(JWT)인지: 가운데 부분에 "role":"service_role" */
function isServiceRoleJwt(value: string): boolean {
  const parts = value.split('.')
  if (parts.length !== 3 || !value.startsWith('eyJ')) return false
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    return /"role"\s*:\s*"service_role"/.test(json)
  } catch {
    return false
  }
}

/** 검사 결과를 사람이 읽기 좋은 문장으로 */
export function formatDeployEnvReport(result: DeployEnvResult): string {
  const lines: string[] = []
  if (result.errors.length) {
    lines.push('배포 환경변수 문제로 빌드를 멈춥니다.')
    for (const e of result.errors) lines.push(`  ✗ ${e}`)
    lines.push('  → Vercel › Project Settings › Environment Variables 에 값을 넣고 다시 배포하세요.')
    lines.push('    (Preview 배포에도 쓰려면 Preview 환경에도 체크하세요)')
  }
  for (const w of result.warnings) lines.push(`  ! ${w}`)
  return lines.join('\n')
}
