import { motion } from 'framer-motion';

export type GiftBoxPhase = 'idle' | 'processing' | 'opening' | 'open';

interface GiftBoxGraphicProps {
  phase: GiftBoxPhase;
  isBurst?: boolean;
}

export function GiftBoxGraphic({ phase }: GiftBoxGraphicProps) {
  const isRaised = phase === 'opening' || phase === 'open';

  return (
    <div className="relative h-full w-full overflow-visible">
      <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 160 160" fill="none">
        <defs>
          <linearGradient id="giftBodyGrad" x1="14" y1="88" x2="146" y2="150" gradientUnits="userSpaceOnUse">
            <stop stopColor="rgba(255,255,255,0.15)" />
            <stop offset="1" stopColor="rgba(255,255,255,0.04)" />
          </linearGradient>
          <radialGradient id="giftGlowGrad" cx="50%" cy="55%" r="50%">
            <stop offset="0%" stopColor="rgba(255,210,60,0.30)" />
            <stop offset="100%" stopColor="rgba(255,210,60,0)" />
          </radialGradient>
        </defs>

        <motion.circle
          cx="80"
          cy="102"
          r="72"
          fill="url(#giftGlowGrad)"
          animate={phase === 'idle'
            ? { opacity: [0.55, 1, 0.55], scale: [0.92, 1.08, 0.92] }
            : { opacity: 0.7, scale: 1 }
          }
          transition={phase === 'idle'
            ? { duration: 2.2, repeat: Infinity, ease: 'easeInOut' }
            : { duration: 0.25 }
          }
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        />

        <ellipse cx="80" cy="152" rx="50" ry="7" fill="rgba(0,0,0,0.22)" />

        <rect
          x="14"
          y="88"
          width="132"
          height="60"
          rx="12"
          fill="url(#giftBodyGrad)"
          stroke="rgba(255,255,255,0.16)"
          strokeWidth="1.5"
        />
        <rect x="68" y="88" width="24" height="60" fill="rgba(255,185,48,0.46)" />
        <rect x="14" y="88" width="132" height="3" rx="2" fill="rgba(255,255,255,0.12)" />
      </svg>

      <motion.div
        className="absolute inset-0 h-full w-full overflow-visible"
        animate={isRaised
          ? { y: -56 }
          : phase === 'idle'
            ? { y: [0, -4, 0] }
            : { y: 0 }
        }
        transition={phase === 'idle'
          ? { duration: 2.2, repeat: Infinity, ease: 'easeInOut' }
          : { type: 'spring', stiffness: 300, damping: 22, mass: 0.75 }
        }
      >
        <svg className="h-full w-full overflow-visible" viewBox="0 0 160 160" fill="none">
          <defs>
            <linearGradient id="giftLidGrad" x1="8" y1="64" x2="152" y2="96" gradientUnits="userSpaceOnUse">
              <stop stopColor="rgba(255,255,255,0.24)" />
              <stop offset="1" stopColor="rgba(255,255,255,0.07)" />
            </linearGradient>
          </defs>

          <rect
            x="8"
            y="64"
            width="144"
            height="30"
            rx="12"
            fill="url(#giftLidGrad)"
            stroke="rgba(255,255,255,0.20)"
            strokeWidth="1.5"
          />
          <rect x="8" y="72" width="144" height="14" rx="2" fill="rgba(255,185,48,0.52)" />
          <path
            d="M 22 67 Q 80 63 138 67"
            stroke="rgba(255,255,255,0.20)"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <ellipse
            cx="62"
            cy="52"
            rx="20"
            ry="12"
            fill="rgba(255,185,48,0.38)"
            stroke="rgba(255,205,75,0.72)"
            strokeWidth="1.5"
            transform="rotate(-24 62 52)"
          />
          <ellipse
            cx="98"
            cy="52"
            rx="20"
            ry="12"
            fill="rgba(255,185,48,0.38)"
            stroke="rgba(255,205,75,0.72)"
            strokeWidth="1.5"
            transform="rotate(24 98 52)"
          />
          <ellipse
            cx="80"
            cy="57"
            rx="10"
            ry="7"
            fill="rgba(255,185,48,0.82)"
            stroke="rgba(255,215,90,0.92)"
            strokeWidth="1.5"
          />
          <line x1="75" y1="62" x2="65" y2="76" stroke="rgba(255,185,48,0.62)" strokeWidth="4.5" strokeLinecap="round" />
          <line x1="85" y1="62" x2="95" y2="76" stroke="rgba(255,185,48,0.62)" strokeWidth="4.5" strokeLinecap="round" />
        </svg>
      </motion.div>
    </div>
  );
}
