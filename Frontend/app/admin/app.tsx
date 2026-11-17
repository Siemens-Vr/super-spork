import { dashboardLayout } from '../../components/dashboard-layout/dashboard-layout';
import { escapeHtml } from '../../components/html.js';
import { navigation } from './navigation';
function render(){
 const route=location.hash.replace(/^#\//,'')||'dashboard';
 const title=navigation.find(([path])=>path===route)?.[1]||({settings:'Account settings',help:'Help center',privacy:'Privacy policy'} as Record<string,string>)[route]||'Page not found';
 document.getElementById('app')!.innerHTML=dashboardLayout({role:'admin',links:navigation,route,title,name:'Admin preview',showSignOut:false,body:`<div class="page-heading"><h1>${escapeHtml(title)}</h1></div><section class="card"><div class="card-body"><p>This admin workspace is reserved for a later implementation phase.</p><div class="notice mt" role="status">Preview only. This page has no backend connection or account access.</div></div></section>`});
}
document.addEventListener('click',event=>{
 const button=(event.target as Element).closest<HTMLButtonElement>('[data-action="menu"]');
 if(button){const open=document.querySelector('.sidebar')?.classList.toggle('open');button.setAttribute('aria-expanded',String(!!open));}
 if((event.target as Element).closest('[data-action="notifications"]'))window.alert('Notifications are not connected in this preview.');
});
window.addEventListener('hashchange',render);render();
