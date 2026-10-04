import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import {
  CalendarDays,
  Flag,
  ChartNoAxesColumn,
  Settings,
  MessageSquare,
  PanelRightClose,
  ArrowUpRight,
} from 'lucide-react'
import {
  Sidebar,
  SidebarProvider,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from './components/ui/sidebar'
import { Button } from './components/ui/button'
import { TooltipProvider } from './components/ui/tooltip'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from './components/ui/sheet'
import { useWorkspace } from './WorkspaceContext'
import type { Page } from './App'
export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(
    () =>
      window.matchMedia?.(query).matches ??
      (query.includes('min-width: 1180')
        ? window.innerWidth >= 1180
        : query.includes('max-width: 959')
          ? window.innerWidth < 960
          : false),
  )
  useEffect(() => {
    const media = window.matchMedia?.(query)
    if (!media) return
    const update = () => setMatches(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [query])
  return matches
}
export function PageHeader({ page, children }: { page: Page; children?: ReactNode }) {
  return (
    <header className="workspace-header">
      <h1>{page}</h1>
      {children}
    </header>
  )
}
export function AppNavigation({ page, navigate }: { page: Page; navigate: (page: Page) => void }) {
  const { state } = useWorkspace()
  const items = [
    { name: 'Today', icon: CalendarDays },
    { name: 'Goals', icon: Flag },
    { name: 'Progress', icon: ChartNoAxesColumn },
  ] as const
  return (
    <Sidebar collapsible="icon" className="daily-navigation">
      <SidebarHeader>
        <button className="daily-brand" onClick={() => navigate('Today')} aria-label="dAIly home">
          dAIly
          <span className="brand-dot" />
        </button>
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          {items.map(({ name, icon: Icon }) => (
            <SidebarMenuItem key={name}>
              <SidebarMenuButton
                tooltip={name}
                isActive={page === name}
                aria-current={page === name ? 'page' : undefined}
                onClick={() => navigate(name)}
              >
                <Icon />
                <span>{name}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter>
        <p className="device-note">
          <span className="status-dot" />
          On your laptop
        </p>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Settings"
              isActive={page === 'Settings'}
              onClick={() => navigate('Settings')}
            >
              <Settings />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="profile-name">
          <span className="profile-initial">{state.profile.name[0]}</span>
          <span>{state.profile.name}</span>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
export function AppShell({
  page,
  navigate,
  children,
  conversation,
}: {
  page: Page
  navigate: (page: Page) => void
  children: ReactNode
  conversation: ReactNode
}) {
  const workspace = useWorkspace()
  const wide = useMedia('(min-width: 1180px)')
  const narrow = useMedia('(max-width: 959px)')
  const conversationPage = page === 'Today' || page === 'Goals'
  const active = workspace.state.sessions.find((s) => s.state !== 'finished')
  const panel = (
    <>
      <div className="conversation-top">
        <div>
          <strong>dAIly</strong>
          <span>Your day, thought through.</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close conversation"
          onClick={() => workspace.setOpen(false)}
        >
          <PanelRightClose />
        </Button>
      </div>
      {conversation}
    </>
  )
  return (
    <TooltipProvider delayDuration={250}>
      <SidebarProvider
        open={!narrow}
        style={{ '--sidebar-width': '176px', '--sidebar-width-icon': '56px' } as CSSProperties}
        className="daily-shell"
      >
        <AppNavigation page={page} navigate={navigate} />
        <main className="daily-workspace">
          <PageHeader page={page}>
            <div className="header-actions">
              {active && page !== 'Today' && (
                <Button variant="outline" size="sm" onClick={() => navigate('Today')}>
                  Focus {active.state === 'running' ? 'running' : 'needs attention'}
                  <ArrowUpRight />
                </Button>
              )}
              {conversationPage && (!wide || !workspace.open) && (
                <Button variant="outline" size="sm" onClick={() => workspace.setOpen(true)}>
                  <MessageSquare />
                  Talk to dAIly
                </Button>
              )}
            </div>
          </PageHeader>
          <div className="workspace-scroll">{children}</div>
        </main>
        {wide && (
          <aside
            className="daily-conversation"
            aria-label="dAIly conversation"
            hidden={!conversationPage || !workspace.open}
          >
            {panel}
          </aside>
        )}
        {!wide && (
          <Sheet open={conversationPage && workspace.drawerOpen} onOpenChange={workspace.setOpen}>
            <SheetContent className="conversation-sheet" showCloseButton={false}>
              <SheetHeader className="sr-only">
                <SheetTitle>dAIly conversation</SheetTitle>
                <SheetDescription>Discuss your day or a goal.</SheetDescription>
              </SheetHeader>
              {panel}
            </SheetContent>
          </Sheet>
        )}
      </SidebarProvider>
    </TooltipProvider>
  )
}
