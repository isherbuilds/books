import { CONTACT_PHONE, WHATSAPP_URL } from "@/lib/contact";

import { sendOnWhatsApp } from "./send-on-whatsapp";
import { WaIcon } from "./wa-icon";

const TIMES = ["Now", "This evening", "Tomorrow morning"] as const;

export function CallbackForm() {
  return (
    <form
      onSubmit={(event) => sendOnWhatsApp(event, "Please call me back about Edernal Books.")}
      className="flex flex-col gap-3.5 rounded-[18px] bg-(--band-raised) p-5.5"
    >
      <label className="field text-(--band-ink)">
        Your name
        <input name="Name" autoComplete="name" required />
      </label>
      <label className="field text-(--band-ink)">
        Mobile (WhatsApp)
        <span className="prefix">
          <span>+91</span>
          <input
            name="Mobile"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            placeholder="98765 43210"
            pattern="[0-9]{5} ?[0-9]{5}"
            title="A 10-digit mobile number, like 98765 43210"
            required
          />
        </span>
      </label>
      <fieldset className="text-sm font-medium text-(--band-ink)">
        <legend>Best time to call</legend>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {TIMES.map((time) => (
            <label
              key={time}
              className="flex h-8.5 cursor-pointer items-center rounded-full px-3 font-normal text-(--band-muted) ring-1 ring-(--band-edge) has-checked:bg-(--band-ink) has-checked:text-(--band) has-checked:ring-(--band-ink) has-focus-visible:outline-2 has-focus-visible:outline-offset-2"
            >
              <input
                type="radio"
                name="Best time to call"
                value={time}
                defaultChecked={time === "Now"}
                className="sr-only"
              />
              {time}
            </label>
          ))}
        </div>
      </fieldset>
      <button type="submit" className="btn w-full bg-(--band-stamp) text-(--band)">
        Continue to WhatsApp
      </button>
      <span className="flex items-center gap-2.5 text-[13px] text-(--band-muted) before:h-px before:flex-1 before:bg-(--band-line) after:h-px after:flex-1 after:bg-(--band-line)">
        or
      </span>
      <a
        className="btn line w-full whitespace-normal"
        href={WHATSAPP_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        <WaIcon />
        <span>WhatsApp {CONTACT_PHONE}</span>
      </a>
      <p className="text-[13.5px] text-(--band-muted)">
        WhatsApp opens a draft. Press Send there to contact us.
      </p>
    </form>
  );
}
