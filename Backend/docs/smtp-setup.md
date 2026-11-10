# Real inbox email setup

The development configuration sends mail to Mailpit, not to external inboxes. View local messages at http://localhost:8025. The notification worker is required for delivery.

To configure your own SMTP provider without changing application code:

1. Obtain the provider's SMTP host, port (587 STARTTLS or 465 implicit TLS), username, SMTP credential, and authorized sender email. A provider may require an app password or a separate SMTP credential rather than your ordinary account password.
2. In a local PowerShell terminal from `Backend`, run:

   ```powershell
   & ./scripts/setup-smtp.ps1
   ```

3. Enter the values locally. The credential prompt is hidden. The script verifies SMTP authentication before updating the ignored `Backend/.env`. Credentials travel to the helper through stdin, never command arguments or log output. Do not commit or share `.env`.
4. Stop and restart both the API and the worker so they load the new configuration. Start the worker in a separate terminal with `npm run worker`.
5. Request a new verification code with the frontend resend button. Previously sent Mailpit messages will not be sent again automatically. Check your provider delivery logs if a fresh message is accepted but does not reach the inbox.

SMTP connection/authentication verification does not send a test message, validate sender authorization, or guarantee delivery. Complete the provider's sender/domain authorization requirements. The backend already generates six-digit codes and queues encrypted email messages; no authentication implementation changes are needed.
