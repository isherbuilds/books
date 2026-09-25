import { env } from "@accly/env/server";

/** Only the FOUNDING_EMAIL account creates organizations. The email never leaves the server. */
export const isFounder = (email: string) =>
  email.toLowerCase() === env.FOUNDING_EMAIL.toLowerCase();
