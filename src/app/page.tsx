import { redirect } from "next/navigation";

// Authentication has been removed. The home page now serves the app directly.
export default function RootPage() {
  redirect("/dashboard");
}
