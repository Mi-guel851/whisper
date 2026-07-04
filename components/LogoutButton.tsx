"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

export default function LogoutButton() {
  const router = useRouter();

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/");
  }

  return (
    <button
      onClick={logout}
      className="mt-8 flex w-full items-center justify-center gap-3 rounded-2xl bg-red-600 py-4 font-bold text-white transition hover:bg-red-500"
    >
      <LogOut size={20} />
      Logout
    </button>
  );
}