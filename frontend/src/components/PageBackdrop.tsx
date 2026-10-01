/** Soft, slowly drifting colour glows behind a page (three Tailwind colour classes, e.g. "bg-orange-400/15"). */
export function PageBackdrop({ glows }: { glows: [string, string, string] }) {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <span className={`drift absolute -left-24 top-24 h-[28rem] w-[28rem] rounded-full blur-3xl ${glows[0]}`} />
      <span className={`drift absolute -right-24 top-1/3 h-[30rem] w-[30rem] rounded-full blur-3xl ${glows[1]}`} style={{ animationDelay: "-3s" }} />
      <span className={`drift absolute bottom-0 left-1/3 h-[24rem] w-[24rem] rounded-full blur-3xl ${glows[2]}`} style={{ animationDelay: "-6s" }} />
    </div>
  );
}
