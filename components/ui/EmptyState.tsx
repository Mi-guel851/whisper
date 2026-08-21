"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { respectMotion, spring, staggerContainer, staggerItem } from "@/lib/motion";
import { useSafeReducedMotion } from "@/lib/useSafeReducedMotion";
import Button, { ButtonLink } from "@/components/Button";

/**
 * The panel a screen shows when it has nothing to list.
 *
 * Every one of these used to be written inline, and it showed: a bare `<p>` on
 * the inbox, a muted sentence on the feed, a two-line block on friends. Same
 * moment in the product, three different answers, and none of them told the user
 * what to do next — which is the only job an empty state has. A first-run screen
 * is the first impression, so it is worth a real one.
 *
 * The shape is deliberately fixed: a medallion, a headline, one supporting line,
 * and at most one action. Callers supply the words and the icon, not the layout,
 * so the fourth screen to adopt this cannot drift from the first three.
 *
 * Motion is a single staggered entrance plus a slow drift on the medallion. The
 * drift is 6px over 4.5s — present enough that the panel does not read as a dead
 * end, far too slow to compete with anything the user does next. Under reduced
 * motion the entrance becomes a fade and the drift stops entirely.
 */

type Action =
  | { label: string; href: string; onClick?: never }
  | { label: string; onClick: () => void; href?: never };

type EmptyStateProps = {
  /** A lucide icon element, sized around 26. Rendered inside the medallion. */
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  action?: Action;
  /** Extra classes on the outer block, for padding that suits the host surface. */
  className?: string;
};

export default function EmptyState({
  icon,
  title,
  description,
  action,
  className = "",
}: EmptyStateProps) {
  const reduced = useSafeReducedMotion();

  return (
    <motion.div
      className={`flex flex-col items-center px-6 py-10 text-center ${className}`}
      variants={respectMotion(staggerContainer(0.06), reduced)}
      initial="hidden"
      animate="visible"
    >
      <motion.div variants={respectMotion(staggerItem, reduced)}>
        <motion.div
          className="empty-medallion"
          animate={reduced ? undefined : { y: [-3, 3, -3] }}
          transition={
            reduced
              ? undefined
              : { duration: 4.5, repeat: Infinity, ease: "easeInOut" }
          }
          aria-hidden
        >
          {icon}
        </motion.div>
      </motion.div>

      <motion.p
        variants={respectMotion(staggerItem, reduced)}
        className="card-title mt-4"
      >
        {title}
      </motion.p>

      {description && (
        <motion.p
          variants={respectMotion(staggerItem, reduced)}
          className="theme-text-muted mt-1.5 max-w-[34ch] text-sm leading-relaxed"
        >
          {description}
        </motion.p>
      )}

      {action && (
        <motion.div
          variants={respectMotion(staggerItem, reduced)}
          className="mt-5"
          whileTap={reduced ? undefined : { scale: 0.97 }}
          transition={spring.snappy}
        >
          {action.href ? (
            <ButtonLink href={action.href} variant="primary" size="sm">
              {action.label}
            </ButtonLink>
          ) : (
            <Button type="button" onClick={action.onClick} variant="primary" size="sm">
              {action.label}
            </Button>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}
