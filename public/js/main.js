import { DAY_NAMES, formatTime, getOpenStatus, zonedClock } from './hours.js';

document.documentElement.classList.add('js');

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ---------- Header: solid background after scrolling ---------- */
const header = $('[data-header]');
const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 24);
onScroll();
window.addEventListener('scroll', onScroll, { passive: true });

/* ---------- Mobile navigation ---------- */
const nav = $('#site-nav');
const toggle = $('[data-nav-toggle]');

function setNav(open) {
  nav.classList.toggle('is-open', open);
  toggle.setAttribute('aria-expanded', String(open));
  document.body.style.overflow = open ? 'hidden' : '';
}
toggle.addEventListener('click', () => setNav(toggle.getAttribute('aria-expanded') !== 'true'));
nav.addEventListener('click', (e) => { if (e.target.closest('a')) setNav(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('is-open')) setNav(false); });

/* ---------- Active nav link while scrolling ---------- */
const navLinks = $$('.nav ul a');
const sections = navLinks.map((a) => $(a.getAttribute('href'))).filter(Boolean);
const sectionObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    navLinks.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === `#${entry.target.id}`));
  }
}, { rootMargin: '-45% 0px -50% 0px' });
sections.forEach((s) => sectionObserver.observe(s));

/* ---------- Reveal on scroll ---------- */
const revealObserver = new IntersectionObserver((entries, obs) => {
  for (const entry of entries) {
    if (entry.isIntersecting) {
      entry.target.classList.add('is-visible');
      obs.unobserve(entry.target);
    }
  }
}, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
$$('.reveal').forEach((el, i) => {
  el.style.transitionDelay = `${(i % 3) * 80}ms`;
  revealObserver.observe(el);
});

/* ---------- Opening hours + live open/closed status ---------- */
async function initHours() {
  let business;
  try {
    const res = await fetch('/data/business.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.statusText);
    business = await res.json();
  } catch {
    return; // keep the static fallback text
  }

  const { hours, timezone } = business;

  const render = () => {
    const status = getOpenStatus(hours, timezone);
    $$('[data-status]').forEach((pill) => {
      pill.classList.toggle('is-open', status.isOpen);
      pill.classList.toggle('is-closed', !status.isOpen);
      $('[data-status-label]', pill).textContent = status.label;
    });
  };
  render();
  setInterval(render, 60_000);

  // Hours table, starting Monday, with today highlighted (in shop time).
  const list = $('[data-hours]');
  const today = zonedClock(new Date(), timezone).day;
  list.replaceChildren(
    ...[1, 2, 3, 4, 5, 6, 0].map((day) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      const time = document.createElement('span');
      name.textContent = DAY_NAMES[day];
      time.textContent = hours[day] ? `${formatTime(hours[day].open)} – ${formatTime(hours[day].close)}` : 'Closed';
      if (day === today) li.classList.add('is-today');
      li.append(name, time);
      return li;
    }),
  );
}
initHours();

/* ---------- Gallery lightbox ---------- */
const dialog = $('[data-lightbox-dialog]');
const dialogImg = $('[data-lightbox-img]');

$$('[data-lightbox]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const img = $('img', btn);
    dialogImg.src = btn.dataset.full;
    dialogImg.alt = img.alt;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else window.open(btn.dataset.full, '_blank');
  });
});
$('[data-lightbox-close]').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

/* ---------- Contact form ---------- */
const form = $('[data-contact-form]');
const statusEl = $('[data-form-status]');

function showErrors(errors = {}) {
  $$('[data-error-for]', form).forEach((el) => {
    const msg = errors[el.dataset.errorFor] || '';
    el.textContent = msg;
    el.closest('.field').classList.toggle('has-error', Boolean(msg));
  });
}

function validate(data) {
  const errors = {};
  if (data.name.trim().length < 2) errors.name = 'Please enter your name.';
  const contact = data.contact.trim();
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contact);
  const isPhone = /^[+()\-.\s\d]{7,20}$/.test(contact);
  if (!isEmail && !isPhone) errors.contact = 'Enter a valid email or phone number.';
  if (data.message.trim().length < 5) errors.message = 'Tell us a little more (at least 5 characters).';
  return errors;
}

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = `form-status${kind ? ` is-${kind}` : ''}`;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  const errors = validate(data);
  showErrors(errors);
  if (Object.keys(errors).length) {
    form.querySelector('.has-error input, .has-error textarea')?.focus();
    return;
  }

  const button = $('button[type="submit"]', form);
  button.disabled = true;
  setStatus('Sending…');

  try {
    const res = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      form.reset();
      setStatus("Thanks! Your message is in — we'll get back to you soon.", 'success');
    } else if (res.status === 422) {
      showErrors(body.errors);
      setStatus('');
    } else {
      throw Object.assign(new Error('Request failed'), { userMessage: body.error });
    }
  } catch (err) {
    setStatus(err.userMessage || "Couldn't send right now. Please call us at (650) 763-1332.", 'error');
  } finally {
    button.disabled = false;
  }
});

/* ---------- Footer year ---------- */
$('[data-year]').textContent = new Date().getFullYear();
