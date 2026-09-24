import { cva } from "class-variance-authority";

const toggleVariants = cva(
  "group/toggle inline-flex items-center justify-center gap-1 rounded-md border border-transparent bg-clip-padding text-xs font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow] duration-100 ease-out outline-none [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 data-pressed:bg-primary data-pressed:text-primary-foreground data-pressed:[@media(hover:hover)_and_(pointer:fine)]:hover:bg-primary/80 data-pressed:[@media(hover:hover)_and_(pointer:fine)]:hover:text-primary-foreground",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border-border bg-background",
      },
      size: {
        default:
          "h-8 min-w-8 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        sm: "h-7 min-w-7 px-2.5 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5",
        lg: "h-9 min-w-9 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export { toggleVariants };
