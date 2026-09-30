export const dynamic = "force-dynamic";

import { HomeLayout } from "@/components/home/home-layout";
import { SimpleHome } from "@/components/home/simple-home";
import { SHELL_MODE } from "@/lib/shell";

export default function HomePage() {
  return SHELL_MODE === "simple" ? <SimpleHome /> : <HomeLayout />;
}
