"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

export default function Dashboard() {
  const router = useRouter();
  const [email, setEmail] = useState("");

  useEffect(() => {
    async function loadUser() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.push("/login");
        return;
      }

      setEmail(session.user.email || "");
    }

    loadUser();
  }, [router]);

  async function logout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <main className="min-h-screen bg-[#090014] text-white flex flex-col items-center justify-center">
      <h1 className="text-4xl font-bold">Dashboard</h1>

      <p className="mt-4">{email}</p>

      <button
        onClick={logout}
        className="mt-8 rounded-xl bg-red-500 px-6 py-3 font-bold"
      >
        Logout
      </button>
    </main>
  );
}