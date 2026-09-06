import { redirect } from "next/navigation";
import { CREATOR_ROUTE } from "@/lib/creator";

/** `/official` is an alias for the creator dashboard. */
export default function OfficialAliasPage() {
  redirect(CREATOR_ROUTE);
}
