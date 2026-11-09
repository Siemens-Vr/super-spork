/* global document, fetch, location */
document.querySelector('#login').addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = document.querySelector('#status');
  try {
    const csrf = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin' }).then((r) =>
      r.json(),
    );
    const response = await fetch('/api/v1/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.data.csrfToken },
      body: JSON.stringify({
        email: document.querySelector('#email').value,
        password: document.querySelector('#password').value,
      }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message ?? 'Sign-in failed');
    if (body.data.mfaRequired)
      throw new Error('Use an applicant account. Administrator MFA is available in Swagger.');
    location.assign('/dev/assessments');
  } catch (error) {
    status.textContent = error.message;
  }
});
