import Lenis from "lenis";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

// One orchestrated idea: blocks settle into place as you reach them, numbers count up and stop
// dead. Nothing bounces. With reduced motion the resting state is already the final state.
export function initMotion(): void {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  gsap.registerPlugin(ScrollTrigger);

  const lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);

  gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((el, i) => {
    gsap.from(el, {
      y: 16, opacity: 0, duration: 0.6, ease: "power2.out", delay: (i % 4) * 0.06,
      scrollTrigger: { trigger: el, start: "top 88%", once: true },
    });
  });

  gsap.utils.toArray<HTMLElement>("[data-count]").forEach((el) => {
    const end = Number(el.dataset.count);
    const decimals = Number(el.dataset.decimals ?? 0);
    const o = { v: 0 };
    gsap.to(o, {
      v: end, duration: 1.1, ease: "power1.out",
      scrollTrigger: { trigger: el, start: "top 88%", once: true },
      onUpdate: () => { el.textContent = o.v.toFixed(decimals); },
    });
  });

  document.querySelectorAll<HTMLAnchorElement>(`a[href^="#"]`).forEach((a) => {
    a.addEventListener("click", (e) => {
      const target = document.querySelector<HTMLElement>(a.getAttribute("href") ?? "");
      if (!target) return;
      e.preventDefault();
      lenis.scrollTo(target, { offset: -72 });
    });
  });
}
