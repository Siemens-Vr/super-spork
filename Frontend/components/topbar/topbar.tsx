import styles from './topbar.module.css';
import { escapeHtml as escape } from '../html.js';
import { icon } from '../icon/icon';
import type { PortalRole } from '../sidebar/sidebar';
export interface TopbarProps {role: PortalRole; title: string; name: string; demo?: boolean}
export function topbar({role,title,name,demo=false}: TopbarProps){
 const label=role.charAt(0).toUpperCase()+role.slice(1);
 return `<header class="${styles.topbar}"><div class="inline-actions"><button class="icon-button ${styles.menu}" aria-label="Toggle navigation" aria-controls="workspace-sidebar" aria-expanded="false" data-action="menu">${icon('menu')}</button><span class="${styles.breadcrumb}">${escape(label)} workspace &nbsp; / &nbsp; <b>${escape(title)}</b></span></div><div class="${styles.actions}">${demo?'<span class="demo">DEMO DASHBOARD</span>':''}<button class="icon-button" data-action="notifications" aria-label="Notifications">${icon('bell')}</button><a class="${styles.user}" href="#/settings"><span class="avatar">${escape(name.split(' ').map(s=>s[0]).join('').slice(0,2))}</span><div>${escape(name)}<small>${escape(label)}</small></div></a></div></header>`;
}
