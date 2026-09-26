import { redirect } from "next/navigation";

// The static office UI lives in public/office/, but Next normalizes "/office/"
// to "/office", which would otherwise 404. This route hands that URL off to
// the static index.
export default function OfficeIndexRedirect() {
  redirect("/office/index.html");
}
