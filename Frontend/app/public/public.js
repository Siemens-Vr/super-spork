const menu = document.querySelector('.menu-toggle');
const navigation = document.getElementById('public-navigation');
function closeMenu(){navigation?.classList.remove('open');menu?.setAttribute('aria-expanded','false');menu?.setAttribute('aria-label','Open navigation');}
menu?.addEventListener('click',()=>{const open=navigation.classList.toggle('open');menu.setAttribute('aria-expanded',String(open));menu.setAttribute('aria-label',open?'Close navigation':'Open navigation');});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&navigation?.classList.contains('open')){closeMenu();menu.focus();}});
document.addEventListener('click',event=>{if(!event.target.closest('.public-header'))closeMenu();});
matchMedia('(min-width:761px)').addEventListener('change',closeMenu);
const reducedMotion=matchMedia('(prefers-reduced-motion:reduce)');
const scene=document.querySelector('[data-depth-scene]');
if(scene){const wrapper=scene.closest('.scene-wrap');wrapper.addEventListener('pointermove',event=>{if(reducedMotion.matches||event.pointerType!=='mouse')return;const box=wrapper.getBoundingClientRect();scene.style.setProperty('--tilt-y',`${(event.clientX-box.left-box.width/2)/box.width*8}deg`);scene.style.setProperty('--tilt-x',`${-(event.clientY-box.top-box.height/2)/box.height*6}deg`);});wrapper.addEventListener('pointerleave',()=>{scene.style.setProperty('--tilt-y','0deg');scene.style.setProperty('--tilt-x','0deg');});}
const form=document.getElementById('public-contact-form');
form?.addEventListener('submit',event=>{event.preventDefault();if(!form.reportValidity())return;const values=Object.fromEntries(new FormData(form));const subject=`NEXUS enquiry: ${values.topic}`;const body=`Name: ${values.name}\nEmail: ${values.email}\nTopic: ${values.topic}\n\n${values.message}`;location.href=`mailto:${form.dataset.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;document.getElementById('contact-status').hidden=false;});
