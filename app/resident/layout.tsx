import { ResidentSidebar } from '@/components/ResidentSidebar'; import { RoleGate } from '@/components/RoleGate';
export default function ResidentLayout({children}:{children:React.ReactNode}){return <RoleGate role="resident"><div className="min-h-screen flex bg-page-bg"><ResidentSidebar/><main id="main-content" className="portal-main flex-1 min-w-0">{children}</main></div></RoleGate>}
