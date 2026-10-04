import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
afterEach(cleanup)

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1280 })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: query.includes('min-width: 1180')
        ? window.innerWidth >= 1180
        : query.includes('max-width')
          ? window.innerWidth < Number(query.match(/\d+/)?.[0] || 0)
          : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
  Element.prototype.scrollTo = () => {}
  Element.prototype.scrollIntoView = () => {}
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
