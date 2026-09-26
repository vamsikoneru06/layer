import Image from "next/image";
import Link from "next/link";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-[9px] rounded-md">
      <Image src="/vash-logo.png" alt="" width={26} height={26} className="size-[26px] flex-none rounded-md object-cover" priority />
      <span className="text-[19px] font-semibold tracking-[-0.03em]">VASH</span>
    </Link>
  );
}
