import styles from './dashboard-layout.module.css';
import { sidebar, type SidebarProps } from '../sidebar/sidebar';
import { topbar } from '../topbar/topbar';
import { footer } from '../footer/footer';
export interface DashboardLayoutProps extends SidebarProps {name: string; title?: string; body: string; demo?: boolean}
// body is trusted page markup; user-controlled labels are escaped in child components.
export function dashboardLayout(props: DashboardLayoutProps){
 const title=props.title||props.links.find(([path])=>path===props.route)?.[1]||'My account';
 return sidebar(
    {...props,helpText:props.helpText??
        (props.role==='applicant'?
            'Every step brings you closer. Build your skills. Shape your future.'
            :undefined)
        }
    )+`<main class="${styles.main}">
       ${topbar({...props,title})}
    <div class="${styles.content}">
       ${props.body}${footer()}
     </div>
</main>`;
}
