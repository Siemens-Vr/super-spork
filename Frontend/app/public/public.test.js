import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPublicPage, contactEmail } from './pages.mjs';
test('public pages share navigation and link to the existing auth flow',()=>{
 for(const route of ['/','/about','/contact']){
  const html=renderPublicPage(route);assert.ok(html.includes('<main id="main-content">'));assert.ok(html.includes('href="/login"'));assert.ok(html.includes('href="/signup"'));assert.ok(html.includes('/app/public/public.css'));assert.ok(!html.includes('/dist/app.js'));
 }
});
test('contact page prepares an email and never promises a delivered message',()=>{
 const html=renderPublicPage('/contact');assert.equal(contactEmail,'vr.africa@dkut.ac.ke');assert.ok(html.includes('mailto:vr.africa@dkut.ac.ke'));assert.ok(html.includes('You’ll review and send it there.'));assert.ok(html.includes('id="public-contact-form"'));assert.ok(html.includes('minlength="10"'));
});
