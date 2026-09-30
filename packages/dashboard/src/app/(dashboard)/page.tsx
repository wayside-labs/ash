export const dynamic = "force-dynamic";

import { HomeLayout } from "@/components/home/home-layout";

/** Chat on the left, the workflows panel on the right; the client's balance is in the top bar. */
export default function HomePage() {
  return <HomeLayout />;
}
