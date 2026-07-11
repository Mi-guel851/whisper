"use client";

import { Check, CheckCheck } from "lucide-react";

export default function MessageTicks({
  deliveredAt,
  readAt,
}: {
  deliveredAt: string | null;
  readAt: string | null;
}) {
  if (readAt) {
    return <CheckCheck size={14} className="text-cyan-400" />;
  }
  if (deliveredAt) {
    return <Check size={14} className="text-cyan-400" />;
  }
  return <Check size={14} className="text-gray-500" />;
}