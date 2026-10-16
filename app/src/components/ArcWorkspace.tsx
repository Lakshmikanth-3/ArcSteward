'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowUpRight, Blocks, Bot, FlaskConical, Code2, LayoutDashboard, Menu, ShieldCheck, X } from 'lucide-react';
import { network } from '@/lib/arc/config';
import { repositoryUrl } from '@/lib/arc/project';

const navigation = [
  { href: '/arc', label: 'Vault workspace', icon: LayoutDashboard },
  { href: '/testnet', label: 'Testnet', icon: FlaskConical },
  { href: '/infrastructure', label: 'Infrastructure', icon: Blocks },
  { href: '/security', label: 'Security proof', icon: ShieldCheck },
  { href: '/developers', label: 'Developers', icon: Bot },
];

export default function ArcWorkspace({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const chain = network(pathname === '/testnet' ? 'testnet' : process.env.NEXT_PUBLIC_ARC_NETWORK ?? 'mainnet');
  const current = navigation.find(item => item.href === pathname);
  return <div className="arc-workspace">
    <a className="arc-skip" href="#workspace-content">Skip to workspace</a>
    <aside className={`arc-rail${open ? ' is-open' : ''}`}>
      <Link href="/" className="arc-brand" onClick={() => setOpen(false)}><span className="arc-brand-mark"><ShieldCheck size={21} /></span><span>ArcSteward<small>ON ARC</small></span></Link>
      <p className="arc-nav-label">WORKSPACE</p>
      <nav aria-label="Arc workspace navigation">{navigation.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setOpen(false)} aria-current={pathname === href ? 'page' : undefined} className={`arc-nav-item${pathname === href ? ' active' : ''}`}><Icon size={18} aria-hidden="true" />{label}</Link>)}</nav>
      <div className="arc-rail-note"><span className="arc-eyebrow">OWNER CONTROL</span><strong>Permission before payment.</strong><p>Your vault enforces the budget, recipients and expiry.</p><Link href={`${pathname === '/testnet' ? '/testnet' : '/arc'}#arc-revoke`} onClick={() => setOpen(false)}>Manage permissions <ArrowUpRight size={14} /></Link></div>
      <a className="arc-source" href={repositoryUrl} target="_blank" rel="noreferrer"><Code2 size={17} /> Source repository <ArrowUpRight size={14} /></a>
      <span className="arc-rail-foot">Open source · MIT</span>
    </aside>
    <div className="arc-workspace-body">
      <header className="arc-toolbar"><div className="arc-toolbar-title"><button className="arc-menu-button" aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X size={20} /> : <Menu size={20} />}</button><span>Workspace <span className="arc-breadcrumb">/ {current?.label}</span></span></div><span className="arc-network-pill"><span aria-hidden="true" />{chain.name} · {chain.id}</span></header>
      <main id="workspace-content" className="arc-workspace-content">{children}</main>
      <footer className="arc-workspace-footer"><span>ArcSteward / programmable USDC payments</span><Link href="/security">Security proof <ArrowUpRight size={13} /></Link></footer>
    </div>
  </div>;
}
