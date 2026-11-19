const v = (n) => `var(--${n})`;
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: { bg: v('bg'), surface: v('surface'), raised: v('raised'), line: v('line'), ink: v('ink'), mute: v('mute'), accent: v('accent'), 'accent-ink': v('accent-ink') },
      fontFamily: { display: ['"Instrument Serif"', 'Georgia', 'serif'], sans: ['"Hanken Grotesk Variable"', 'system-ui', 'sans-serif'], mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'] },
    },
  },
};
