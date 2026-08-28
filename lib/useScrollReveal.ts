import { useEffect, useRef } from 'react';

export function useScrollReveal(options?: IntersectionObserverInit) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px', ...options }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return ref;
}

// Observe ALL .reveal elements on the page (called once at root)
export function initScrollReveal() {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: '0px 0px -50px 0px' }
  );

  document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-scale')
    .forEach(el => observer.observe(el));

  return () => observer.disconnect();
}
