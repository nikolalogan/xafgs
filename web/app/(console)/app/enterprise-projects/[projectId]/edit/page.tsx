import { redirect } from 'next/navigation'

export default async function EnterpriseProjectEditPageRedirect({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  redirect(`/app/enterprise-projects/${projectId}`)
}
