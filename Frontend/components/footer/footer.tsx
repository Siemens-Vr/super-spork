import styles from './footer.module.css';
import { config } from '../../lib/config.js';
import { escapeHtml as escape } from '../html.js';
import type { PortalRole } from '../sidebar/sidebar';

export function footer(role: PortalRole = 'applicant'){
    const base = role === 'employer' ? config.applicantUrl : '';
    const page = (route: string) => escape(base ? new URL('/' + route, base).href : '#/' + route);
    return `
<footer class="${styles.footer}">
    <span>© ${new Date().getFullYear()}
       Virtual Mechatronics Labs Nexus. Your potential, realized.
    </span>
    <span>
      <a href="${page('privacy')}">Privacy policy</a>
      <a href="${page('help')}">Help center ↗</a>
    </span>
</footer>`;}
