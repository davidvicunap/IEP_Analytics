import { redirect } from "next/navigation";

/** The list of theses is the home page now; old links and bookmarks land there. */
export default function ResearchPage() {
  redirect("/");
}
