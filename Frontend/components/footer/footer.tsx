import styles from './footer.module.css';
export function footer(){
    return `
<footer class="${styles.footer}">
    <span>© ${new Date().getFullYear()}
       Virtual Mechatronics Labs Nexus. Your potential, realized.
    </span>
    <span>
      <a href="#/privacy">Privacy policy</a>
      <a href="#/help">Help center ↗</a>
     /span>
</footer>`;}
