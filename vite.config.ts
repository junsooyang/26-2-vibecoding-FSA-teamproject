import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { checkDeployEnv, formatDeployEnvReport, isStrictDeployBuild } from './scripts/deployEnv'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  if (command === 'build') {
    // .env 파일 + 실제 환경변수(Vercel 설정값 포함)에서 VITE_ 로 시작하는 값을 읽는다
    const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...pickVite(process.env) }
    const strict = isStrictDeployBuild(process.env)
    const result = checkDeployEnv(env, { strict })
    const report = formatDeployEnvReport(result)
    if (result.errors.length) throw new Error('\n' + report)
    if (report) {
      console.warn(
        `\n[deploy-env] ${strict ? '' : '(로컬 빌드라 멈추지 않음) '}확인할 점:\n${report}\n`,
      )
    }
  }

  return {
    plugins: [react()],
    server: {
      port: 5173,
    },
  }
})

function pickVite(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) if (k.startsWith('VITE_') && v !== undefined) out[k] = v
  return out
}
