import { redirect } from "next/navigation";

/** The operator overview was `/` again once the simple shell went; old links still land there. */
export default function AdvancedHomePage() {
  redirect("/");
}
