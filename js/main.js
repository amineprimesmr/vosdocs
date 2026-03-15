/**
 * Carvinguard - Certificat de situation administrative détaillée (NON GAGE)
 * Script principal - Animations et interactions
 */

document.addEventListener('DOMContentLoaded', () => {
  initScrollToTop();
  initCarousel();
  initSommaire();
  initRadioOptions();
  initScrollAnimations();
  initSmoothScroll();
  initMobileMenu();
});

// ===== Bouton Retour en haut =====
function initScrollToTop() {
  const btn = document.querySelector('.scroll-top');
  if (!btn) return;

  const toggleVisibility = () => {
    if (window.scrollY > 400) {
      btn.classList.add('visible');
    } else {
      btn.classList.remove('visible');
    }
  };

  window.addEventListener('scroll', throttle(toggleVisibility, 100));
  toggleVisibility();

  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

// ===== Carousel Avis =====
function initCarousel() {
  const carousel = document.querySelector('.avis-carousel');
  const prevBtn = document.querySelector('.carousel-btn.prev');
  const nextBtn = document.querySelector('.carousel-btn.next');

  if (!carousel || !prevBtn || !nextBtn) return;

  const cardWidth = 300;
  const gap = 20;
  const scrollAmount = cardWidth + gap;

  prevBtn.addEventListener('click', () => {
    carousel.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
  });

  nextBtn.addEventListener('click', () => {
    carousel.scrollBy({ left: scrollAmount, behavior: 'smooth' });
  });

  // Touch swipe support
  let startX = 0;
  carousel.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
  });
  carousel.addEventListener('touchend', (e) => {
    const diff = startX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) {
      carousel.scrollBy({ left: diff > 0 ? scrollAmount : -scrollAmount, behavior: 'smooth' });
    }
  });
}

// ===== Sommaire Accordéon =====
function initSommaire() {
  const toggle = document.querySelector('.sommaire-toggle');
  const list = document.querySelector('.sommaire-list');

  if (!toggle || !list) return;

  toggle.addEventListener('click', () => {
    list.style.display = list.style.display === 'none' ? 'block' : 'none';
    toggle.textContent = list.style.display === 'none' ? '+' : '×';
  });

  // Smooth scroll vers les ancres
  list.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', (e) => {
      const target = document.querySelector(link.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
}

// ===== Options Radio stylisées =====
function initRadioOptions() {
  document.querySelectorAll('.radio-group').forEach(group => {
    const options = group.querySelectorAll('.radio-option');
    options.forEach(opt => {
      opt.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT') return;
        const input = opt.querySelector('input');
        if (!input) return;
        options.forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        input.checked = true;
      });
    });
  });
}

// ===== Animations au scroll =====
function initScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.animationPlayState = 'running';
        entry.target.classList.add('animated');
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

  document.querySelectorAll('.stat-card, .avis-card, .vehicle-btn, .vehicle-card').forEach(el => {
    el.style.animationPlayState = 'paused';
    observer.observe(el);
  });
}

// ===== Scroll fluide =====
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const targetId = this.getAttribute('href');
      if (targetId === '#') return;
      const target = document.querySelector(targetId);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
}

// ===== Menu mobile (hamburger) =====
function initMobileMenu() {
  const toggle = document.querySelector('.menu-toggle');
  const mobileNav = document.getElementById('mobileNav');
  if (!toggle || !mobileNav) return;

  function openMenu() {
    mobileNav.classList.add('is-open');
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', 'Fermer le menu');
    document.body.style.overflow = 'hidden';
  }
  function closeMenu() {
    mobileNav.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Ouvrir le menu');
    document.body.style.overflow = '';
  }

  toggle.addEventListener('click', () => {
    if (mobileNav.classList.contains('is-open')) closeMenu();
    else openMenu();
  });

  mobileNav.addEventListener('click', (e) => {
    if (e.target === mobileNav) closeMenu();
  });

  mobileNav.querySelectorAll('.mobile-nav-link').forEach(link => {
    link.addEventListener('click', () => closeMenu());
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mobileNav.classList.contains('is-open')) closeMenu();
  });
}

// ===== Utilitaires =====
function throttle(fn, delay) {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last >= delay) {
      last = now;
      fn(...args);
    }
  };
}
