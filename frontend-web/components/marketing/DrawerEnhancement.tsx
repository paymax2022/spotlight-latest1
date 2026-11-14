'use client';

import { useEffect } from 'react';

/**
 * The hamburger's whole job is to add and remove a class, so it does not need
 * React to do it. Production serves this site from a LiteSpeed origin where the
 * homepage's streamed HTML is followed by ~19 chunk requests, which leaves a
 * window of ten seconds or more in which every click on the header is dead and
 * the menu reads as broken to the visitor who tried to use it.
 *
 * This script answers those clicks from the server HTML alone. Controls name
 * their family with `data-drawer-toggle` / `data-drawer-dismiss`, and the script
 * writes exactly the classes React writes from its own `open` state, so one DOM
 * element is the single source of truth for both. `isDrawerOpen` lets a header
 * adopt that state as its initial value at hydration: without it React's first
 * render disagrees with the live DOM, and the drawer the visitor already opened
 * slams shut the moment the bundle lands.
 *
 * Once the header has hydrated the script stands down — `DrawerEnhancement`'s
 * own effect raises `__spotlightDrawerReact` and both listeners obey it. A
 * toggle is order-sensitive, so a click two owners each answer inverts twice and
 * lands back where it started; React's handler wins the race because its update
 * reaches the DOM before the click finishes bubbling to `document`, and the
 * script then reads that fresh class as the previous state and flips it away.
 * Leaving that second answer in place produced a panel whose `inert` and classes
 * said closed while its button still said open.
 *
 * Escape is only pre-hydrated for the drawer family, because the drawer is the
 * family that closes on Escape once React is running.
 */
const KINDS = {
  drawer: {
    panel: '.hdr-drawer__panel',
    open: 'is-open',
    scrim: '.hdr-drawer__backdrop',
    scrimOpen: 'is-open',
    inert: true,
    escape: true,
  },
  offcanvas: {
    panel: '.offcanvas__info',
    open: 'info-open',
    scrim: '.offcanvas__overlay',
    scrimOpen: 'overlay-open',
    inert: false,
    escape: false,
  },
} as const;

export type DrawerKind = keyof typeof KINDS;

/**
 * Whether the page's drawer of this family is open right now, read from the DOM
 * rather than from React. Safe to call during a first render: at hydration the
 * server's own markup is still on screen, and on a client-side navigation the
 * panel is not in it yet, which answers false.
 */
export function isDrawerOpen(kind: DrawerKind): boolean {
  if (typeof document === 'undefined') return false;
  const cfg = KINDS[kind];
  const panel = document.querySelector(cfg.panel);
  return !!panel && panel.classList.contains(cfg.open);
}

const SCRIPT = `(function () {
  if (window.__spotlightDrawerEnhanced) return;
  window.__spotlightDrawerEnhanced = true;

  var kinds = ${JSON.stringify(KINDS)};

  function apply(kind, open) {
    var cfg = kinds[kind];
    if (!cfg) return;
    var panel = document.querySelector(cfg.panel);
    if (!panel) return;
    panel.classList.toggle(cfg.open, open);
    if (cfg.inert) {
      if (open) panel.removeAttribute('inert');
      else panel.setAttribute('inert', '');
    }
    var scrim = document.querySelector(cfg.scrim);
    if (scrim) scrim.classList.toggle(cfg.scrimOpen, open);
  }

  document.addEventListener('click', function (event) {
    if (window.__spotlightDrawerReact) return;
    var node = event.target;
    if (node && node.nodeType !== 1) node = node.parentElement;
    if (!node || !node.closest) return;

    var trigger = node.closest('[data-drawer-toggle]');
    if (trigger) {
      var kind = trigger.getAttribute('data-drawer-toggle');
      var cfg = kinds[kind];
      var panel = cfg && document.querySelector(cfg.panel);
      if (panel) apply(kind, !panel.classList.contains(cfg.open));
      return;
    }

    var dismiss = node.closest('[data-drawer-dismiss]');
    if (dismiss) apply(dismiss.getAttribute('data-drawer-dismiss'), false);
  });

  document.addEventListener('keydown', function (event) {
    if (window.__spotlightDrawerReact) return;
    if (event.key !== 'Escape') return;
    Object.keys(kinds).forEach(function (kind) {
      if (kinds[kind].escape) apply(kind, false);
    });
  });
})();`;

declare global {
  interface Window {
    __spotlightDrawerReact?: boolean;
  }
}

export default function DrawerEnhancement() {
  // Rendering this component is the header's way of saying it answers its own
  // clicks now, which retires the inline script for good.
  useEffect(() => {
    window.__spotlightDrawerReact = true;
  }, []);

  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
