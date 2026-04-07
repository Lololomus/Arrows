/**
 * JSX declaration for the AdsGram Task web component.
 * https://docs.adsgram.ai/ru/publisher/typescript
 */

import type React from 'react';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'adsgram-task': React.HTMLAttributes<HTMLElement> & React.RefAttributes<HTMLElement> & {
        'data-block-id'?: string;
        'data-debug'?: string;
        'data-debug-console'?: string;
      };
    }
  }
}
