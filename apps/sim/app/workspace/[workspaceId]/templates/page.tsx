import { db } from '@sim/db'
import { settings, templateCreators, templateStars, templates, user } from '@sim/db/schema'
import { and, desc, eq, sql } from 'drizzle-orm'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'
import type { Template as WorkspaceTemplate } from '@/app/workspace/[workspaceId]/templates/templates'
import Templates from '@/app/workspace/[workspaceId]/templates/templates'
import { canAccessTemplate } from '@/lib/templates/permissions'

export const metadata: Metadata = {
  title: 'Templates',
}

interface TemplatesPageProps {
  params: Promise<{
    workspaceId: string
  }>
}

export default async function TemplatesPage({ params }: TemplatesPageProps) {
  const { workspaceId } = await params
  const session = await getSession()

  if (!session?.user?.id) {
    redirect('/login')
  }

  const permission = await verifyWorkspaceMembership(session.user.id, workspaceId)
  if (!permission) {
    redirect('/workspace')
  }

  const [currentUser, userSettings] = await Promise.all([
    db
      .select({ role: user.role })
      .from(user)
      .where(eq(user.id, session.user.id))
      .limit(1),
    db
      .select({ superUserModeEnabled: settings.superUserModeEnabled })
      .from(settings)
      .where(eq(settings.userId, session.user.id))
      .limit(1),
  ])

  const isSuperUser =
    currentUser[0]?.role === 'admin' && (userSettings[0]?.superUserModeEnabled ?? false)

  const results = await db
    .select({
      id: templates.id,
      workflowId: templates.workflowId,
      name: templates.name,
      details: templates.details,
      creatorId: templates.creatorId,
      creator: templateCreators,
      views: templates.views,
      stars: templates.stars,
      status: templates.status,
      tags: templates.tags,
      requiredCredentials: templates.requiredCredentials,
      state: templates.state,
      createdAt: templates.createdAt,
      updatedAt: templates.updatedAt,
      isStarred: sql<boolean>`CASE WHEN ${templateStars.id} IS NOT NULL THEN true ELSE false END`,
      isSuperUser: sql<boolean>`${isSuperUser}`,
    })
    .from(templates)
    .leftJoin(
      templateStars,
      and(eq(templateStars.templateId, templates.id), eq(templateStars.userId, session.user.id))
    )
    .leftJoin(templateCreators, eq(templates.creatorId, templateCreators.id))
    .orderBy(desc(templates.views), desc(templates.createdAt))

  const visibleTemplates = (
    await Promise.all(
      results.map(async (template) => {
        if (template.status === 'approved' || isSuperUser) {
          return template
        }

        const access = await canAccessTemplate(template.id, session.user.id)
        return access.allowed ? template : null
      })
    )
  ).filter((template): template is (typeof results)[number] => template !== null)

  return (
    <Templates
      initialTemplates={visibleTemplates as WorkspaceTemplate[]}
      currentUserId={session.user.id}
      isSuperUser={isSuperUser}
    />
  )
}
