'use client';

import { useEffect } from 'react';

// Landing motion: section reveals, count-ups, picture parallax, the journey
// carousel and the agent ledger replay. Content stays visible without JS.
export default function CodexMotion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.codex');
    if (!root) return;
    root.classList.add('js');
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cleanups: (() => void)[] = [];
    const listen = (target: Window, type: string, fn: () => void) => { target.addEventListener(type, fn, { passive: true }); cleanups.push(() => target.removeEventListener(type, fn)); };

    // Reveals and count-ups.
    const count = (el: HTMLElement) => {
      const to = Number(el.dataset.to), dec = Number(el.dataset.dec ?? 0), t0 = performance.now();
      if (still || to === 0) { el.textContent = to.toFixed(dec); return; }
      const tick = (now: number) => { const k = Math.min(1, (now - t0) / 1200); el.textContent = (to * (1 - Math.pow(1 - k, 3))).toFixed(dec); if (k < 1) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    };
    const reveal = new IntersectionObserver(entries => entries.forEach(e => {
      if (!e.isIntersecting) return;
      e.target.classList.add('in'); reveal.unobserve(e.target);
      if (e.target.classList.contains('count')) count(e.target as HTMLElement);
    }), { rootMargin: '0px 0px -12% 0px' });
    root.querySelectorAll('[data-r], .count, #marchfig').forEach(el => reveal.observe(el));
    cleanups.push(() => reveal.disconnect());

    // Parallax on the paintings.
    const pars = [...root.querySelectorAll<HTMLElement>('.par')];
    const parallax = () => { for (const img of pars) { const r = img.parentElement!.getBoundingClientRect(); img.style.transform = `translateY(${((r.top + r.height / 2 - innerHeight / 2) / innerHeight) * -50}px)`; } };

    // Journey carousel: the section is as tall as the sideways travel.
    const section = root.querySelector<HTMLElement>('#journey')!, track = section.querySelector<HTMLElement>('.hj-track')!, cards = [...track.children] as HTMLElement[];
    const wide = window.matchMedia('(min-width: 901px)');
    let travel = 0;
    const carousel = () => {
      if (!wide.matches) return;
      const p = Math.min(1, Math.max(0, -section.getBoundingClientRect().top / Math.max(1, travel * 2.2)));
      track.style.transform = `translateX(${-p * travel}px)`;
      if (still) return;
      for (const c of cards) { const r = c.getBoundingClientRect(); const d = Math.min(1, Math.abs(r.left + r.width / 2 - innerWidth / 2) / (innerWidth * 0.6)); c.style.opacity = String(1 - d * 0.7); c.style.transform = `scale(${1 - d * 0.12})`; }
    };
    const layout = () => {
      if (!wide.matches) { section.style.height = ''; track.style.transform = ''; cards.forEach(c => { c.style.opacity = ''; c.style.transform = ''; }); return; }
      travel = Math.max(0, track.scrollWidth - innerWidth);
      section.style.height = `${innerHeight + travel * 2.2}px`;
      carousel();
    };
    let ticking = false;
    listen(window, 'scroll', () => { if (ticking) return; ticking = true; requestAnimationFrame(() => { ticking = false; carousel(); if (!still) parallax(); }); });
    listen(window, 'resize', layout);
    document.fonts?.ready.then(layout);
    layout(); if (!still) parallax();

    // Agent ledger replay of the mainnet run.
    const steps = [...root.querySelectorAll<HTMLElement>('#steps .entry')];
    const meter = root.querySelector<HTMLElement>('#meter')!, left = root.querySelector<HTMLElement>('#left')!, paid = root.querySelector<HTMLElement>('#paid')!, status = root.querySelector<HTMLElement>('#status')!, button = root.querySelector<HTMLButtonElement>('#replay')!;
    let timers: number[] = [];
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, still ? 0 : ms));
    const money = (b: number, out: number) => { meter.style.width = `${(b / 0.07) * 100}%`; left.textContent = `${b.toFixed(2)} / 0.07 USDC`; paid.textContent = `paid ${out.toFixed(2)}`; };
    const reset = () => { timers.forEach(clearTimeout); timers = []; steps.forEach(s => { s.classList.remove('on', 'now'); s.querySelectorAll('.checks span').forEach(c => c.classList.remove('pass', 'fail')); }); money(0.07, 0); };
    const run = () => {
      reset(); button.textContent = '↻ Replay'; status.textContent = '● running · Arc mainnet';
      let t = 300, b = 0.07, out = 0;
      for (const step of steps) {
        at(t, () => { steps.forEach(s => s.classList.remove('now')); step.classList.add('on', 'now'); });
        const checks = [...step.querySelectorAll<HTMLElement>('.checks span')];
        checks.forEach((c, i) => at(t + 300 + i * 240, () => c.classList.add(c.hasAttribute('data-x') ? 'fail' : 'pass')));
        t += 300 + checks.length * 240;
        if (step.dataset.pay) { const p = Number(step.dataset.pay); at(t, () => { b -= p; out += p; money(b, out); }); }
        t += 1050;
      }
      at(t, () => { steps.forEach(s => s.classList.remove('now')); status.textContent = 'Done · 2 paid · 3 refused · 0.00 USDC lost'; });
    };
    button.addEventListener('click', run);
    cleanups.push(() => { button.removeEventListener('click', run); timers.forEach(clearTimeout); });
    const start = new IntersectionObserver(([e]) => { if (e.isIntersecting) { run(); start.disconnect(); } }, { threshold: 0.15 });
    start.observe(root.querySelector('#steps')!);
    cleanups.push(() => start.disconnect());

    return () => cleanups.forEach(fn => fn());
  }, []);
  return null;
}
