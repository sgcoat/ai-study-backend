import { readFile } from 'node:fs/promises';

// Sends exactly one real auth email. Run only after the recipient authorizes it.
// Credentials and OTP values are never read from an email or logged here.
const args = process.argv.slice(2);
const emailIndex = args.indexOf('--email');
const email = emailIndex >= 0 ? args[emailIndex + 1] : undefined;
if (!args.includes('--send') || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
  console.error('Usage: SUPABASE_PUBLISHABLE_KEY=<publishable-key> node supabase/scripts/request-login-code.mjs --email <authorized-recipient> --send');
  process.exit(1);
}
const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? '';
if (!key.startsWith('sb_publishable_')) {
  console.error('SUPABASE_PUBLISHABLE_KEY must be the project publishable key. Do not use a secret or service-role key.');
  process.exit(1);
}
const { supabase } = JSON.parse(await readFile(new URL('../projects.json', import.meta.url), 'utf8'));
if (supabase.url !== `https://${supabase.projectRef}.supabase.co` || !/^[a-z]{20}$/.test(supabase.projectRef)) {
  console.error('Verify supabase/projects.json before sending.');
  process.exit(1);
}

try {
  const response = await fetch(`${supabase.url}/auth/v1/otp`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.toLowerCase(), create_user: true }),
    signal: AbortSignal.timeout(30000),
  });
  if (response.ok) {
    console.log(`Supabase accepted the login email request (HTTP ${response.status}). Check the recipient inbox/spam folder; delivery is not yet confirmed.`);
  } else {
    const payload = await response.json().catch(() => ({}));
    const code = typeof payload.error_code === 'string' && /^[a-z0-9_]{1,100}$/.test(payload.error_code) ? payload.error_code : 'request_failed';
    console.error(`Supabase did not accept the email request (HTTP ${response.status}, ${code}). No automatic retry was made.`);
    process.exitCode = 1;
  }
} catch {
  console.error('The email request could not be confirmed. It may have reached Supabase; do not automatically resend. Check the inbox and Auth logs first.');
  process.exitCode = 1;
}
