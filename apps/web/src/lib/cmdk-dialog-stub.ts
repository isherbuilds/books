// cmdk imports Radix Dialog only for `Command.Dialog`, which this app never renders
// (the palette composes the Base UI Dialog). Aliasing it here keeps Radix Dialog and
// its focus, scroll-lock and aria-hidden helpers out of the client bundle.
function unused(): never {
  throw new Error("cmdk Command.Dialog is not bundled; compose the Base UI Dialog.");
}

export { unused as Content, unused as Overlay, unused as Portal, unused as Root };
