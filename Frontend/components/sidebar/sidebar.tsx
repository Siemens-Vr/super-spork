import styles from './sidebar.module.css';
import { escapeHtml as escape } from '../html.js';
import { vmlLogo } from '../brand.js';
import { icon } from '../icon/icon';
export type PortalRole = 'applicant' | 'admin' | 'trainer' | 'employer';
export type NavigationLink = readonly [path: string, label: string, icon: string];
export interface SidebarProps { role: PortalRole; links: readonly NavigationLink[]; route: string; helpText?: string; showSignOut?: boolean }
export function sidebar({role, links, route, helpText, showSignOut=true}: SidebarProps) {
 return `<aside id="workspace-sidebar" class="sidebar ${styles.sidebar}">
 <a class="${styles.brand}" href="#/dashboard">
 <img src="${vmlLogo}" alt="Virtual Mechatronics Lab — Revolutionizing Education in Africa" width="752" height="401">
 <span>NEXUS</span>
 </a>
 <div class="${styles.label}">
 ${escape(role.toUpperCase())} WORKSPACE
 </div>
 <nav aria-label="Main navigation">
 ${links.map(([path,label,i])=>`<a class="${styles.link} ${route===path?styles.active:''}" ${route===path?'aria-current="page"':''} href="#/${escape(path)}">${icon(i)}${escape(label)}</a>`).join('')}</nav><div class="${styles.bottom}">${helpText?`<div class="${styles.help}">${escape(helpText)}<a href="#/help">Need a little guidance? ↗</a></div>`:''}<a class="${styles.link} ${route==='settings'?styles.active:''}" href="#/settings">${icon('settings')}Account settings</a>${showSignOut?`<button class="${styles.link}" data-auth-action="logout">${icon('logout')}Sign out</button>`:''}</div></aside>`;
}
