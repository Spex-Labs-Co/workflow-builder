import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { canAccessTemplate } from '@/lib/templates/permissions'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'
import TemplateDetails from '@/app/templates/[id]/template'

export const metadata: Metadata = {
  title: 'Template',
}

interface TemplatePageProps {
  params: Promise<{
    workspaceId: string
    id: string
  }>
}

export default async function TemplatePage({ params }: TemplatePageProps) {
  const { workspaceId, id } = await params
  const session = await getSession()

  if (!session?.user?.id) {
    redirect('/login')
  }

  const permission = await verifyWorkspaceMembership(session.user.id, workspaceId)
  if (!permission) {
    redirect('/workspace')
  }

  const access = await canAccessTemplate(id, session.user.id)
  if (!access.allowed) {
    notFound()
  }

  return <TemplateDetails isWorkspaceContext />
}
