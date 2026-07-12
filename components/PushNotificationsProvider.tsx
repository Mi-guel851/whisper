"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useRegisterPushNotifications } from "@/lib/push/useRegisterPushNotifications";

export default function PushNotificationsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useRegisterPushNotifications(userId);

  return <>{children}</>;
}