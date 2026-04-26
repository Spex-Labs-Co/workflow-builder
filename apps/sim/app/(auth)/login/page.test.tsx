import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockGetOAuthProviderStatus = vi.fn()

vi.mock('@/app/(auth)/components/oauth-provider-checker', () => ({
  getOAuthProviderStatus: mockGetOAuthProviderStatus,
}))

vi.mock('@/app/(auth)/components/auth-background', () => ({
  default: ({ children, className }: { children: unknown; className?: string }) => (
    <div data-testid='auth-background' data-class-name={className}>
      {children}
    </div>
  ),
}))

vi.mock('@/app/(auth)/login/login-form', () => ({
  default: (props: {
    githubAvailable: boolean
    googleAvailable: boolean
    isProduction: boolean
  }) => <div data-testid='login-form' data-props={JSON.stringify(props)} />,
}))

vi.mock('@/app/(auth)/login/spex-login-form', () => ({
  default: () => <div data-testid='spex-login-form' />,
}))

afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe('LoginPage', () => {
  it('renders the Spex login form when SPEX_AUTH_ONLY is enabled', async () => {
    vi.doMock('@/lib/core/config/env', () => ({
      env: {
        SPEX_AUTH_ONLY: true,
      },
    }))

    const { default: LoginPage } = await import('./page')

    const html = renderToStaticMarkup(await LoginPage())

    expect(html).toContain('data-testid="spex-login-form"')
    expect(mockGetOAuthProviderStatus).not.toHaveBeenCalled()
  })

  it('renders the standard login form when SPEX_AUTH_ONLY is disabled', async () => {
    mockGetOAuthProviderStatus.mockResolvedValue({
      githubAvailable: true,
      googleAvailable: false,
      isProduction: true,
    })

    vi.doMock('@/lib/core/config/env', () => ({
      env: {
        SPEX_AUTH_ONLY: false,
      },
    }))

    const { default: LoginPage } = await import('./page')

    const html = renderToStaticMarkup(await LoginPage())

    expect(mockGetOAuthProviderStatus).toHaveBeenCalledTimes(1)
    expect(html).toContain('data-testid="login-form"')
    expect(html).toContain(
      '&quot;githubAvailable&quot;:true,&quot;googleAvailable&quot;:false,&quot;isProduction&quot;:true'
    )
  })
})
