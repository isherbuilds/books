import type { SubmitEvent } from "react";

import { WHATSAPP_URL } from "@/lib/contact";

/* There is no form backend. The visitor reviews and sends this draft in
   WhatsApp. Same-tab navigation avoids popup blocking. */
export function sendOnWhatsApp(event: SubmitEvent<HTMLFormElement>, intro: string) {
  event.preventDefault();

  const lines = [...new FormData(event.currentTarget)].flatMap(([name, value]) => {
    const answer = String(value).trim();

    return answer ? [`${name}: ${answer}`] : [];
  });

  const url = new URL(WHATSAPP_URL);

  url.searchParams.set("text", [intro, ...lines].join("\n"));

  window.location.assign(url.href);
}
