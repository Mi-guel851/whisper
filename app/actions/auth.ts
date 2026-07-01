"use server";

import { redirect } from "next/navigation";

export async function signUp() {
  redirect("/dashboard");
}

export async function signIn() {
  redirect("/dashboard");
}