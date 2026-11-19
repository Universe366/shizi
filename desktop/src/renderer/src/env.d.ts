/// <reference types="vite/client" />

declare module '*.ico' {
  const src: string;
  export default src;
}
import type { BsubApi } from '../../shared/api';

declare global {
  interface Window {
    bsub: BsubApi;
  }
}

export {};
