import { Compass } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { StatusScreen } from "@/components/ui/status-screen";

export const metadata = { title: "Page not found · VASH" };

export default function NotFound() {
  return (
    <StatusScreen icon={<Compass />} title="Page not found" body={<p>There&apos;s nothing at this address. Check the link, or start again from the home page.</p>}>
      <ButtonLink href="/">Go to the home page</ButtonLink>
    </StatusScreen>
  );
}
