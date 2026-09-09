import { createFileRoute } from "@tanstack/react-router";

import { FeaturePage } from "@/components/landing/feature-page";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/customers")({
  head: () => pageHead({ path: "/customers" }),
  component: () => (
    <FeaturePage
      shot="customers"
      eyebrow="Customers"
      title="Every customer, one keystroke away"
      lead="Search by name, code or phone. The record carries every document raised against it."
      windowTitle="Customers · Meridian Traders"
      captureAlt="The customer registry: code, name, phone and registration date for every customer"
      crops={[
        {
          region: { x: 272, y: 60, w: 720, h: 260 },
          claim: "One search box. Name, code or phone.",
          body: "The code is issued once and never reused, so the same number finds the same customer at every desk.",
        },
        {
          region: { x: 272, y: 160, w: 1144, h: 520 },
          claim: "The registry, as a list you can read.",
          body: "Code, name, phone and the date they were added, newest first.",
        },
        {
          region: { x: 700, y: 0, w: 740, h: 400 },
          claim: "Add one in the same place you search.",
          body: "A new customer is created from the registry itself, and their record opens with their balance on top.",
        },
      ]}
    />
  ),
});
