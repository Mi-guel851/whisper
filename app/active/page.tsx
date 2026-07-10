import { redirect } from "next/navigation";

export default function ActiveUsersPage() {
  redirect("/friends?tab=active");
}
