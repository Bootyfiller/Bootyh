import { supabase } from './supabase-client.js';

const signupCard = document.querySelector('#signup-card');
const loginCard = document.querySelector('#login-card');
const previewButtons = [...document.querySelectorAll('[data-view]')];
const resetDialog = document.querySelector('#reset-dialog');
const mainUrl = new URL('main.html', location.href).href;

function setBusy(form, busy) {
  const button = form.querySelector('button[type="submit"]');
  if (button) button.disabled = busy;
  form.setAttribute('aria-busy', String(busy));
}
function statusFor(id, message) {
  const target = document.querySelector(id);
  if (target) target.textContent = message;
}
function authErrorMessage(error, fallback) {
  const message = String(error?.message || '');
  if (/network|failed to fetch|fetch failed|load failed/i.test(message)) {
    return 'Cannot reach the Supabase project. Verify its Project URL in Supabase Settings > API and make sure the project is active.';
  }
  return message || fallback;
}
function showView(view) {
  const signup = view === 'signup';
  signupCard.hidden = !signup;
  loginCard.hidden = signup;
  statusFor('#signup-status', '');
  statusFor('#login-status', '');
  previewButtons.forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  history.replaceState(null, '', signup ? '#signup' : '#login');
}

previewButtons.forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
document.querySelectorAll('[data-switch]').forEach(link => link.addEventListener('click', event => {
  event.preventDefault();
  showView(link.dataset.switch);
}));

document.querySelector('#signup-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const username = String(values.get('username') || '').trim();
  const email = String(values.get('email') || '').trim().toLowerCase();
  const password = String(values.get('password') || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return statusFor('#signup-status', 'Enter a valid email address.');
  if (password.length < 8) return statusFor('#signup-status', 'Use at least 8 characters for your password.');
  setBusy(form, true);
  statusFor('#signup-status', 'Creating your account…');
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username } },
    });
    if (error) throw error;
    if (data.session) {
      location.replace(mainUrl);
      return;
    }
    showView('login');
    statusFor('#login-status', 'Check your email to confirm your account, then sign in here.');
  } catch (error) {
    statusFor('#signup-status', authErrorMessage(error, 'We could not create your account. Try again.'));
  } finally {
    setBusy(form, false);
  }
});

document.querySelector('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const email = String(values.get('email') || '').trim().toLowerCase();
  const password = String(values.get('password') || '');
  if (!email || !password) return statusFor('#login-status', 'Enter your email and password.');
  setBusy(form, true);
  statusFor('#login-status', 'Signing in…');
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    location.replace(mainUrl);
  } catch (error) {
    statusFor('#login-status', authErrorMessage(error, 'We could not sign you in. Check your details and try again.'));
  } finally {
    setBusy(form, false);
  }
});

document.querySelector('#forgot-link').addEventListener('click', () => {
  statusFor('#reset-status', '');
  document.querySelector('#reset-form').reset();
  resetDialog.showModal();
  requestAnimationFrame(() => resetDialog.querySelector('input').focus({ preventScroll: true }));
});
document.querySelector('#reset-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const email = String(new FormData(form).get('email') || '').trim().toLowerCase();
  if (!email) return statusFor('#reset-status', 'Enter the email address on your account.');
  setBusy(form, true);
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: new URL('main.html?password-reset=1', location.href).href,
    });
    if (error) throw error;
    statusFor('#reset-status', 'If an account matches that email, a password reset link is on its way.');
  } catch (error) {
    statusFor('#reset-status', authErrorMessage(error, 'We could not send the reset email. Try again.'));
  } finally {
    setBusy(form, false);
  }
});
resetDialog.addEventListener('click', event => {
  if (event.target === resetDialog) resetDialog.close();
});

const { data: { session } } = await supabase.auth.getSession();
if (session) location.replace(mainUrl);
else showView(location.hash === '#login' ? 'login' : 'signup');
