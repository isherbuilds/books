import { Link } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";

import { CtaBand } from "./cta-band";
import { PageHero } from "./page-hero";
import { ProductWindow, type Region, type ShotName } from "./product-window";

/* One module's page: the real screen whole, then three zooms each carrying one
   claim. */

/* The list screen entire. */
const CAPTURE: Region = { x: 0, y: 0, w: 1440, h: 900 };

export function FeaturePage({
  shot,
  kicker,
  title,
  lead,
  windowTitle,
  captureAlt,
  crops,
}: {
  shot: ShotName;
  kicker: string;
  title: string;
  lead: string;
  /* The window-chrome label, `"<Section> · Meridian Traders"`, on every window. */
  windowTitle: string;
  /* The full capture is described; each crop repeats the claim printed beside it
     and is hidden from assistive technology. */
  captureAlt: string;
  /* A crop zooms the list shot unless it names another, such as the record. */
  crops: { shot?: ShotName; region: Region; claim: string; body: string }[];
}) {
  return (
    <>
      <PageHero
        kicker={kicker}
        title={title}
        actions={
          <Link to="/early-access" className="btn">
            Get early access <ArrowRightIcon />
          </Link>
        }
      >
        {lead}
      </PageHero>

      <div className="wrap">
        <div className="rounded-[22px] bg-(--sunken) p-[clamp(12px,3vw,36px)]">
          <ProductWindow name={shot} region={CAPTURE} alt={captureAlt} title={windowTitle} />
        </div>

        <div className="mt-[clamp(64px,8vw,104px)] flex flex-col gap-[clamp(64px,8vw,104px)]">
          {crops.map((crop, i) => (
            <div
              key={crop.claim}
              className={`grid items-center gap-[clamp(28px,5vw,64px)] ${
                i % 2
                  ? "min-[861px]:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]"
                  : "min-[861px]:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
              }`}
            >
              <div className={`reveal flex flex-col gap-3.5 ${i % 2 ? "min-[861px]:order-2" : ""}`}>
                <h2 className="text-[clamp(26px,2.8vw,36px)] leading-[1.1] font-[620] tracking-[-0.03em]">
                  {crop.claim}
                </h2>
                <p className="text-[16.5px] leading-[1.65] text-(--ink-muted)">{crop.body}</p>
              </div>
              {/* On a phone the window is cropped rather than shrunk: a table
                  squeezed into a 320px column argues nothing. */}
              <div className="reveal grid justify-items-start overflow-hidden rounded-[22px] bg-(--sunken) p-[clamp(16px,3vw,36px)] min-[640px]:place-items-center">
                <ProductWindow
                  name={crop.shot ?? shot}
                  region={crop.region}
                  alt=""
                  title={windowTitle}
                  className="w-[44rem] max-w-none min-[640px]:w-full"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <CtaBand />
    </>
  );
}
