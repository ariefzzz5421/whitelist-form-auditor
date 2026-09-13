export {};

declare global {
  interface SVGElement {
    /**
     * Playwright's locator.evaluate callback may type a DOM node as
     * SVGElement | HTMLElement even when the selector is `body`.
     * At runtime `body` is an HTMLElement; this declaration keeps the
     * build type-safe without weakening TypeScript checks globally.
     */
    innerText: string;
  }
}
