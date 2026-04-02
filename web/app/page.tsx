import AuthLoginPanel from '@/components/auth/AuthLoginPanel'

export default function HomePage() {
  return <AuthLoginPanel title="西安分公司" layout="split" titlePlacement="center" defaultRedirect="/app/workflow" />
}
