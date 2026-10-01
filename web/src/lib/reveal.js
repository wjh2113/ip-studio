/* 营销页的滚动渐入。只给内容块，首屏不加——首屏该立刻就在那儿。
 * 幅度压得很小（见 landing.css / promo.css），大开大合的动效只会让人觉得虚。
 * 先给 <html> 挂 .js-anim 才生效：脚本没跑到这儿，内容照常显示。 */
export function reveal(selector, { cls = 'reveal', step = 60 } = {}) {
  const targets = [...document.querySelectorAll(selector)].filter((n) => !n.classList.contains(cls));
  if (!targets.length || typeof IntersectionObserver !== 'function') return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  document.documentElement.classList.add('js-anim');
  targets.forEach((n) => n.classList.add(cls));

  const io = new IntersectionObserver((es) => {
    es.forEach((e, i) => {
      if (!e.isIntersecting) return;
      setTimeout(() => e.target.classList.add('in'), i * step);   // 同屏的错开一点，一起蹦出来显得廉价
      io.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -8% 0px' });
  targets.forEach((n) => io.observe(n));

  // 兜底：只补「已经在视口里却没亮」的。无差别全点亮会把动效提前用掉
  const sweep = () => {
    let left = 0;
    targets.forEach((n) => {
      if (n.classList.contains('in')) return;
      if (n.getBoundingClientRect().top < innerHeight) n.classList.add('in');
      else left += 1;
    });
    if (!left) removeEventListener('scroll', sweep);
  };
  addEventListener('scroll', sweep, { passive: true });
  setTimeout(sweep, 1500);
}
