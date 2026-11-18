import { motion, useMotionValue, useSpring, useReducedMotion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { formatMoney } from '@/lib/utils';

/** Số tiền đếm chạy khi thay đổi. */
export function CountUpMoney({ value, className }: { value: number; className?: string }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(value);
  const spring = useSpring(mv, { stiffness: 120, damping: 24 });
  const [shown, setShown] = useState(value);

  useEffect(() => {
    if (reduce) {
      setShown(value);
      mv.set(value);
      return;
    }
    mv.set(value);
    const unsub = spring.on('change', (v) => setShown(v));
    return () => unsub();
  }, [value, mv, spring, reduce]);

  return <motion.span className={className}>{formatMoney(reduce ? value : shown)}</motion.span>;
}
