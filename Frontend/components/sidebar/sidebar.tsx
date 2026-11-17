import styles from './sidebar.module.css';
import { escapeHtml as escape } from '../html.js';
import { icon } from '../icon/icon';
export type PortalRole = 'applicant' | 'admin' | 'trainer' | 'employer';
export type NavigationLink = readonly [path: string, label: string, icon: string];
export interface SidebarProps { role: PortalRole; links: readonly NavigationLink[]; route: string; helpText?: string; showSignOut?: boolean; id?: string; actionAttribute?: 'data-auth-action' | 'data-admin-action'; helpTitle?: string }
export function sidebar({role, links, route, helpText, showSignOut=true, id='workspace-sidebar', actionAttribute='data-auth-action', helpTitle='Your next chapter starts here.'}: SidebarProps) {
 return `<aside id="${escape(id)}" class="sidebar ${styles.sidebar}">
 <div class="${styles.brandRow}"><a class="${styles.brand}" href="/dashboard"><span class="mark">N</span><span>VML NEXUS<small>VIRTUAL MECHATRONICS LABS</small></span></a>${role==='admin'?'<button type="button" class="icon-button admin-close-nav" data-admin-action="close-menu" aria-label="Close navigation">×</button>':''}</div>
 <div class="${styles.label}">${escape(role.toUpperCase())} WORKSPACE</div>
 <nav aria-label="Main navigation">
 ${links.map(([path,label,i])=>`<a class="${styles.link} ${route===path?styles.active:''}" ${route===path?'aria-current="page"':''} href="/${escape(path)}">${icon(i)}${escape(label)}</a>`).join('')}</nav>
 <div class="${styles.bottom}">${helpText?`<div class="${styles.help}"><strong>${escape(helpTitle)}</strong>${escape(helpText)}${role==='applicant'?'<a href="/help">Visit the help center ↗</a>':''}</div>`:''}<a class="${styles.link} ${route==='settings'?styles.active:''}" ${route==='settings'?'aria-current="page"':''} href="/settings">${icon('settings')}${role==='admin'?'My account':'Account settings'}</a>${showSignOut?`<button type="button" class="${styles.link}" ${actionAttribute}="logout">${icon('logout')}Sign out</button>`:''}</div></aside>`;
}
